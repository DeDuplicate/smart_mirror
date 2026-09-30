'use strict';

// Bluetooth speakers / headphones: pair + connect through BlueZ (bluetoothctl),
// then steer the mirror's audio to them through PulseAudio (pactl).
//
// PulseAudio is needed because the Pi's audio is raw ALSA pinned to HDMI - there
// is no sound server, so nothing can move Chromium's output onto an A2DP sink.
// A sound server also copes with speakers coming and going: when one drops its
// streams fall back to HDMI, which an ALSA config file cannot do. It is
// installed on demand (POST /install-audio) rather than assumed, so a mirror
// that never uses Bluetooth keeps its proven HDMI path untouched.

const { Router } = require('express');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const router = Router();

const IS_LINUX = os.platform() === 'linux';
const MAC_RE = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;
const AUDIO_PKGS = ['pulseaudio', 'pulseaudio-module-bluetooth', 'pulseaudio-utils'];
const COMBINED = 'mirror_out'; // module-combine-sink name, used when >1 target
// The backend runs as a systemd *system* service, so it has no XDG_RUNTIME_DIR;
// without it pactl cannot find the user's PulseAudio socket.
const PA_ENV = IS_LINUX
  ? { ...process.env, XDG_RUNTIME_DIR: `/run/user/${process.getuid()}` }
  : process.env;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Safe shell helper - execFile, no shell, no injection
// ---------------------------------------------------------------------------
function run(cmd, args, timeout = 15000, env) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, env }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') });
    });
  });
}
const btctl = (args, timeout) => run('bluetoothctl', args, timeout);
const pactl = (args) => run('pactl', args, 10000, PA_ENV);

// ---------------------------------------------------------------------------
// Parsing (pure - covered by backend/test-bluetooth.js)
// ---------------------------------------------------------------------------

/** `bluetoothctl devices` -> [{mac, name}], dropping anonymous advertisers. */
function parseDevices(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^Device ((?:[0-9A-F]{2}:){5}[0-9A-F]{2}) (.*)$/i);
    if (!m) continue;
    const mac = m[1].toUpperCase();
    const name = m[2].trim();
    // BlueZ names a device with no name after its address (dashed). Those are
    // BLE beacons / phones hopping random addresses - never a speaker.
    if (!name || name === mac.replace(/:/g, '-')) continue;
    out.push({ mac, name });
  }
  return out;
}

/**
 * `bluetoothctl info` -> {paired, connected, audio}.
 * `audio` is a hint used only for ordering: a real speaker often advertises no
 * Class/Icon until it is connected ("Razer Stereo" showed neither in a live
 * scan), so it must never be used to HIDE a device.
 */
function parseInfo(text) {
  const info = { paired: false, connected: false, audio: false };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s+([A-Za-z ]+): (.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'Paired') info.paired = val === 'yes';
    else if (key === 'Connected') info.connected = val === 'yes';
    else if (key === 'Icon' && /^audio-/.test(val)) info.audio = true;
    else if (key === 'UUID' && /\(0000110b-/i.test(val)) info.audio = true; // A2DP sink
  }
  return info;
}

const macKey = (mac) => mac.toUpperCase().replace(/:/g, '_');

/** PulseAudio sink name -> MAC it belongs to, or null (HDMI, combined...). */
function sinkMac(name) {
  const m = String(name).match(/bluez_\w+\.((?:[0-9A-F]{2}_){5}[0-9A-F]{2})/i);
  return m ? m[1].replace(/_/g, ':').toUpperCase() : null;
}

/** Order: connected, then saved, then speaker-looking, then by name. */
function sortDevices(list) {
  return list.sort((a, b) =>
    (b.connected - a.connected) || (b.paired - a.paired) || (b.audio - a.audio)
    || a.name.localeCompare(b.name));
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\x01\x02]/g, '');

// ---------------------------------------------------------------------------
// BlueZ
// ---------------------------------------------------------------------------
async function listDevices() {
  const base = parseDevices((await btctl(['devices'])).stdout);
  const devices = await Promise.all(base.map(async ({ mac, name }) =>
    ({ mac, name, ...parseInfo((await btctl(['info', mac])).stdout) })));
  return sortDevices(devices);
}

/**
 * Power the adapter on. A persisted rfkill soft-block is the usual reason it
 * will not: systemd-rfkill restores the last state at boot and this Pi's
 * dongle had been saved as blocked, so `power on` failed with
 * org.bluez.Error.Failed and bluetoothd logged "Failed to set mode (0x03)".
 */
