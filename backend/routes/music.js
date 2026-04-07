'use strict';

const { Router } = require('express');
const router = Router();

const { getValidSpotifyToken } = require('./auth');

const SPOTIFY_API = 'https://api.spotify.com/v1/me/player';

// ---------------------------------------------------------------------------
// Helper: make an authenticated Spotify API request
// ---------------------------------------------------------------------------
async function spotifyFetch(db, logger, path, options = {}) {
  const token = await getValidSpotifyToken(db, logger);
  const url = path.startsWith('http') ? path : `${SPOTIFY_API}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // 204 = success with no body (common for Spotify control endpoints)
  if (response.status === 204) return { ok: true };
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify API ${response.status}: ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET /api/music/state — current playback state
// ---------------------------------------------------------------------------
router.get('/state', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const data = await spotifyFetch(db, logger, '');
    res.json(data);
  } catch (err) {
    logger.error('Music state error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/music/play — resume / start playback
// ---------------------------------------------------------------------------
router.post('/play', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const body = {};
    if (req.body.context_uri) body.context_uri = req.body.context_uri;
    if (req.body.uris) body.uris = req.body.uris;
    if (req.body.offset) body.offset = req.body.offset;

    await spotifyFetch(db, logger, '/play', {
      method: 'PUT',
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    });

    logger.info('Music: play');
    res.json({ ok: true });
  } catch (err) {
    logger.error('Music play error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/music/pause
// ---------------------------------------------------------------------------
router.post('/pause', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    await spotifyFetch(db, logger, '/pause', { method: 'PUT' });
    logger.info('Music: pause');
    res.json({ ok: true });
  } catch (err) {
    logger.error('Music pause error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/music/next
// ---------------------------------------------------------------------------
router.post('/next', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    await spotifyFetch(db, logger, '/next', { method: 'POST' });
    logger.info('Music: next');
    res.json({ ok: true });
  } catch (err) {
    logger.error('Music next error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/music/prev
// ---------------------------------------------------------------------------
router.post('/prev', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    await spotifyFetch(db, logger, '/previous', { method: 'POST' });
    logger.info('Music: previous');
    res.json({ ok: true });
  } catch (err) {
    logger.error('Music prev error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/music/shuffle — toggle shuffle { state: true|false }
// ---------------------------------------------------------------------------
router.post('/shuffle', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const state = req.body.state !== undefined ? req.body.state : true;
    await spotifyFetch(db, logger, `/shuffle?state=${state}`, { method: 'PUT' });
    logger.info('Music: shuffle %s', state);
    res.json({ ok: true, shuffle: state });
  } catch (err) {
    logger.error('Music shuffle error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/music/repeat — set repeat { state: track|context|off }
// ---------------------------------------------------------------------------
router.post('/repeat', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const state = req.body.state || 'off';
    await spotifyFetch(db, logger, `/repeat?state=${state}`, { method: 'PUT' });
    logger.info('Music: repeat %s', state);
    res.json({ ok: true, repeat: state });
  } catch (err) {
    logger.error('Music repeat error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/music/volume — set volume { volume_percent: 0-100 }
// ---------------------------------------------------------------------------
router.post('/volume', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const vol = Math.max(0, Math.min(100, parseInt(req.body.volume_percent, 10) || 50));
    await spotifyFetch(db, logger, `/volume?volume_percent=${vol}`, { method: 'PUT' });
    logger.info('Music: volume %d%%', vol);
    res.json({ ok: true, volume_percent: vol });
  } catch (err) {
    logger.error('Music volume error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/music/queue — current queue
// ---------------------------------------------------------------------------
router.get('/queue', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const data = await spotifyFetch(db, logger, '/queue');
    res.json(data);
  } catch (err) {
    logger.error('Music queue error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
