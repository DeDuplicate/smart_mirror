'use strict';

// ---------------------------------------------------------------------------
// go2rtc sidecar (github.com/AlexxIT/go2rtc). Browsers cannot play RTSP, so
// every camera goes through it: go2rtc pulls RTSP / ONVIF / DVRIP / HTTP-JPEG
// and serves JPEG frames + fMP4 over a small HTTP API. That API is bound to
// 127.0.0.1 only (go2rtc skips auth for localhost) and is reached solely via
// routes/cameras.js, which sits behind the backend's auth middleware.
//
// The binary is downloaded into backend/bin on first need and only runs while
// at least one enabled camera exists. GO2RTC_URL=http://host:1984 uses an
// existing go2rtc instead (e.g. Frigate's) - streams are then registered over
// its /api/streams and nothing is spawned.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// Pinned: app.modules below was checked against this release's main.go.
const RELEASE = 'https://github.com/AlexxIT/go2rtc/releases/download/v1.9.14/';
const IS_WINDOWS = os.platform() === 'win32';
const BIN_DIR = path.join(__dirname, '..', 'bin');
const BIN = path.join(BIN_DIR, IS_WINDOWS ? 'go2rtc.exe' : 'go2rtc');
const CONFIG = path.join(__dirname, '..', 'data', 'go2rtc.yaml');
const LISTEN = '127.0.0.1:1984';
const EXTERNAL = (process.env.GO2RTC_URL || '').replace(/\/+$/, '');
const BASE = EXTERNAL || `http://${LISTEN}`;

// Only webrtc is really unwanted (a :8555 listener and CPU), and exec/echo/expr
// are left out because they turn a stream source into a command line.
const MODULES = ['api', 'http', 'rtsp', 'mp4', 'mjpeg', 'onvif', 'dvrip', 'ffmpeg'];

// Stream names this backend owns (camera UUIDs, see routes/cameras.js). On a
// shared go2rtc everything else - Frigate's own cameras - is left alone.
const OWN_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_sub|_snap)?$/;

let logger = console;
let getStreams = () => ({});
let child = null;
let stopping = false;
let startedAt = 0;
let crashes = 0;
let lastErrLine = '';
let restartTimer = null;
let retryTimer = null;
let holdUntil = 0;
let downloading = null;
let synced = {}; // name -> url last registered, so a resync only touches what changed
let chain = Promise.resolve();
const state = { running: false, error: null };
const inflight = new Map();

const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A JSON string is a valid YAML double-quoted scalar, so no YAML library.
function yamlConfig(streams) {
  const q = JSON.stringify;
  return [
    'api:',
    `  listen: ${q(LISTEN)}`,
    'rtsp:',
    '  listen: ""', // RTSP client only - no :8554 server
    'app:',
    `  modules: ${q(MODULES)}`,
    'log:',
    '  level: info',
    '  format: text',
    'streams:', // never `{}`: go2rtc's PUT /api/streams cannot patch a flow map
    ...Object.entries(streams).map(([name, url]) => `  ${q(name)}: ${q(url)}`),
    '',
  ].join('\n');
}

function assetName() {
  const arch = os.arch();
  if (IS_WINDOWS) return arch === 'x64' ? 'go2rtc_win64.zip' : null;
  if (os.platform() !== 'linux') return null;
  return { arm: 'go2rtc_linux_arm', arm64: 'go2rtc_linux_arm64', x64: 'go2rtc_linux_amd64' }[arch] || null;
}

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000 }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
  });
}

