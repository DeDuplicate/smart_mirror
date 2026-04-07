'use strict';

const { Router } = require('express');
const { execFile } = require('child_process');
const os = require('os');
const router = Router();

const IS_LINUX = os.platform() === 'linux';

// ---------------------------------------------------------------------------
// Safe shell helper - uses execFile (no shell injection risk)
// ---------------------------------------------------------------------------
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: '', stderr: err.message });
      } else {
        resolve({ ok: true, stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
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
    const result = await run('nmcli', [
      '-t', '-f', 'GENERAL.CONNECTION,GENERAL.STATE,WIRED-PROPERTIES.CARRIER',
      'device', 'show', 'wlan0',
    ]);

    if (!result.ok) {
      // Try alternative approach
      const altResult = await run('nmcli', ['-t', '-f', 'active,ssid,signal,freq,security', 'device', 'wifi']);
      if (!altResult.ok) {
        return res.json({ connected: false, error: 'Unable to query WiFi status' });
      }

      const activeLine = altResult.stdout.split('\n').find((l) => l.startsWith('yes:'));
      if (!activeLine) {
        return res.json({ connected: false });
      }

      const parts = activeLine.split(':');
      return res.json({
        connected: true,
        ssid: parts[1] || '',
        signal: parseInt(parts[2], 10) || 0,
        frequency: parts[3] || '',
        security: parts[4] || '',
      });
    }

    // Parse nmcli device show output
    const lines = result.stdout.split('\n');
    const status = {};
    for (const line of lines) {
      const [key, ...vals] = line.split(':');
      if (key && vals.length) {
        status[key.trim()] = vals.join(':').trim();
      }
    }

    res.json({
      connected: !!status['GENERAL.CONNECTION'],
      ssid: status['GENERAL.CONNECTION'] || null,
      state: status['GENERAL.STATE'] || null,
    });
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
        const parts = line.split(':');
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

    const result = await run('nmcli', args);

    if (!result.ok) {
      logger.error('WiFi connect failed: %s', result.stderr);
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
