'use strict';

const { Router } = require('express');
const router = Router();

// ---------------------------------------------------------------------------
// GET /api/settings - all settings from config table
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const db = req.app.locals.db;

  try {
    const rows = db.prepare('SELECT key, value FROM config').all();
    const settings = {};
    for (const row of rows) {
      // Skip internal keys
      if (row.key === 'api_token') continue;
      // Try to parse JSON values, fall back to raw string
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    res.json({ settings });
  } catch (err) {
    req.app.locals.logger.error('Settings fetch error: %s', err.message);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings - bulk update settings
// ---------------------------------------------------------------------------
router.put('/', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  try {
    const upsert = db.prepare(
      'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'
    );

    const runBatch = db.transaction((entries) => {
      for (const [key, value] of entries) {
        // Prevent overwriting the API token via settings endpoint
        if (key === 'api_token') continue;
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        upsert.run(key, serialized);
      }
    });

    runBatch(Object.entries(updates));
    logger.info('Settings bulk updated (%d keys)', Object.keys(updates).length);

    // Notify clients
    const io = req.app.locals.io;
    if (io) io.emit('settings:updated', updates);

    res.json({ ok: true, updated: Object.keys(updates).length });
  } catch (err) {
    logger.error('Settings bulk update error: %s', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/:key - update a single setting
// ---------------------------------------------------------------------------
router.put('/:key', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const { key } = req.params;

  if (key === 'api_token') {
    return res.status(403).json({ error: 'Cannot modify api_token via this endpoint' });
  }

  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ error: 'Request body must contain a "value" field' });
  }

  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(
      key,
      serialized
    );

    logger.info('Setting updated: %s', key);

    const io = req.app.locals.io;
    if (io) io.emit('settings:updated', { [key]: value });

    res.json({ ok: true, key, value });
  } catch (err) {
    logger.error('Setting update error: %s', err.message);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

module.exports = router;