async function ensurePowered() {
  const powerOn = async () => /succeeded/.test((await btctl(['power', 'on'])).stdout);
  if (!(await powerOn())) {
    try {
      for (const d of fs.readdirSync('/sys/class/rfkill')) {
        const dir = `/sys/class/rfkill/${d}`;
        if (fs.readFileSync(`${dir}/type`, 'utf8').trim() === 'bluetooth') {
          await run('sudo', ['-n', 'sh', '-c', `echo 0 > ${dir}/soft`]);
        }
      }
    } catch { /* no rfkill sysfs - nothing to unblock */ }
    if (!(await powerOn())) return false;
  }
  await btctl(['pairable', 'on']);
  return true;
}

// One radio: a scan degrades A2DP and the combo chip is shared with WiFi, so
// scan/pair never overlap.
let busy = false;
async function exclusive(fn) {
  if (busy) return { ok: false, error: 'busy' };
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

/**
 * Pair + trust + connect in ONE bluetoothctl session. Pairing needs an agent
 * registered for the lifetime of the attempt, which one-shot `bluetoothctl
 * pair` does not give us. Stages: find (device must be known to BlueZ - it only
 * remembers scan results for ~3 min) -> pair -> connect.
 */
function pairSession(mac) {
  return new Promise((resolve) => {
    const p = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let stage = 'find';
    let done = false;
    let partial = '';
    // bluetoothctl runs commands asynchronously: in a live test `pair` executed
    // before "Agent registered" printed. Pairing without the agent up fails
    // for anything that asks a question, so both must be true before `pair`.
    let agentReady = false;
    let deviceSeen = false;
    const tryPair = () => {
      if (stage !== 'find' || !agentReady || !deviceSeen) return;
      stage = 'pair';
      send('scan off'); // pairing while discovering is slow and flaky
      send(`pair ${mac}`);
    };
    const send = (s) => { try { p.stdin.write(s + '\n'); } catch { /* process gone */ } };
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      send('quit');
      setTimeout(() => p.kill(), 1000);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `timeout during ${stage}` }), 75000);
    p.on('error', (err) => finish({ ok: false, error: err.message }));
    p.on('close', () => finish({ ok: false, error: 'bluetoothctl exited' }));

    const onLine = (line) => {
      // Agent prompts, any stage. Speakers/headsets use Just Works or the
      // legacy 0000 PIN; nothing else makes sense on a screen with no keypad.
      if (/\(yes\/no\)/i.test(line)) send('yes');
      else if (/Enter PIN code/i.test(line)) send('0000');

      if (stage === 'find') {
        if (/Default agent request successful/i.test(line)) agentReady = true;
        if (line.includes(mac) && /Device/.test(line)) deviceSeen = true;
        tryPair();
      } else if (stage === 'pair') {
        if (/AlreadyExists|Pairing successful|Paired: yes/i.test(line)) {
          stage = 'connect';
          send(`trust ${mac}`);
          send(`connect ${mac}`);
        } else if (/Failed to pair|not available/i.test(line)) {
          finish({ ok: false, error: line.replace(/^.*?(Failed to pair: |Device .* not available)/i, '$1').trim() });
        }
      } else if (stage === 'connect') {
        if (/Connection successful|Connected: yes/i.test(line)) finish({ ok: true, connected: true });
        // Paired and trusted is still a success - the device is saved and will
        // reconnect when it is switched on.
        else if (/Failed to connect/i.test(line)) finish({ ok: true, connected: false });
      }
    };

    p.stdout.on('data', (chunk) => {
      const lines = (partial + stripAnsi(chunk.toString())).split(/[\r\n]+/);
      partial = lines.pop();
      lines.forEach(onLine);
    });

    send('agent NoInputNoOutput');
    send('default-agent');
    send('scan on');
    // Not in range / not in pairing mode: give up rather than hang the UI.
    setTimeout(() => { if (stage === 'find') finish({ ok: false, error: 'device not found' }); }, 20000);
  });
}

// ---------------------------------------------------------------------------
// PulseAudio
// ---------------------------------------------------------------------------
let installing = false;
let routed = ['local']; // last targets applied; needed to describe the combined sink

async function audioState() {
  if (installing) return 'installing';
  return (await pactl(['info'])).ok ? 'ready' : 'missing';
}

async function sinkNames() {
  const r = await pactl(['list', 'short', 'sinks']);
  return r.stdout.split('\n').map((l) => l.split('\t')[1]).filter(Boolean);
}

