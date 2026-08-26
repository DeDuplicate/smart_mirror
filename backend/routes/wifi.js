'use strict';

const { Router } = require('express');
const { execFile } = require('child_process');
const os = require('os');
const router = Router();

const IS_LINUX = os.platform() === 'linux';

// ---------------------------------------------------------------------------
// Safe shell helper - uses execFile (no shell injection risk)
// ---------------------------------------------------------------------------
function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: '', stderr: (stderr || err.message).toString() });
      } else {
        resolve({ ok: true, stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

// Split a line of `nmcli -t` output on unescaped colons and unescape values.
// nmcli terse mode escapes ':' and '\' inside values (e.g. SSIDs) as '\:' '\\'.
function splitTerse(line) {
  const fields = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      cur += line[++i];
    } else if (ch === ':') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

// Find the wifi interface name (usually wlan0 on the Pi, but don't assume)
async function getWifiDevice() {
  const result = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE', 'device']);
  if (result.ok) {
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      const [device, type] = splitTerse(line);
      if (type === 'wifi') return device;
    }
  }
  return 'wlan0';
}

// ---------------------------------------------------------------------------
// Mock data for non-Linux development
// ---------------------------------------------------------------------------
const MOCK_STATUS = {
  connected: true,
  ssid: 'MockNetwork',
  signal: 85,
  frequency: '5 GHz',
  ip: '192.168.1.42',
  mac: 'AA:BB:CC:DD:EE:FF',
  mock: true,
};

const MOCK_NETWORKS = [
  { ssid: 'HomeWiFi', signal: 92, security: 'WPA2', frequency: '5 GHz' },
  { ssid: 'Neighbor-5G', signal: 45, security: 'WPA2', frequency: '5 GHz' },
  { ssid: 'OpenNetwork', signal: 60, security: 'Open', frequency: '2.4 GHz' },
  { ssid: 'IoT-Network', signal: 78, security: 'WPA', frequency: '2.4 GHz' },
];

// ---------------------------------------------------------------------------
// GET /api/wifi/status - current connection
// ---------------------------------------------------------------------------
router.get('/status', async (req, res) => {
  const logger = req.app.locals.logger;

  if (!IS_LINUX) {
    return res.json(MOCK_STATUS);
  }

  try {
    // Active wifi connection: ssid/signal/freq/security
    const wifiResult = await run('nmcli', [
      '-t', '-f', 'ACTIVE,SSID,SIGNAL,FREQ,SECURITY', 'device', 'wifi', 'list',
    ]);

    if (!wifiResult.ok) {
      return res.json({ connected: false, error: 'Unable to query WiFi status' });
    }

    const activeLine = wifiResult.stdout
      .split('\n')
      .filter(Boolean)
      .map(splitTerse)
      .find((parts) => parts[0] === 'yes');

    if (!activeLine) {
      return res.json({ connected: false });
    }

    const status = {
      connected: true,
      ssid: activeLine[1] || '',
      signal: parseInt(activeLine[2], 10) || 0,
      frequency: activeLine[3] || '',
      security: activeLine[4] || '',
    };

    // Best-effort: add IP + MAC of the wifi interface
    const device = await getWifiDevice();
    const devResult = await run('nmcli', [
      '-t', '-f', 'IP4.ADDRESS,GENERAL.HWADDR', 'device', 'show', device,
    ]);
    if (devResult.ok) {
      for (const line of devResult.stdout.split('\n').filter(Boolean)) {
        const [key, ...vals] = splitTerse(line);
        const val = vals.join(':').trim();
        if (key.startsWith('IP4.ADDRESS') && val) status.ip = val.split('/')[0];
        if (key === 'GENERAL.HWADDR' && val) status.mac = val;
      }
    }

    res.json(status);
  } catch (err) {
    logger.error('WiFi status error: %s', err.message);
    res.status(500).json({ error: 'Failed to query WiFi status' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/wifi/scan - available networks
// ---------------------------------------------------------------------------
router.get('/scan', async (req, res) => {
  const logger = req.app.locals.logger;

  if (!IS_LINUX) {
    return res.json({ networks: MOCK_NETWORKS, mock: true });
  }

  try {
    // Trigger a rescan first
    await run('nmcli', ['device', 'wifi', 'rescan']);

    const result = await run('nmcli', [
      '-t', '-f', 'SSID,SIGNAL,SECURITY,FREQ', 'device', 'wifi', 'list',
    ]);

    if (!result.ok) {
      return res.status(500).json({ error: 'WiFi scan failed' });
    }

    const seen = new Set();
    const networks = result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = splitTerse(line);
        const ssid = parts[0] || '';
        if (!ssid || seen.has(ssid)) return null;
        seen.add(ssid);
        return {
          ssid,
          signal: parseInt(parts[1], 10) || 0,
          security: parts[2] || 'Open',
          frequency: parts[3] || '',
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.signal - a.signal);

    res.json({ networks });
  } catch (err) {
    logger.error('WiFi scan error: %s', err.message);
    res.status(500).json({ error: 'WiFi scan failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/wifi/connect - connect to network { ssid, password }
// ---------------------------------------------------------------------------
router.post('/connect', async (req, res) => {
  const logger = req.app.locals.logger;
  const { ssid, password } = req.body;

  if (!ssid) {
    return res.status(400).json({ error: 'SSID is required' });
  }

  if (!IS_LINUX) {
    return res.json({ ok: true, message: 'Mock: connected to ' + ssid, mock: true });
  }

  try {
    const args = ['device', 'wifi', 'connect', ssid];
    if (password) {
      args.push('password', password);
    }

    // Connecting can take a while (scan + DHCP) — allow up to 45s
    const result = await run('nmcli', args, 45000);

    if (!result.ok) {
      logger.error('WiFi connect failed: %s', result.stderr);
      // nmcli leaves a broken saved profile behind on a failed connect
      // (e.g. wrong password), which makes every retry fail — clean it up.
      await run('nmcli', ['connection', 'delete', ssid]);
      return res.status(500).json({ error: 'Failed to connect: ' + result.stderr });
    }

    logger.info('WiFi connected to %s', ssid);
    res.json({ ok: true, message: result.stdout.trim() });
  } catch (err) {
    logger.error('WiFi connect error: %s', err.message);
    res.status(500).json({ error: 'Failed to connect to network' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/wifi/:ssid - forget network
// ---------------------------------------------------------------------------
router.delete('/:ssid', async (req, res) => {
  const logger = req.app.locals.logger;
  const ssid = req.params.ssid;

  if (!IS_LINUX) {
    return res.json({ ok: true, message: 'Mock: forgot ' + ssid, mock: true });
  }

  try {
    const result = await run('nmcli', ['connection', 'delete', ssid]);

    if (!result.ok) {
      logger.error('WiFi forget failed: %s', result.stderr);
      return res.status(500).json({ error: 'Failed to forget: ' + result.stderr });
    }

    logger.info('WiFi network forgotten: %s', ssid);
    res.json({ ok: true, message: result.stdout.trim() });
  } catch (err) {
    logger.error('WiFi forget error: %s', err.message);
    res.status(500).json({ error: 'Failed to forget network' });
  }
});

module.exports = router;
