'use strict';

// ---------------------------------------------------------------------------
// Photo frame source
// ---------------------------------------------------------------------------
// Mounted at /api/photoframe. The image FILES themselves are served by a plain
// express.static at /api/photos (see server.js) — this router is the JSON API
// the screensaver and Settings talk to, kept on a separate prefix so a folder
// on the share can never collide with an endpoint name.
//
// A share mounted under the photos directory (scripts/mount-photos-share.sh)
// means every readdir here can be a network round trip, so the whole walk is
// async: a NAS that has gone to sleep must not be able to block the event loop
// and take the rest of the mirror down with it.
// ---------------------------------------------------------------------------

const { Router } = require('express');
const { execFile } = require('child_process');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

const router = Router();

const IS_LINUX = os.platform() === 'linux';

/**
 * Same shape as the helper in routes/wifi.js and routes/system.js: never
 * rejects, always resolves {ok, stdout, stderr}. No `shell`, ever — every
 * value below comes from the user, and argv goes straight to execve.
 */
function run(cmd, args, timeout = 15000, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, ...opts }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, stdout: '', stderr: (stderr || err.message).toString() });
      else resolve({ ok: true, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

const PHOTO_ROOT = path.resolve(path.join(__dirname, '..', 'data', 'photos'));
const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const PHOTO_MAX_DEPTH = 3;

function getConfigValue(db, key) {
  if (!db) return '';
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

function getConfigArray(db, key) {
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    const value = row?.value == null ? [] : JSON.parse(row.value);
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve a client-supplied folder to an absolute path, or null if it escapes
 * the photos directory. The picker sends whatever the user tapped, so this is
 * a trust boundary: `..`, absolute paths and Windows separators all have to
 * land outside and be rejected rather than normalised into something valid.
 */
function resolveSubdir(sub) {
  const rel = String(sub || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const abs = path.resolve(PHOTO_ROOT, rel);
  if (abs !== PHOTO_ROOT && !abs.startsWith(PHOTO_ROOT + path.sep)) return null;
  return abs;
}

function isPhotoFile(name) {
  return PHOTO_EXTS.has(path.extname(name).toLowerCase());
}

/** Junk that shows up on shares and in album exports but is never a photo. */
function isJunk(name) {
  return name.startsWith('.') || name === '@eaDir' || name === 'Thumbs.db';
}

/**
 * Collect photo paths relative to `dir`, walking subfolders up to
 * PHOTO_MAX_DEPTH. A folder that cannot be read (permissions, NAS dropped
 * mid-walk) is skipped rather than failing the whole listing — a half-full
 * frame beats an empty one.
 */
async function walkPhotos(dir, base = '', depth = 0, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (depth === 0) throw err; // the root failing is worth reporting
    return out;
  }

  for (const entry of entries) {
    if (isJunk(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (depth < PHOTO_MAX_DEPTH) await walkPhotos(path.join(dir, entry.name), rel, depth + 1, out);
    } else if (isPhotoFile(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** URL the browser loads a local photo from. Encoded per segment so that
 *  subfolders stay real path separators and Hebrew names survive. */
function localPhotoUrl(subdir, rel) {
  const full = subdir ? `${subdir}/${rel}` : rel;
  return `/api/photos/${full.split('/').map(encodeURIComponent).join('/')}`;
}

// ---------------------------------------------------------------------------
// GET /api/photoframe/list — the slides the screensaver should show
// ---------------------------------------------------------------------------
router.get('/list', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  if (getConfigValue(db, 'photoSource') === 'immich') {
    const cfg = immichConfig(db);
    if (!cfg.base || !cfg.key) {
      return res.json({ photos: [], source: 'immich', error: 'not-configured' });
    }
    try {
      const assets = await immichAssets(cfg, getConfigValue(db, 'immichAlbumId'), getConfigArray(db, 'immichPersonIds'));
      const photos = assets
        .filter((a) => a?.id && a.type === 'IMAGE') // no videos on a photo frame
        .map((a) => ({ name: a.originalFileName || a.id, url: `/api/photoframe/immich/${a.id}` }));
      return res.json({ source: 'immich', photos });
    } catch (err) {
      logger.error('Immich photo listing failed: %s', err.message);
      // Empty list, not an error status: the screensaver falls back to its
      // gradients rather than showing nothing when the server is down.
      return res.json({ photos: [], source: 'immich', error: 'unreachable' });
    }
  }

  const subdir = getConfigValue(db, 'photoSubdir');

  const dir = resolveSubdir(subdir);
  if (!dir) {
    logger.warn('Photo subdir %j escapes the photos directory - ignoring', subdir);
    return res.json({ photos: [], source: 'local', error: 'invalid-folder' });
  }

  try {
    const files = await walkPhotos(dir);
    files.sort();
    res.json({
      source: 'local',
      folder: subdir || '',
      photos: files.map((rel) => ({ name: rel, url: localPhotoUrl(subdir, rel) })),
    });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Photo listing failed: %s', err.message);
    }
    res.json({ photos: [], source: 'local', error: err.code || 'unreadable' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/photoframe/folders?path= — one level of the folder picker
// ---------------------------------------------------------------------------
// Returns the immediate subfolders of `path` (relative to the photos dir),
// each with how many photos it holds, so the user can tell a folder worth
// picking from an empty one without drilling into it.
// ---------------------------------------------------------------------------
router.get('/folders', async (req, res) => {
  const logger = req.app.locals.logger;
  const rel = String(req.query.path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  const dir = resolveSubdir(rel);
  if (!dir) return res.status(400).json({ error: 'Folder is outside the photo directory' });

  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ path: rel, parent: null, folders: [], photoCount: 0 });
    logger.warn('Folder listing failed for %j: %s', rel, err.message);
    return res.status(500).json({ error: 'Folder could not be read', code: err.code });
  }

  const folders = [];
  let photoCount = 0;
  for (const entry of entries) {
    if (isJunk(entry.name)) continue;
    if (entry.isDirectory()) folders.push(entry.name);
    else if (isPhotoFile(entry.name)) photoCount += 1;
  }

  // Count each child's photos (one level only — the picker just needs a hint,
  // and a share with many albums would otherwise cost a full recursive walk
  // on every tap).
  // ponytail: shallow count, recurse if "0 photos" on a nested album misleads.
  const withCounts = await Promise.all(
    folders.sort().map(async (name) => {
      let count = 0;
      try {
        const kids = await fsp.readdir(path.join(dir, name), { withFileTypes: true });
        count = kids.filter((k) => k.isFile() && isPhotoFile(k.name)).length;
      } catch {
        count = 0; // unreadable child — still offer it, just without a count
      }
      return { name, path: rel ? `${rel}/${name}` : name, photoCount: count };
    })
  );

  res.json({
    path: rel,
    parent: rel ? rel.split('/').slice(0, -1).join('/') : null,
    photoCount,
    folders: withCounts,
  });
});

// ---------------------------------------------------------------------------
// Immich
// ---------------------------------------------------------------------------
// The API key is read per-request from the config table rather than cached in
// process.env, so changing it in Settings takes effect without a restart.
//
// Everything below deliberately uses Immich's LEGACY FLAT request shape
// (`type`, `isFavorite`, `albumIds`, `visibility`) rather than the `filter`/
// `orderBy` shape introduced in 3.2: the flat fields still work on every
// version from 1.x to 3.2, and 3.2 returns 400 if the two shapes are mixed.
// ---------------------------------------------------------------------------

const IMMICH_TIMEOUT_MS = 10_000;
const IMMICH_PAGE_SIZE = 250; // Immich caps `size` at 1000; 250 is its default

function immichConfig(db) {
  const origin = getConfigValue(db, 'immichUrl').trim().replace(/\/+$/, '');
  return { base: origin ? `${origin}/api` : '', key: getConfigValue(db, 'immichApiKey') };
}

/**
 * Immich has returned assets as a bare array, as `{assets:{items}}` and as
 * `{items}` depending on version and endpoint. Normalise rather than branch.
 */
function immichItems(body) {
  if (Array.isArray(body)) return body;
  return body?.assets?.items ?? body?.items ?? [];
}

async function immichFetch(cfg, path, options = {}) {
  const res = await fetch(`${cfg.base}${path}`, {
    ...options,
    headers: { 'x-api-key': cfg.key, 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(IMMICH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`Immich ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

function immichSearchBody(albumId, personIds = []) {
  // `visibility: 'timeline'` is not optional. Immich 3.0 changed an omitted
  // visibility from "timeline only" to "anything but locked", so leaving it
  // out puts archived and hidden photos on a family screen.
  const base = { type: 'IMAGE', visibility: 'timeline', size: IMMICH_PAGE_SIZE };
  if (personIds.length) base.personIds = personIds;
  if (albumId === 'favorites') return { ...base, isFavorite: true };
  if (albumId) return { ...base, albumIds: [albumId] };
  return base;
}

/** Ask Immich for the slide deck. '' = random across the library. */
async function immichAssets(cfg, albumId, personIds = []) {
  const body = immichSearchBody(albumId, personIds);

  if (!albumId && !personIds.length) {
    try {
      const res = await immichFetch(cfg, '/search/random', { method: 'POST', body: JSON.stringify(body) });
      return immichItems(await res.json());
    } catch (err) {
      if (err.status !== 404) throw err;
      // /search/random predates 1.116 — fall through to a metadata search and
      // let the frontend's own shuffle supply the randomness.
    }
  }

  const res = await immichFetch(cfg, '/search/metadata', { method: 'POST', body: JSON.stringify(body) });
  return immichItems(await res.json());
}

// ---------------------------------------------------------------------------
// GET /api/photoframe/albums — Immich albums, for the Settings dropdown
// ---------------------------------------------------------------------------
router.get('/albums', async (req, res) => {
  const logger = req.app.locals.logger;
  const cfg = immichConfig(req.app.locals.db);
  if (!cfg.base || !cfg.key) return res.status(503).json({ error: 'Immich is not configured' });

  try {
    const r = await immichFetch(cfg, '/albums');
    const albums = await r.json();
    res.json({
      albums: (Array.isArray(albums) ? albums : []).map((a) => ({
        id: a.id,
        name: a.albumName,
        count: a.assetCount ?? 0,
      })),
    });
  } catch (err) {
    logger.error('Immich album listing failed: %s', err.message); // never the key
    res.status(502).json({ error: 'Could not reach Immich', status: err.status || null });
  }
});

// ---------------------------------------------------------------------------
// GET /api/photoframe/people — Immich people, for the Settings filter
// ---------------------------------------------------------------------------
router.get('/people', async (req, res) => {
  const logger = req.app.locals.logger;
  const cfg = immichConfig(req.app.locals.db);
  if (!cfg.base || !cfg.key) return res.status(503).json({ error: 'Immich is not configured' });

  try {
    const r = await immichFetch(cfg, '/people?withHidden=true&size=1000');
    const body = await r.json();
    const people = Array.isArray(body) ? body : body?.people || [];
    res.json({
      people: people
        .filter((p) => p?.id && p.name)
        .map((p) => ({ id: p.id, name: p.name, count: p.assetCount ?? 0 })),
    });
  } catch (err) {
    logger.error('Immich people listing failed: %s', err.message);
    res.status(502).json({ error: 'Could not reach Immich', status: err.status || null });
  }
});

// ---------------------------------------------------------------------------
// GET /api/photoframe/immich/:id — image proxy
// ---------------------------------------------------------------------------
// Immich requires the API key even for thumbnails, so <img src> cannot point
// at it directly. Proxying also keeps the key off the client entirely — the
// alternative (?apiKey= in the URL) would hand it to the browser.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/immich/:id', async (req, res) => {
  const logger = req.app.locals.logger;
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid asset id' });

  const cfg = immichConfig(req.app.locals.db);
  if (!cfg.base || !cfg.key) return res.status(503).json({ error: 'Immich is not configured' });

  try {
    // `preview` is ~1440px on the long edge by default, which upscales
    // acceptably to 1080p; `fullsize` 302s back here on most servers because
    // the fullsize derivative is off by default.
    const r = await immichFetch(cfg, `/assets/${id}/thumbnail?size=preview`, { redirect: 'follow' });
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const buf = Buffer.from(await r.arrayBuffer());
    res.end(buf);
  } catch (err) {
    logger.warn('Immich asset %s failed: %s', id, err.message);
    res.status(502).end();
  }
});

// ---------------------------------------------------------------------------
// SMB / CIFS share discovery
// ---------------------------------------------------------------------------

/**
 * `smbclient` takes the host as a positional `//host` argument, so a host
 * beginning with `-` would be read as a flag — argument injection, not shell
 * injection (there is no shell). Hostnames and IPv4 only; anything else is
 * rejected rather than escaped.
 */
function isValidSmbHost(host) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(String(host || ''));
}

const MOCK_SHARES = [
  { name: 'photos', comment: 'Family photos' },
  { name: 'media', comment: '' },
];

/**
 * Parse `smbclient -L --grepable` output. Lines look like:
 *   Disk|photos|Family photos
 * Administrative shares (trailing $) are never photo shares, so they are
 * dropped rather than shown and then failing to mount.
 */
function parseShares(stdout) {
  const shares = [];
  for (const line of stdout.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 2 || parts[0].trim() !== 'Disk') continue;
    const name = parts[1].trim();
    if (!name || name.endsWith('$')) continue;
    shares.push({ name, comment: (parts[2] || '').trim() });
  }
  return shares;
}

// ---------------------------------------------------------------------------
// POST /api/photoframe/smb/shares — list the shares a NAS is offering
// ---------------------------------------------------------------------------
// POST rather than GET because the password is in the body: a GET would put it
// in the query string, which lands in access logs and browser history.
// Browsing is unprivileged — only the mount itself needs sudo.
// ---------------------------------------------------------------------------
router.post('/smb/shares', async (req, res) => {
  const logger = req.app.locals.logger;
  const { host, username, password } = req.body || {};

  if (!host) return res.status(400).json({ error: 'Host is required' });
  if (!isValidSmbHost(host)) return res.status(400).json({ error: 'Invalid host name' });

  if (!IS_LINUX) return res.json({ shares: MOCK_SHARES, mock: true });

  // Password goes via the environment, never argv: argv is readable by any
  // user on the box through `ps`, /proc/<pid>/environ is not.
  const args = ['-L', `//${host}`, '--grepable'];
  if (username) args.push('-U', username);
  else args.push('-N'); // guest / anonymous

  const result = await run('smbclient', args, 15000, {
    env: { ...process.env, PASSWD: password || '' },
  });

  if (!result.ok) {
    // stderr can echo the username and the URL — log it, but hand the client
    // a classified reason instead of raw tool output.
    logger.error('SMB share listing failed for %s: %s', host, result.stderr);
    const err = result.stderr.toLowerCase();
    let code = 'failed';
    if (err.includes('logon_failure') || err.includes('access denied')) code = 'bad-credentials';
    else if (err.includes('not_found') || err.includes('unable to connect') || err.includes('connection refused')) code = 'unreachable';
    else if (err.includes('smbclient') && err.includes('enoent')) code = 'not-installed';
    return res.status(502).json({ error: 'Could not list shares', code });
  }

  const shares = parseShares(result.stdout);
  logger.info('SMB share listing for %s returned %d shares', host, shares.length);
  res.json({ shares });
});

module.exports = router;
module.exports.walkPhotos = walkPhotos; // exported for backend/test-photos.js
module.exports.resolveSubdir = resolveSubdir;
module.exports.parseShares = parseShares;
module.exports.isValidSmbHost = isValidSmbHost;
module.exports.PHOTO_ROOT = PHOTO_ROOT;
