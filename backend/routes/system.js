'use strict';

const { Router } = require('express');
const express = require('express');
const Database = require('better-sqlite3');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const router = Router();

const IS_LINUX = os.platform() === 'linux';
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');
const LOGS_DIR = path.join(__dirname, '..', 'logs');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

const { runMigrations } = require('../db/migrate');

// PM2 process name for this backend — must match apps[].name for the backend
// entry in ecosystem.config.js at the repo root.
const PM2_APP_NAME = 'mirror-backend';

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

  // Check Spotify — credentials may live in .env or in the settings table
  const { getSpotifyCredentials } = require('./auth');
  const spotifyCreds = getSpotifyCredentials(db);
  const spotifyAccounts = db.prepare("SELECT COUNT(*) AS cnt FROM tokens WHERE provider = 'spotify'").get();
  health.integrations.spotify = {
    configured: Boolean(spotifyCreds.clientId),
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
  const raw = req.body.value ?? req.body.brightness;
  const parsed = parseInt(raw, 10);
  const value = Math.max(0, Math.min(100, Number.isNaN(parsed) ? 50 : parsed));

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
router.post('/backup', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  try {
    // Backup SQLite database using backup API (returns a Promise — must await
    // it or a failed backup rejects with nothing to catch it)
    const backupPath = path.join(BACKUP_DIR, 'smart-mirror-' + timestamp + '.db');
    await db.backup(backupPath);

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

    res.json({ ok: true, path: backupPath, file: path.basename(backupPath), date: new Date().toISOString(), timestamp });
  } catch (err) {
    logger.error('Backup error: %s', err.message);
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/system/backup/download/:file - download a backup file to the browser
// ---------------------------------------------------------------------------
router.get('/backup/download/:file', (req, res) => {
  const logger = req.app.locals.logger;
  const requested = req.params.file || '';

  // Only allow our own backup files; reject anything with path separators or
  // traversal so an attacker can't read arbitrary files off disk.
  if (!/^smart-mirror-[\w.-]+\.db$/.test(requested)) {
    return res.status(400).json({ error: 'Invalid backup filename' });
  }

  const filePath = path.join(BACKUP_DIR, requested);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep) || !fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'Backup not found' });
  }

  res.download(resolved, requested, (err) => {
    if (err && !res.headersSent) {
      logger.error('Backup download error: %s', err.message);
      res.status(500).end();
    }
  });
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

  // Hardcoded command string — no user input, safe to use exec for shell chaining.
  // Backend deps are installed too: a pulled commit may add a backend dependency
  // (the frontend-only install here previously left those missing).
  const cmd =
    'git pull origin main && cd backend && npm install && cd ../frontend && npm install && npx vite build';

  logger.info('Starting update: %s', cmd);

  exec(cmd, { cwd: PROJECT_ROOT, timeout: 300000 }, (err, stdout) => {
    if (err) {
      logger.error('Update failed: %s', err.message);
      return res.json({ success: false, message: err.message });
    }

    logger.info('Update completed successfully — restarting to load the new code');

    // Respond BEFORE restarting: the restart kills this very process, so the
    // client has to receive its response first. Without this restart the pulled
    // code sits on disk but the running process keeps serving the old version,
    // which made the update look like it had silently done nothing.
    res.json({
      success: true,
      restarting: true,
      message: stdout.toString().slice(-500),
    });

    setTimeout(() => {
      run('pm2', ['restart', PM2_APP_NAME], 15000).then((result) => {
        if (!result.ok) {
          logger.error('Post-update restart failed: %s', result.stderr);
        }
      });
    }, 500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/system/restart - restart the PM2-managed backend app process
// ---------------------------------------------------------------------------
router.post('/restart', (req, res) => {
  const logger = req.app.locals.logger;

  logger.info('App restart requested — issuing "pm2 restart %s" shortly', PM2_APP_NAME);

  // Respond before executing: "pm2 restart" kills this very process, so the
  // client must receive its response before that happens.
  res.json({ ok: true, message: 'Restarting app...' });

  setTimeout(() => {
    run('pm2', ['restart', PM2_APP_NAME], 15000).then((result) => {
      if (!result.ok) {
        logger.error('App restart failed: %s', result.stderr);
      } else {
        logger.info('App restart command completed: %s', result.stdout.trim());
      }
    });
  }, 500);
});

// ---------------------------------------------------------------------------
// POST /api/system/reboot - reboot the underlying Raspberry Pi
// ---------------------------------------------------------------------------
router.post('/reboot', (req, res) => {
  const logger = req.app.locals.logger;

  if (!IS_LINUX) {
    logger.info('Pi reboot requested but not running on Linux — no-op (dev mode)');
    return res.json({ ok: true, mock: true, message: 'Reboot skipped — not running on Raspberry Pi hardware' });
  }

  logger.warn('Pi reboot requested — issuing "sudo reboot" shortly');

  // Respond before executing: rebooting kills this very process, so the
  // client must receive its response before that happens.
  res.json({ ok: true, message: 'Rebooting Pi...' });

  setTimeout(() => {
    run('sudo', ['reboot'], 15000).then((result) => {
      if (!result.ok) {
        logger.error('Pi reboot command failed: %s', result.stderr);
      }
    });
  }, 500);
});

// ---------------------------------------------------------------------------
// POST /api/system/reset - factory reset: wipe and re-initialize the database.
// Takes a safety backup first, drops every table, re-runs all migrations, and
// preserves the device API token so already-authorized clients keep working.
// ---------------------------------------------------------------------------
router.post('/reset', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    // 1. Safety backup before the destructive wipe (best-effort).
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await db.backup(path.join(BACKUP_DIR, 'pre-reset-' + timestamp + '.db'));
      logger.info('Pre-reset backup created');
    } catch (bkErr) {
      logger.warn('Pre-reset backup failed (continuing with reset): %s', bkErr.message);
    }

    // 2. Preserve the device API token so remote clients stay authorized.
    let apiToken = null;
    try {
      apiToken = db.prepare("SELECT value FROM config WHERE key = 'api_token'").get()?.value || null;
    } catch { /* config table may be missing — ignore */ }

    // 3. Drop every user table (FK checks off so drop order doesn't matter).
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all();

    db.pragma('foreign_keys = OFF');
    const wipe = db.transaction(() => {
      for (const { name } of tables) {
        db.exec(`DROP TABLE IF EXISTS "${name}"`);
      }
    });
    wipe();
    db.pragma('foreign_keys = ON');

    // 4. Recreate the schema from scratch.
    runMigrations(db, logger);

    // 5. Restore the preserved API token.
    if (apiToken) {
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('api_token', ?)").run(apiToken);
    }

    // Flush the WAL so the shrunken database is fully materialized on disk.
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* non-fatal */ }

    logger.warn('Device reset complete — database wiped and re-initialized');

    const io = req.app.locals.io;
    if (io) io.emit('system:reset');

    res.json({ ok: true, message: 'Device reset complete' });
  } catch (err) {
    logger.error('Device reset failed: %s', err.message);
    res.status(500).json({ error: 'Reset failed: ' + err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/system/restore - restore the database from an uploaded .db file.
// The file is sent as a raw binary body (application/octet-stream). We validate
// it is a genuine SQLite database that looks like one of our backups, take a
// safety backup of the current data, then copy every table from the uploaded
// file into the live connection. The device API token is preserved so already-
// authorized clients keep working after the restore.
// ---------------------------------------------------------------------------
router.post('/restore', express.raw({ type: '*/*', limit: '64mb' }), async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const io = req.app.locals.io;

  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Validate the SQLite header magic ("SQLite format 3\0").
  const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
  if (buf.length < 16 || !buf.subarray(0, 16).equals(SQLITE_MAGIC)) {
    return res.status(400).json({ error: 'Not a valid SQLite database file' });
  }

  const uploadPath = path.join(os.tmpdir(), 'restore-upload-' + Date.now() + '.db');

  try {
    fs.writeFileSync(uploadPath, buf);

    // Validate the uploaded db: it must open, pass an integrity check, and
    // contain the config table (proof it is a Smart Mirror backup).
    let srcTableCount = 0;
    {
      const src = new Database(uploadPath, { readonly: true });
      try {
        const integrity = src.pragma('integrity_check', { simple: true });
        if (integrity !== 'ok') throw new Error('integrity check failed');
        const names = src
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all()
          .map((r) => r.name);
        if (!names.includes('config')) {
          throw new Error('not a Smart Mirror backup (missing config table)');
        }
        srcTableCount = names.length;
      } finally {
        src.close();
      }
    }

    // Safety backup of the CURRENT database before overwriting it.
    try {
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await db.backup(path.join(BACKUP_DIR, 'pre-restore-' + ts + '.db'));
      logger.info('Pre-restore backup created');
    } catch (bkErr) {
      logger.warn('Pre-restore backup failed (continuing): %s', bkErr.message);
    }

    // Preserve the current device API token so remote clients stay authorized.
    let apiToken = null;
    try {
      apiToken = db.prepare("SELECT value FROM config WHERE key = 'api_token'").get()?.value || null;
    } catch { /* config table may be missing — ignore */ }

    // Copy the uploaded database into the live connection. ATTACH cannot run
    // inside a transaction, so attach/detach bracket the transactional copy.
    db.pragma('foreign_keys = OFF');
    db.exec(`ATTACH DATABASE '${uploadPath.replace(/'/g, "''")}' AS restore`);
    try {
      const copy = db.transaction(() => {
        // Drop everything in the live db. Dropping a table also drops its
        // indexes/triggers; drop any stray views explicitly too.
        const existing = db
          .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
          .all();
        for (const o of existing) db.exec(`DROP ${o.type} IF EXISTS "${o.name}"`);

        // Recreate schema + data from the attached backup.
        const objs = db
          .prepare("SELECT name, type, sql FROM restore.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
          .all();
        for (const o of objs.filter((o) => o.type === 'table')) db.exec(o.sql);
        for (const o of objs.filter((o) => o.type === 'table')) {
          db.exec(`INSERT INTO main."${o.name}" SELECT * FROM restore."${o.name}"`);
        }
        for (const o of objs.filter((o) => o.type !== 'table')) {
          try { db.exec(o.sql); } catch { /* non-fatal index/trigger/view */ }
        }
      });
      copy();
    } finally {
      db.exec('DETACH DATABASE restore');
      db.pragma('foreign_keys = ON');
    }

    // Bring the schema up to date in case the backup is from an older version.
    runMigrations(db, logger);

    // Restore the preserved API token so this device stays authorized.
    if (apiToken) {
      db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('api_token', ?)").run(apiToken);
    }

    // Flush the WAL so the restored database is fully materialized on disk.
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* non-fatal */ }

    logger.warn('Database restored from uploaded backup (%d tables)', srcTableCount);
    if (io) io.emit('system:reset');

    res.json({ ok: true, message: 'Restore complete', tables: srcTableCount });
  } catch (err) {
    logger.error('Restore failed: %s', err.message);
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  } finally {
    try { fs.unlinkSync(uploadPath); } catch { /* ignore */ }
  }
});

module.exports = router;