async function currentRoute() {
  const def = (await pactl(['get-default-sink'])).stdout.trim();
  if (def === COMBINED) return routed;
  const mac = sinkMac(def);
  return mac ? [mac] : ['local'];
}

/** Connect a saved speaker if needed and wait for its A2DP sink to appear. */
async function ensureSink(mac) {
  const has = async () => (await sinkNames()).some((n) => n.includes(macKey(mac)));
  if (await has()) return true;
  await ensurePowered();
  await btctl(['connect', mac], 25000);
  for (let i = 0; i < 8; i++) {
    await sleep(750); // the sink shows up a moment after the link does
    if (await has()) return true;
  }
  return false;
}

/** targets: 'local' (HDMI) and/or MACs. >1 target => module-combine-sink. */
async function setRoute(targets) {
  const previous = await currentRoute(); // lets a temporary caller (alarm) undo itself
  for (const t of targets) {
    if (t !== 'local' && !(await ensureSink(t))) return { ok: false, error: 'not connected', target: t };
  }
  const sinks = await sinkNames();
  const names = targets.map((t) => (t === 'local'
    ? sinks.find((n) => /hdmi/i.test(n)) || sinks.find((n) => !sinkMac(n) && n !== COMBINED)
    : sinks.find((n) => n.includes(macKey(t)))));
  if (names.some((n) => !n)) return { ok: false, error: 'sink not found' };

  await pactl(['unload-module', 'module-combine-sink']); // drop a previous combo
  let sink = names[0];
  if (names.length > 1) {
    const r = await pactl(['load-module', 'module-combine-sink', `sink_name=${COMBINED}`, `slaves=${names.join(',')}`]);
    if (!r.ok) return { ok: false, error: r.stderr.trim() };
    sink = COMBINED;
  }
  await pactl(['set-default-sink', sink]);
  // Streams already playing do not follow a new default on their own.
  const inputs = (await pactl(['list', 'short', 'sink-inputs'])).stdout
    .split('\n').map((l) => l.split('\t')[0]).filter(Boolean);
  await Promise.all(inputs.map((id) => pactl(['move-sink-input', id, sink])));
  routed = targets;
  return { ok: true, previous };
}

// ---------------------------------------------------------------------------
// Mock data for non-Linux development
// ---------------------------------------------------------------------------
const MOCK = {
  route: ['local'],
  devices: [
    { mac: 'AA:BB:CC:00:00:01', name: 'JBL Flip 6', paired: true, connected: true, audio: true },
    { mac: 'AA:BB:CC:00:00:02', name: 'Kitchen Speaker', paired: true, connected: false, audio: true },
    { mac: 'AA:BB:CC:00:00:03', name: 'Sony WH-1000XM4', paired: false, connected: false, audio: true },
    { mac: 'AA:BB:CC:00:00:04', name: 'Samsung TV', paired: false, connected: false, audio: false },
  ],
};
const mockDev = (mac) => MOCK.devices.find((d) => d.mac === mac);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function snapshot() {
  if (!IS_LINUX) return { supported: true, powered: true, audio: 'ready', route: MOCK.route, devices: MOCK.devices, mock: true };
  const show = (await btctl(['show'])).stdout;
  const audio = await audioState();
  if (!/Powered:/.test(show)) return { supported: false, powered: false, audio, route: ['local'], devices: [] };
  return {
    supported: true,
    powered: /Powered: yes/.test(show),
    audio,
    route: audio === 'ready' ? await currentRoute() : ['local'],
    devices: await listDevices(),
  };
}

function macOf(req, res) {
  const mac = String(req.body?.mac || req.params.mac || '').toUpperCase();
  if (MAC_RE.test(mac)) return mac;
  res.status(400).json({ error: 'valid mac is required' });
  return null;
}

// GET /api/bluetooth/status - adapter, audio server, route and known devices
router.get('/status', async (req, res) => {
  try {
    res.json(await snapshot());
  } catch (err) {
    req.app.locals.logger.error('Bluetooth status error: %s', err.message);
    res.status(500).json({ error: 'Failed to query Bluetooth' });
  }
});

// POST /api/bluetooth/scan - discover for ~8s, then return the fresh snapshot
router.post('/scan', async (req, res) => {
  const result = await exclusive(async () => {
    if (!IS_LINUX) return { ok: true };
    if (!(await ensurePowered())) return { ok: false, error: 'Bluetooth adapter is unavailable' };
    await btctl(['--timeout', '8', 'scan', 'on'], 20000);
    return { ok: true };
  });
  res.json({ ...result, ...(await snapshot()) });
});