async function download() {
  const asset = assetName();
  if (!asset) throw new Error(`no go2rtc build for ${os.platform()}/${os.arch()}`);
  logger.info('[go2rtc] downloading %s', asset);
  const res = await fetch(RELEASE + asset, { signal: AbortSignal.timeout(5 * 60000) });
  if (!res.ok || !res.body) throw new Error(`go2rtc download failed: HTTP ${res.status}`);
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const tmp = path.join(BIN_DIR, `${asset}.part`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  if (asset.endsWith('.zip')) {
    // bsdtar ships with Windows 10+ and reads zips. Explicit path: a Git Bash
    // PATH puts GNU tar first, which cannot.
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    try {
      await execFileP(tar, ['-xf', tmp, '-C', BIN_DIR]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } else {
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, BIN);
  }
  if (!fs.existsSync(BIN)) throw new Error(`go2rtc download: ${path.basename(BIN)} missing from ${asset}`);
  logger.info('[go2rtc] installed %s', BIN);
}

function ensureBinary() {
  if (fs.existsSync(BIN)) return Promise.resolve();
  if (!downloading) downloading = download().finally(() => { downloading = null; });
  return downloading;
}

function spawnChild(streams) {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  // Holds camera passwords in the clear, like the DB does. gitignored.
  fs.writeFileSync(CONFIG, yamlConfig(streams), { mode: 0o600 });
  synced = { ...streams };
  stopping = false;
  lastErrLine = '';
  startedAt = Date.now();

  const proc = spawn(BIN, ['-c', CONFIG], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child = proc;

  // Debug only: a camera that is offline makes go2rtc log an error on every
  // snapshot request, which would flood app.log on a wall-mounted screen.
  const onData = (d) => {
    for (const line of String(d).split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (/\b(ERR|FTL|WRN)\b/.test(line)) lastErrLine = line.trim();
      logger.debug('[go2rtc] %s', line);
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (err) => { state.error = `go2rtc failed to start: ${err.message}`; });
  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    state.running = false;
    if (stopping) return;
    // Restart with backoff; a run of over a minute counts as healthy again.
    crashes = Date.now() - startedAt > 60000 ? 1 : crashes + 1;
    const delay = Math.min(60000, 2000 * 2 ** (crashes - 1));
    state.error = `go2rtc exited (${signal || code})${lastErrLine ? `: ${lastErrLine}` : ''}`;
    logger.warn('[go2rtc] %s - restarting in %ds', state.error, delay / 1000);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { restartTimer = null; resync(); }, delay);
  });
}

async function waitReady() {
  for (let i = 0; i < 30 && child; i++) {
    try {
      const r = await fetch(`${BASE}/api`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        state.running = true;
        state.error = null;
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  throw new Error(state.error || 'go2rtc did not start listening');
}

function stop() {
  clearTimeout(restartTimer);
  restartTimer = null;
  state.running = false;
  synced = {};
  if (!child) return;
  stopping = true;
  try { child.kill(); } catch { /* already gone */ }
  child = null;
}

// go2rtc error texts can echo a source URL; never let a password through.
function scrub(text) {
  return String(text).replace(/\/\/[^/@\s]*@/g, '//***@').trim().slice(0, 300);
}

async function api(method, p, timeoutMs = 10000) {
  let r;
  try {
    r = await fetch(BASE + p, { method, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // A timeout is go2rtc still waiting on a camera, not go2rtc being down.
    if (err.name === 'TimeoutError') throw Object.assign(new Error('camera did not answer in time'), { code: 'timeout' });
    throw Object.assign(new Error(`go2rtc unreachable (${err.cause?.code || err.message})`), { code: 'engine_down' });
  }
  if (!r.ok) {
    const detail = scrub(await r.text());
    throw Object.assign(new Error(`go2rtc ${method} ${p.split('?')[0]}: ${r.status} ${detail}`), { status: r.status, detail });
  }
  return r;
}

async function apiSync(want) {
  const current = (await (await api('GET', '/api/streams')).json()) || {};
  for (const name of Object.keys(current)) {
    if (OWN_NAME.test(name) && !(name in want)) {
      await api('DELETE', `/api/streams?src=${enc(name)}`);
      delete synced[name];
    }
  }
  for (const [name, url] of Object.entries(want)) {
    if (synced[name] === url && name in current) continue;
    await api('PUT', `/api/streams?name=${enc(name)}&src=${enc(url)}`);
    synced[name] = url;
  }
  state.running = true;
  state.error = null;
}

async function doSync() {
  const want = getStreams();
  if (EXTERNAL) return apiSync(want);

  if (!Object.keys(want).length && Date.now() >= holdUntil) {
    if (child) logger.info('[go2rtc] no enabled cameras - stopping');
    stop();
    state.error = null;
    return;
  }
  if (restartTimer) return; // crash backoff pending; it respawns with fresh config
  if (!child) {
    await ensureBinary();
    spawnChild(want);
    logger.info('[go2rtc] started with %d streams (pid %d)', Object.keys(want).length, child.pid);
    return waitReady();
  }
  return apiSync(want);
}

// Serialised: mutations can arrive back to back and must not interleave.
function resync() {
  const run = chain.then(doSync).catch((err) => {
    if (err.message !== state.error) logger.warn('[go2rtc] %s', err.message);
    state.error = err.message;
    if (EXTERNAL) state.running = false;
    // Covers a Pi that booted before its network (download) or a Frigate
    // box that is still starting.
    if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; resync(); }, 60000);
    retryTimer.unref?.();
  });
  chain = run;
  return run;
}

// Keep the engine up for a while without any enabled camera (setup wizard:
// test + discover before anything is saved).
async function hold(ms = 120000) {
  holdUntil = Math.max(holdUntil, Date.now() + ms);
  setTimeout(resync, ms + 1000).unref?.();
  await resync();
  if (!state.running) throw Object.assign(new Error(state.error || 'go2rtc is not running'), { code: 'engine_down' });
}

async function fetchFrame(name) {
  // cache=2s: several viewers of one camera share a single decode.
  const r = await api('GET', `/api/frame.jpeg?src=${enc(name)}&cache=2s`, 10000).catch((err) => {
    if (err.status === 404) err.code = 'no_stream';
    throw err;
  });
  const buf = Buffer.from(await r.arrayBuffer());
  // A source that fails to connect yields 200 with an empty body.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('camera returned no frame');
  return buf;
}

// One request per stream at a time; concurrent callers share the result.
function frame(name) {
  if (!inflight.has(name)) inflight.set(name, fetchFrame(name).finally(() => inflight.delete(name)));
  return inflight.get(name);
}

// Why a stream fails (connect / auth / codec), for the camera test in Settings.
async function probeError(name) {
  try {
    await api('GET', `/api/streams?src=${enc(name)}&video`, 15000);
    return null;
  } catch (err) {
    return err.detail || err.message; // e.g. "streams: dial tcp 10.0.0.9:554: i/o timeout"
  }
}

// Runs on the sync chain: the temp names look like camera ids (so a leftover
// from a crash is swept by the next sync), and a sync mid-test would do that
// sweep under the test's feet.
async function withTempStreams(streams, fn) {
  await hold();
  const run = chain.then(async () => {
    try {
      for (const [name, url] of Object.entries(streams)) {
        await api('PUT', `/api/streams?name=${enc(name)}&src=${enc(url)}`);
      }
      return await fn();
    } finally {
      for (const name of Object.keys(streams)) {
        await api('DELETE', `/api/streams?src=${enc(name)}`).catch(() => {});
      }
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function discover() {
  await hold();
  try {
    const r = await api('GET', '/api/onvif', 20000);
    return (await r.json()).sources || [];
  } catch (err) {
    if (err.status === 404) return []; // go2rtc answers 404 "no sources"
    throw err;
  }
}

// H.264 only: Chromium cannot decode H.265, and the <video> is muted anyway.
function streamUrl(name) {
  return `${BASE}/api/stream.mp4?src=${enc(name)}&video=h264`;
}

function status() {
  return { running: state.running, external: Boolean(EXTERNAL), error: state.error };
}

function init(opts) {
  logger = opts.logger || logger;
  getStreams = opts.getStreams;
  // Also on process.exit() paths (uncaughtException) so no orphan keeps :1984.
  process.on('exit', () => { if (child) try { child.kill(); } catch { /* gone */ } });
  return resync();
}

module.exports = {
  init, resync, stop, status, frame, probeError, withTempStreams, discover, streamUrl, yamlConfig,
};
