'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const router = Router();

// ---------------------------------------------------------------------------
// Token encryption (AES-256-GCM)
// ---------------------------------------------------------------------------
const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // 96-bit IV recommended for GCM

/**
 * Derive (or retrieve) the 256-bit encryption key used for token storage.
 * Priority: TOKEN_SECRET env var > config table > auto-generate and persist.
 * The key is derived via SHA-256 so any-length secret becomes 32 bytes.
 */
let _encKeyCache = null;
function getEncryptionKey(db) {
  if (_encKeyCache) return _encKeyCache;

  let secret = process.env.TOKEN_SECRET;

  if (!secret) {
    // Try config table
    const row = db
      .prepare("SELECT value FROM config WHERE key = 'token_secret'")
      .get();
    if (row) {
      secret = row.value;
    } else {
      // Auto-generate and persist
      secret = crypto.randomBytes(32).toString('hex');
      db.prepare(
        "INSERT INTO config (key, value) VALUES ('token_secret', ?)"
      ).run(secret);
    }
  }

  _encKeyCache = crypto.createHash('sha256').update(secret).digest();
  return _encKeyCache;
}

/**
 * Encrypt a plaintext string.
 * Returns "iv:authTag:ciphertext" as hex-encoded segments.
 */
function encryptToken(db, plaintext) {
  if (!plaintext) return plaintext;
  const key = getEncryptionKey(db);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a token previously encrypted by encryptToken().
 * Backward compatible: if the value has no ":" separators, return as-is (plaintext).
 */
function decryptToken(db, encrypted) {
  if (!encrypted) return encrypted;
  // Backward compat: plaintext tokens won't contain ":"
  if (!encrypted.includes(':')) return encrypted;

  const parts = encrypted.split(':');
  if (parts.length !== 3) return encrypted; // not our format, treat as plaintext

  const [ivHex, tagHex, cipherHex] = parts;
  try {
    const key = getEncryptionKey(db);
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Decryption failed — value may actually be plaintext that coincidentally
    // contained colons (very unlikely for OAuth tokens, but safe fallback).
    return encrypted;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SPOTIFY_ME_ENDPOINT = 'https://api.spotify.com/v1/me';

function getConfigValue(db, key) {
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    if (!row || row.value == null) return '';
    try {
      const parsed = JSON.parse(row.value);
      return typeof parsed === 'string' ? parsed : String(row.value);
    } catch {
      return String(row.value);
    }
  } catch {
    return '';
  }
}

function getSpotifyCredentials(db) {
  const clientId = (
    process.env.SPOTIFY_CLIENT_ID ||
    getConfigValue(db, 'spotifyClientId') ||
    ''
  ).trim();
  const clientSecret = (
    process.env.SPOTIFY_CLIENT_SECRET ||
    getConfigValue(db, 'spotifyClientSecret') ||
    ''
  ).trim();
  return { clientId, clientSecret };
}

function spotifyRedirectUri(req) {
  if (process.env.SPOTIFY_REDIRECT_URI) {
    return process.env.SPOTIFY_REDIRECT_URI;
  }
  const proto = req.protocol;
  const host = req.get('host');
  return `${proto}://${host}/api/auth/spotify/callback`;
}

function frontendReturnUrl(req, query) {
  const qs = query ? `?${query}` : '';
  if (process.env.NODE_ENV !== 'production') {
    return `http://localhost:3000/${qs}`;
  }
  const proto = req.protocol;
  const host = req.get('host');
  // Callback hits /api/... — send the user back to the app root, not the API path.
  return `${proto}://${host}/${qs}`;
}

/**
 * Render a minimal, self-closing HTML page for the OAuth popup window.
 * The popup was opened by useAuth's window.open() call, so window.close()
 * is allowed. The real-time connection status update reaches the main app
 * window via the Socket.io "auth:*:linked" event, not this page — this is
 * just a friendly confirmation for the tiny popup itself.
 */
function renderPopupResultPage({ success, title, message, continueUrl = '/' }) {
  const color = success ? '#2ab58a' : '#e0625a';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f5f7; color: #1a1c2e;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { text-align: center; padding: 32px; max-width: 360px; }
  .dot { width: 48px; height: 48px; border-radius: 50%; background: ${color}22; color: ${color};
         display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 24px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #7b7f9e; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="dot">${success ? '✓' : '✕'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
  <script>
    setTimeout(function () {
      if (window.opener && !window.opener.closed) {
        window.close();
        return;
      }
      window.location.replace(${JSON.stringify(continueUrl)});
    }, ${success ? 1200 : 2500});
  </script>
</body>
</html>`;
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
    encryptToken(db, tokens.access_token),
    tokens.refresh_token ? encryptToken(db, tokens.refresh_token) : null,
    tokens.expires_at || null
  );
}

/**
 * Retrieve tokens for a given provider + email.
 */
function getTokens(db, provider, email) {
  const row = db
    .prepare('SELECT * FROM tokens WHERE provider = ? AND email = ?')
    .get(provider, email);
  if (row) {
    row.access_token = decryptToken(db, row.access_token);
    row.refresh_token = decryptToken(db, row.refresh_token);
  }
  return row;
}

/**
 * Retrieve all accounts for a given provider.
 */
function getAccountsByProvider(db, provider) {
  const rows = db.prepare('SELECT * FROM tokens WHERE provider = ?').all(provider);
  for (const row of rows) {
    row.access_token = decryptToken(db, row.access_token);
    row.refresh_token = decryptToken(db, row.refresh_token);
  }
  return rows;
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

  const { clientId, clientSecret } = getSpotifyCredentials(db);
  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
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
// Spotify OAuth routes
// ---------------------------------------------------------------------------

// GET /api/auth/spotify/status — configured? linked? what redirect URI to register
router.get('/spotify/status', (req, res) => {
  const db = req.app.locals.db;
  const { clientId } = getSpotifyCredentials(db);
  const accounts = getAccountsByProvider(db, 'spotify');
  res.json({
    configured: Boolean(clientId),
    linked: accounts.length > 0,
    email: accounts[0]?.email || null,
    redirectUri: spotifyRedirectUri(req),
  });
});

// GET /api/auth/spotify/url
router.get('/spotify/url', (req, res) => {
  const db = req.app.locals.db;
  const { clientId } = getSpotifyCredentials(db);
  if (!clientId) {
    return res.status(503).json({
      error: 'Spotify OAuth not configured — set Client ID and Secret in Settings',
    });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: spotifyRedirectUri(req),
    scope: [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'user-read-email',
      'streaming',
    ].join(' '),
    show_dialog: 'false',
  });

  res.json({ url: `${SPOTIFY_AUTH_ENDPOINT}?${params}` });
});

// GET /api/auth/spotify/callback
router.get('/spotify/callback', async (req, res) => {
  const { code, error: oauthError } = req.query;
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;
  const io = req.app.locals.io;
  const continueUrl = frontendReturnUrl(req, 'spotify=linked');

  if (oauthError) {
    logger.error('Spotify OAuth error: %s', oauthError);
    return res.status(400).send(renderPopupResultPage({
      success: false,
      title: 'החיבור לספוטיפיי נכשל',
      message: String(oauthError),
      continueUrl,
    }));
  }
  if (!code) {
    return res.status(400).send(renderPopupResultPage({
      success: false,
      title: 'החיבור לספוטיפיי נכשל',
      message: 'קוד אישור חסר',
      continueUrl,
    }));
  }

  try {
    const { clientId, clientSecret } = getSpotifyCredentials(db);
    const credentials = Buffer.from(
      `${clientId}:${clientSecret}`
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
      return res.status(502).send(renderPopupResultPage({
        success: false,
        title: 'החיבור לספוטיפיי נכשל',
        message: 'החלפת קוד האישור בטוקן נכשלה',
        continueUrl,
      }));
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

    // The popup closes itself — the main app window is notified via the
    // Socket.io event above, not via this response.
    res.send(renderPopupResultPage({
      success: true,
      title: 'ספוטיפיי חובר בהצלחה',
      message: 'ניתן לסגור חלון זה',
      continueUrl,
    }));
  } catch (err) {
    logger.error('Spotify OAuth callback error: %s', err.message);
    res.status(500).send(renderPopupResultPage({
      success: false,
      title: 'החיבור לספוטיפיי נכשל',
      message: 'שגיאת שרת פנימית',
      continueUrl,
    }));
  }
});

// DELETE /api/auth/spotify — disconnect all Spotify accounts
router.delete('/spotify', (req, res) => {
  const db = req.app.locals.db;
  const io = req.app.locals.io;

  db.prepare("DELETE FROM tokens WHERE provider = 'spotify'").run();

  if (io) io.emit('auth:spotify:unlinked');

  req.app.locals.logger.info('All Spotify accounts disconnected');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = router;

// Named exports for token utilities used by other route modules
module.exports.getValidSpotifyToken = getValidSpotifyToken;
module.exports.getSpotifyCredentials = getSpotifyCredentials;
module.exports.getAccountsByProvider = getAccountsByProvider;
module.exports.refreshSpotifyToken = refreshSpotifyToken;