// POST /api/bluetooth/pair { mac } - pair, trust and connect
router.post('/pair', async (req, res) => {
  const mac = macOf(req, res);
  if (!mac) return;
  const logger = req.app.locals.logger;
  const result = await exclusive(async () => {
    if (!IS_LINUX) {
      Object.assign(mockDev(mac) || {}, { paired: true, connected: true });
      return { ok: true, connected: true };
    }
    if (!(await ensurePowered())) return { ok: false, error: 'Bluetooth adapter is unavailable' };
    return pairSession(mac);
  });
  logger.info('Bluetooth pair %s: %s', mac, result.ok ? 'ok' : result.error);
  res.json(result);
});

// POST /api/bluetooth/connect | /disconnect { mac }
for (const verb of ['connect', 'disconnect']) {
  router.post(`/${verb}`, async (req, res) => {
    const mac = macOf(req, res);
    if (!mac) return;
    if (!IS_LINUX) {
      const d = mockDev(mac);
      if (d) d.connected = verb === 'connect';
      if (verb === 'disconnect' && MOCK.route.includes(mac)) MOCK.route = ['local'];
      return res.json({ ok: true });
    }
    if (verb === 'connect' && !(await ensurePowered())) return res.json({ ok: false, error: 'Bluetooth adapter is unavailable' });
    const r = await btctl([verb, mac], 25000);
    res.json({ ok: /successful/i.test(r.stdout) && !/Failed/i.test(r.stdout), error: r.stdout.match(/Failed.*/)?.[0] });
  });
}

// DELETE /api/bluetooth/:mac - forget a saved device
router.delete('/:mac', async (req, res) => {
  const mac = macOf(req, res);
  if (!mac) return;
  if (!IS_LINUX) {
    Object.assign(mockDev(mac) || {}, { paired: false, connected: false });
    MOCK.route = MOCK.route.filter((t) => t !== mac);
    if (!MOCK.route.length) MOCK.route = ['local'];
    return res.json({ ok: true });
  }
  const r = await btctl(['remove', mac]);
  res.json({ ok: /removed/i.test(r.stdout) });
});

// POST /api/bluetooth/route { targets: ['local' | MAC, ...] }
router.post('/route', async (req, res) => {
  const targets = req.body?.targets;
  if (!Array.isArray(targets) || !targets.length || targets.length > 4
      || !targets.every((t) => t === 'local' || MAC_RE.test(String(t)))) {
    return res.status(400).json({ error: 'targets must be 1-4 of "local" or a MAC address' });
  }
  const list = [...new Set(targets.map((t) => (t === 'local' ? t : t.toUpperCase())))];
  if (!IS_LINUX) {
    MOCK.route = list;
    return res.json({ ok: true });
  }
  // Serialised with scan/pair: moving streams mid-pairing glitches A2DP.
  const result = await exclusive(async () => {
    if ((await audioState()) !== 'ready') return { ok: false, error: 'audio-missing' };
    return setRoute(list);
  });
  if (!result.ok) req.app.locals.logger.warn('Bluetooth route failed: %s', result.error);
  res.json(result);
});

// POST /api/bluetooth/install-audio - apt-install PulseAudio (long; poll /status)
router.post('/install-audio', (req, res) => {
  if (!IS_LINUX) return res.json({ ok: true, mock: true });
  if (installing) return res.status(409).json({ error: 'already installing' });
  installing = true;
  res.json({ ok: true });

  const logger = req.app.locals.logger;
  (async () => {
    try {
      await run('sudo', ['-n', 'apt-get', 'update'], 180000);
      const r = await run('sudo', ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y',
        '--no-install-recommends', ...AUDIO_PKGS], 15 * 60 * 1000);
      if (!r.ok) {
        logger.error('Bluetooth audio install failed: %s', r.stderr.slice(-500));
        return;
      }
      logger.info('Bluetooth audio packages installed');
      await pactl(['info']); // socket-activates the user's PulseAudio
      // Chromium chooses ALSA vs PulseAudio once, at startup. The kiosk
      // watchdog relaunches it (same as a display change).
      execFile('pkill', ['-f', 'chromium'], () => {});
    } finally {
      installing = false;
    }
  })();
});

module.exports = router;
module.exports._test = { parseDevices, parseInfo, sinkMac, macKey, sortDevices, stripAnsi };
