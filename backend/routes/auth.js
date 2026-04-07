'use strict';

const { Router } = require('express');
const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SPOTIFY_ME_ENDPOINT = 'https://api.spotify.com/v1/me';

function googleRedirectUri(req) {
  const proto = req.protocol;
  const host = req.get('host');
  return `${proto}://${host}/api/auth/callback`;
}

function spotifyRedirectUri(req) {
  const proto = req.protocol;
  const host = req.get('host');
  return `${proto}://${host}/api/auth/spotify/callback`;
}

// ---------------------------------------------------------------------------
// Token storage helpers (exported for reuse by other routes)
// ---------------------------------------------------------------------------

/**
 * Persist tokens for a provider + email pair.
 */
function storeTokens(db, provider, email, tokens) {
  db.prepare(
    `INSERT OR REPLACE INTO tokens (provider, email, access_token, refresh_token, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    provider,
    email,
    tokens.access_token,
    tokens.refresh_token || null,
    tokens.expires_at || null
  );
}

/**
 * Retrieve tokens for a given provider + email.
 */
function getTokens(db, provider, email) {
  return db
    .prepare('SELECT * FROM tokens WHERE provider = ? AND email = ?')
    .get(provider, email);
}

/**
 * Retrieve all accounts for a given provider.
 */
function getAccountsByProvider(db, provider) {
  return db.prepare('SELECT * FROM tokens WHERE provider = ?').all(provider);
}

/**
 * Refresh a Google access token using the stored refresh token.
 * Returns the new access_token or throws.
 */
async function refreshGoogleToken(db, email, logger) {
  const row = getTokens(db, 'google', email);
  if (!row || !row.refresh_token) {
    throw new Error(`No refresh token for Google account ${email}`);
  }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: row.refresh_token,
    grant_type: 'refresh_token',
  });

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  storeTokens(db, 'google', email, {
    access_token: data.access_token,
    refresh_token: row.refresh_token, // keep existing refresh token
    expires_at: expiresAt,
  });

  if (logger) logger.info('Refreshed Google token for %s', email);
  return data.access_token;
}

/**
 * Get a valid Google access token, refreshing if necessary.
 */
async function getValidGoogleToken(db, email, logger) {
  const row = getTokens(db, 'google', email);
  if (!row) throw new Error(`No Google tokens for ${email}`);

  // Refresh if within 5 minutes of expiry
  if (row.expires_at && Date.now() > row.expires_at - 5 * 60 * 1000) {
    return refreshGoogleToken(db, email, logger);
  }
  return row.access_token;
}

/**
 * Refresh a Spotify access token.
 */
async function refreshSpotifyToken(db, email, logger) {
  const row = getTokens(db, 'spotify', email);
  if (!row || !row.refresh_token) {
    throw new Error(`No refresh token for Spotify account ${email}`);
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  });

  const credentials = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  storeTokens(db, 'spotify', email, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || row.refresh_token,
    expires_at: expiresAt,
  });

  if (logger) logger.info('Refreshed Spotify token for %s', email);
  return data.access_token;
}

/**
 * Get a valid Spotify access token, refreshing if necessary.
 */
async function getValidSpotifyToken(db, logger) {
  const rows = getAccountsByProvider(db, 'spotify');
  if (rows.length === 0) throw new Error('No Spotify account linked');

  const row = rows[0];
  if (row.expires_at && Date.now() > row.expires_at - 5 * 60 * 1000) {
    return refreshSpotifyToken(db, row.email, logger);
  }
  return row.access_token;
}

// ---------------------------------------------------------------------------
// Google OAuth routes
// ---------------------------------------------------------------------------

// GET /api/auth/google/url — return the consent URL
router.get('/google/url', (req, res) => {
  const { GOOGLE_CLIENT_ID } = process.env;
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google OAuth not configured' });
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(req),
    response_type: 'code',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/tasks',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });

  res.json({ url: `${GOOGLE_AUTH_ENDPOINT}?${params}` });
});

// GET /api/auth/callback — Google OAuth callback
router.get('/callback', async (req, res) => {
  const { code, error: oauthError } = req.query;
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const io = req.app.locals.io;

  if (oauthError) {
    logger.error('Google OAuth error: %s', oauthError);
    return res.status(400).json({ error: oauthError });
  }
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(req),
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      logger.error('Google token exchange failed: %s', text);
      return res.status(502).json({ error: 'Token exchange failed' });
    }

    const tokenData = await tokenRes.json();
    const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

    // Get user info (email)
    const userRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      return res.status(502).json({ error: 'Failed to fetch user info' });
    }

    const userInfo = await userRes.json();
    const email = userInfo.email;

    storeTokens(db, 'google', email, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
    });

    logger.info('Google account linked: %s', email);

    // Emit socket event
    if (io) {
      io.emit('auth:google:linked', { email, name: userInfo.name });
    }

    // Redirect back to the frontend settings page
    const frontendUrl =
      process.env.NODE_ENV !== 'production'
        ? 'http://localhost:3000/settings?google=linked'
        : '/settings?google=linked';

    res.redirect(frontendUrl);
  } catch (err) {
    logger.error('Google OAuth callback error: %s', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/google/accounts — list linked Google accounts
router.get('/google/accounts', (req, res) => {
  const db = req.app.locals.db;
  const accounts = getAccountsByProvider(db, 'google').map((row) => ({
    email: row.email,
    hasRefreshToken: !!row.refresh_token,
    expiresAt: row.expires_at,
  }));
  res.json({ accounts });
});

// DELETE /api/auth/google/:email — remove a linked Google account
router.delete('/google/:email', (req, res) => {
  const db = req.app.locals.db;
  const { email } = req.params;

  const result = db
    .prepare('DELETE FROM tokens WHERE provider = ? AND email = ?')
    .run('google', email);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Account not found' });
  }

  const io = req.app.locals.io;
  if (io) io.emit('auth:google:unlinked', { email });

  req.app.locals.logger.info('Google account removed: %s', email);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Spotify OAuth routes
// ---------------------------------------------------------------------------

// GET /api/auth/spotify/url
router.get('/spotify/url', (req, res) => {
  const { SPOTIFY_CLIENT_ID } = process.env;
  if (!SPOTIFY_CLIENT_ID) {
    return res.status(503).json({ error: 'Spotify OAuth not configured' });
  }

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri(req),
    scope: [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'streaming',
    ].join(' '),
  });

  res.json({ url: `${SPOTIFY_AUTH_ENDPOINT}?${params}` });
});

// GET /api/auth/spotify/callback
router.get('/spotify/callback', async (req, res) => {
  const { code, error: oauthError } = req.query;
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const io = req.app.locals.io;

  if (oauthError) {
    logger.error('Spotify OAuth error: %s', oauthError);
    return res.status(400).json({ error: oauthError });
  }
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const credentials = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: spotifyRedirectUri(req),
    });

    const tokenRes = await fetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: tokenBody,
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      logger.error('Spotify token exchange failed: %s', text);
      return res.status(502).json({ error: 'Token exchange failed' });
    }

    const tokenData = await tokenRes.json();
    const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;

    // Get user profile (email)
    const meRes = await fetch(SPOTIFY_ME_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const meData = meRes.ok ? await meRes.json() : { id: 'unknown' };
    const email = meData.email || meData.id;

    storeTokens(db, 'spotify', email, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
    });

    logger.info('Spotify account linked: %s', email);

    if (io) {
      io.emit('auth:spotify:linked', { email, displayName: meData.display_name });
    }

    const frontendUrl =
      process.env.NODE_ENV !== 'production'
        ? 'http://localhost:3000/settings?spotify=linked'
        : '/settings?spotify=linked';

    res.redirect(frontendUrl);
  } catch (err) {
    logger.error('Spotify OAuth callback error: %s', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = router;

// Named exports for token utilities used by other route modules
module.exports.getValidGoogleToken = getValidGoogleToken;
module.exports.getValidSpotifyToken = getValidSpotifyToken;
module.exports.getAccountsByProvider = getAccountsByProvider;
module.exports.refreshGoogleToken = refreshGoogleToken;
module.exports.refreshSpotifyToken = refreshSpotifyToken;
