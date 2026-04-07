'use strict';

const { Router } = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const router = Router();

const IS_LINUX = os.platform() === 'linux';
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

// ---------------------------------------------------------------------------
// Safe shell helper - uses execFile (no shell injection risk)
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.join(__dirname, '..', '..');

function run(cmd, args, timeout, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeout || 10000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: '', stderr: err.message });
      } else {
        resolve({ ok: true, stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// GET /api/system/health - integration statuses
// ---------------------------------------------------------------------------
router.get('/health', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const health = {
    server: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    platform: os.platform(),
    nodeVersion: process.version,
    integrations: {},
  };

  // Check Google
  const googleAccounts = db.prepare("SELECT COUNT(*) AS cnt FROM tokens WHERE provider = 'google'").get();
  health.integrations.google = {
    configured: !!process.env.GOOGLE_CLIENT_ID,
    linkedAccounts: googleAccounts.cnt,
  };

  // Check Spotify
  const spotifyAccounts = db.prepare("SELECT COUNT(*) AS cnt FROM tokens WHERE provider = 'spotify'").get();
  health.integrations.spotify = {
    configured: !!process.env.SPOTIFY_CLIENT_ID,
    linkedAccounts: spotifyAccounts.cnt,
  };

  // Check Home Assistant
  health.integrations.homeAssistant = {
    configured: !!process.env.HA_TOKEN,
    host: process.env.HA_HOST || 'not set',
  };

  if (process.env.HA_TOKEN) {
    try {
      const haHost = (process.env.HA_HOST || 'http://homeassistant.local:8123').replace(/\/+$/, '');
      const haRes = await fetch(haHost + '/api/', {
        headers: { Authorization: 'Bearer ' + process.env.HA_TOKEN },
        signal: AbortSignal.timeout(5000),
      });
      health.integrations.homeAssistant.reachable = haRes.ok;
    } catch {
      health.integrations.homeAssistant.reachable = false;
    }
  }

  // Database health
  try {
    db.prepare('SELECT 1').get();
    health.database = 'ok';
  } catch {
    health.database = 'error';
  }

  res.json(health);
});

// ---------------------------------------------------------------------------
// GET /api/system/version - current version from package.json
// ---------------------------------------------------------------------------
router.get('/version', (req, res) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf-8'));
    res.json({
      version: pkg.version,
      name: pkg.name,
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read package.json' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/system/brightness - set brightness { value: 0-100 }
// ---------------------------------------------------------------------------
router.post('/brightness', async (req, res) => {
  const logger = req.app.locals.logger;
  const value = Math.max(0, Math.min(100, parseInt(req.body.value, 10) || 50));

  if (!IS_LINUX) {
    return res.json({ ok: true, brightness: value, mock: true });
  }

  // Try ddcutil first (for external monitors), then xrandr (for HDMI/DSI)
  let result = await run('ddcutil', ['setvcp', '10', String(value)]);

  if (!result.ok) {
    // Try backlight sysfs for Raspberry Pi official display
    const backlightPath = '/sys/class/backlight/rpi_backlight/brightness';
    if (fs.existsSync(backlightPath)) {
      try {
        // Convert 0-100 to 0-255 range
        const rawValue = Math.round((value / 100) * 255);
        fs.writeFileSync(backlightPath, String(rawValue));
        logger.info('Brightness set via sysfs: %d (%d raw)', value, rawValue);
        return res.json({ ok: true, brightness: value, method: 'sysfs' });
      } catch (writeErr) {
        logger.error('Sysfs brightness write failed: %s', writeErr.message);
      }
    }

    // Try xrandr as last resort
    result = await run('xrandr', [
      '--output', 'HDMI-1',
      '--brightness', String(value / 100),
    ]);

    if (!result.ok) {
      logger.warn('All brightness methods failed');
      return res.json({ ok: false, brightness: value, error: 'No supported brightness control found' });
    }

    logger.info('Brightness set via xrandr: %d', value);
    return res.json({ ok: true, brightness: value, method: 'xrandr' });
  }

  logger.info('Brightness set via ddcutil: %d', value);
  res.json({ ok: true, brightness: value, method: 'ddcutil' });
});

// ---------------------------------------------------------------------------
// GET /api/system/logs?lines=&level= - recent log entries
// ---------------------------------------------------------------------------
router.get('/logs', (req, res) => {
  const logger = req.app.locals.logger;
  const maxLines = Math.min(parseInt(req.query.lines, 10) || 100, 1000);
  const levelFilter = req.query.level || null;

  const logFile = path.join(LOGS_DIR, 'app.log');
  if (!fs.existsSync(logFile)) {
    return res.json({ entries: [], message: 'No log file found' });
  }

  try {
    const content = fs.readFileSync(logFile, 'utf-8');
    let lines = content.split('\n').filter(Boolean);

    // Parse JSON log lines (pino format)
    let entries = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { msg: line, level: 30 };
      }
    });

    // Filter by level if requested
    if (levelFilter) {
      const levelMap = { fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10 };
      const minLevel = levelMap[levelFilter] || 0;
      entries = entries.filter((e) => (e.level || 30) >= minLevel);
    }

    // Take last N entries
    entries = entries.slice(-maxLines);

    res.json({ entries, total: entries.length });
  } catch (err) {
    logger.error('Log read error: %s', err.message);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/system/backup - trigger backup of database and config
// ---------------------------------------------------------------------------
router.post('/backup', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  try {
    // Backup SQLite database using backup API
    const backupPath = path.join(BACKUP_DIR, 'smart-mirror-' + timestamp + '.db');
    db.backup(backupPath);

    // Backup .env if it exists
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const envBackupPath = path.join(BACKUP_DIR, 'env-' + timestamp + '.bak');
      fs.copyFileSync(envPath, envBackupPath);
    }

    logger.info('Backup created: %s', backupPath);

    // Clean up old backups (keep last 10)
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('smart-mirror-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (let i = 10; i < backups.length; i++) {
      fs.unlinkSync(path.join(BACKUP_DIR, backups[i]));
      // Also remove corresponding env backup
      const envBak = backups[i].replace('smart-mirror-', 'env-').replace('.db', '.bak');
      const envBakPath = path.join(BACKUP_DIR, envBak);
      if (fs.existsSync(envBakPath)) fs.unlinkSync(envBakPath);
    }

    res.json({ ok: true, path: backupPath, timestamp });
  } catch (err) {
    logger.error('Backup error: %s', err.message);
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/system/schedule - display on/off schedule
// ---------------------------------------------------------------------------
router.get('/schedule', (req, res) => {
  const db = req.app.locals.db;

  try {
    const row = db.prepare("SELECT value FROM config WHERE key = 'display_schedule'").get();
    const schedule = row ? JSON.parse(row.value) : {
      enabled: false,
      onTime: '07:00',
      offTime: '23:00',
      days: [1, 2, 3, 4, 5, 6, 0], // Mon-Sun
    };
    res.json({ schedule });
  } catch (err) {
    req.app.locals.logger.error('Schedule fetch error: %s', err.message);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/system/schedule - update display schedule
// ---------------------------------------------------------------------------
router.post('/schedule', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const schedule = req.body;
  if (!schedule || typeof schedule !== 'object') {
    return res.status(400).json({ error: 'Request body must be a schedule object' });
  }

  // Validate schedule structure
  const validated = {
    enabled: !!schedule.enabled,
    onTime: schedule.onTime || '07:00',
    offTime: schedule.offTime || '23:00',
    days: Array.isArray(schedule.days) ? schedule.days : [1, 2, 3, 4, 5, 6, 0],
  };

  try {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('display_schedule', ?)").run(
      JSON.stringify(validated)
    );

    logger.info('Display schedule updated: %s', JSON.stringify(validated));

    const io = req.app.locals.io;
    if (io) io.emit('system:schedule_updated', validated);

    res.json({ ok: true, schedule: validated });
  } catch (err) {
    logger.error('Schedule update error: %s', err.message);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/system/log - receive client-side log entries
// ---------------------------------------------------------------------------
router.post('/log', (req, res) => {
  const logger = req.app.locals.logger;
  const { level, message, stack } = req.body || {};

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  const logLevel = ['error', 'warn', 'info', 'debug'].includes(level) ? level : 'info';
  logger[logLevel]({ source: 'client', stack }, 'Client: %s', message);

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/system/check-update - compare local HEAD with remote
// ---------------------------------------------------------------------------
router.get('/check-update', async (req, res) => {
  const logger = req.app.locals.logger;
  const gitOpts = { cwd: PROJECT_ROOT };

  try {
    // Fetch latest from origin
    const fetchResult = await run('git', ['fetch', 'origin', 'main'], 15000, gitOpts);
    if (!fetchResult.ok) {
      return res.json({ updateAvailable: false, error: fetchResult.stderr });
    }

    const [localResult, remoteResult] = await Promise.all([
      run('git', ['rev-parse', 'HEAD'], 10000, gitOpts),
      run('git', ['rev-parse', 'origin/main'], 10000, gitOpts),
    ]);

    if (!localResult.ok || !remoteResult.ok) {
      return res.json({ updateAvailable: false, error: 'Failed to get commit hashes' });
    }

    const currentHash = localResult.stdout.trim();
    const remoteHash = remoteResult.stdout.trim();

    // Count commits behind
    const behindResult = await run('git', ['rev-list', '--count', 'HEAD..origin/main'], 10000, gitOpts);
    const behindBy = behindResult.ok ? parseInt(behindResult.stdout.trim(), 10) || 0 : 0;

    res.json({
      updateAvailable: currentHash !== remoteHash,
      currentHash,
      remoteHash,
      behindBy,
    });
  } catch (err) {
    logger.error('Check-update error: %s', err.message);
    res.json({ updateAvailable: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/system/update - pull latest and rebuild
// ---------------------------------------------------------------------------
router.post('/update', (req, res) => {
  const logger = req.app.locals.logger;
  const { exec } = require('child_process');

  // Hardcoded command string — no user input, safe to use exec for shell chaining
  const cmd = 'git pull origin main && cd frontend && npm install && npx vite build';

  logger.info('Starting update: %s', cmd);

  exec(cmd, { cwd: PROJECT_ROOT, timeout: 300000 }, (err, stdout, stderr) => {
    if (err) {
      logger.error('Update failed: %s', err.message);
      return res.json({ success: false, message: err.message });
    }

    logger.info('Update completed successfully');
    res.json({ success: true, message: stdout.toString().slice(-500) });
  });
});

module.exports = router;
