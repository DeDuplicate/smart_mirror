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
const crypto = require('crypto');
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

/**
 * Ask Immich for the slide deck. '' = random across the library.
 *
 * Immich treats `personIds` as an AND: it returns only assets containing
 * EVERY id listed. The Settings picker reads as "show photos of these family
 * members", so four selected people asked for photos with all four in frame
 * at once — of which a real library has approximately none. The response was
 * a perfectly successful empty list, so the frame just went blank with no
 * error anywhere to explain it.
 *
 * There is no OR mode in the search API, so fan out one query per person and
 * merge. Individual failures are tolerated: one unreachable person's worth of
 * photos should not blank a frame that could still show the other three.
 */
async function immichAssets(cfg, albumId, personIds = []) {
  if (personIds.length > 1) {
    const settled = await Promise.allSettled(
      personIds.map((id) => immichAssetsForQuery(cfg, albumId, [id]))
    );

    return mergeSettledAssets(settled);
  }

  return immichAssetsForQuery(cfg, albumId, personIds);
}

/**
 * Collapse the per-person fan-out into one slide deck.
 *
 * A photo with two selected people in it comes back from both of their
 * queries and would otherwise appear twice in the slideshow. Every query
 * failing is a server problem rather than an empty result, and is rethrown so
 * the caller reports 'unreachable' instead of quietly showing a blank frame.
 */
function mergeSettledAssets(settled) {
  const fulfilled = settled.filter((r) => r.status === 'fulfilled');
  if (!fulfilled.length) throw settled[0].reason;

  const byId = new Map();
  for (const asset of fulfilled.flatMap((r) => r.value || [])) {
    if (asset?.id && !byId.has(asset.id)) byId.set(asset.id, asset);
  }
  return [...byId.values()];
}

/** One Immich search. `personIds` holds at most one id — see immichAssets. */
async function immichAssetsForQuery(cfg, albumId, personIds = []) {
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
    // the fullsize derivative is off by default. `?size=thumbnail` (~250px) is
    // for the picture browser's grid, where 30 previews at once would be 10 MB.
    const size = req.query.size === 'thumbnail' ? 'thumbnail' : 'preview';
    const r = await immichFetch(cfg, `/assets/${id}/thumbnail?size=${size}`, { redirect: 'follow' });
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
// Picture browser: choosing ONE photo (a kid's avatar)
// ---------------------------------------------------------------------------
// The slideshow only needs a list. Choosing a single picture needs thumbnails
// you can scan at a glance, folders you can walk, and Immich in pages. These
// routes are read-only and never write to a share or to Immich.
// ---------------------------------------------------------------------------

const BROWSE_IMMICH_PAGE = 60;  // photos per Immich page
const BROWSE_FOLDER_MAX = 300;  // photos listed from one folder

function cleanRel(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** The pictures directly inside one folder (not recursive) and its subfolders. */
async function listFolder(dir, rel) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const folders = [];
  const photos = [];
  for (const entry of entries) {
    if (isJunk(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) folders.push({ name: entry.name, path: childRel });
    else if (isPhotoFile(entry.name)) photos.push({ name: entry.name, path: childRel });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  photos.sort((a, b) => a.name.localeCompare(b.name, 'he', { numeric: true }));
  return { folders, photos: photos.slice(0, BROWSE_FOLDER_MAX), photoCount: photos.length };
}

// GET /api/photoframe/browse/local?path= - one folder: its subfolders and pictures
router.get('/browse/local', async (req, res) => {
  const logger = req.app.locals.logger;
  const rel = cleanRel(req.query.path);
  const dir = resolveSubdir(rel);
  if (!dir) return res.status(400).json({ error: 'Folder is outside the photo directory' });

  const parent = rel ? rel.split('/').slice(0, -1).join('/') : null;
  try {
    res.json({ path: rel, parent, ...(await listFolder(dir, rel)) });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ path: rel, parent, folders: [], photos: [], photoCount: 0 });
    logger.warn('Folder browse failed for %j: %s', rel, err.message);
    res.status(500).json({ error: 'Folder could not be read', code: err.code });
  }
});

// --- Thumbnails -------------------------------------------------------------
// A NAS photo is typically 3-10 MB. Thirty of them in a grid would stall the Pi,
// so grid tiles and the crop view get a cached, downscaled copy made with ffmpeg
// (which the mirror already ships for audio). If ffmpeg is missing or cannot read
// a file, the original is served instead: slower, but never a hole in the grid.

const THUMB_DIR = path.join(__dirname, '..', 'data', 'cache', 'thumbs');
const THUMB_SIDES = { thumb: 240, medium: 1024 };
const THUMB_PARALLEL = 2; // a Pi 2 has four slow cores and one gigabyte

let thumbsRunning = 0;
const thumbQueue = [];
function withThumbSlot(task) {
  return new Promise((resolve, reject) => {
    const start = () => {
      thumbsRunning += 1;
      task().then(resolve, reject).finally(() => {
        thumbsRunning -= 1;
        const next = thumbQueue.shift();
        if (next) next();
      });
    };
    if (thumbsRunning < THUMB_PARALLEL) start();
    else thumbQueue.push(start);
  });
}

/**
 * The EXIF orientation tag (1-8) of a JPEG, or null. Phones store a portrait shot
 * as landscape pixels plus this tag; browsers apply it, but ffmpeg 5.x (Raspberry
 * Pi OS) does not, so a thumbnail made without it would lie on its side.
 */
function parseExifOrientation(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString('latin1', i + 4, i + 8) === 'Exif') {
      return tiffOrientation(buf.subarray(i + 10, i + 2 + len));
    }
    if (marker === 0xda) return null; // start of image data: no EXIF before it
    i += 2 + len;
  }
  return null;
}

function tiffOrientation(t) {
  if (t.length < 8) return null;
  const order = t.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k += 1) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > t.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

async function exifOrientation(file) {
  let handle;
  try {
    handle = await fsp.open(file, 'r');
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return parseExifOrientation(buf.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

// ffmpeg filter that turns each EXIF orientation upright.
const ORIENTATION_FILTER = { 2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2' };

function thumbKey(sizeName, rel, stat) {
  return crypto.createHash('sha1').update(`${sizeName}|${rel}|${stat.mtimeMs}|${stat.size}`).digest('hex');
}

async function makeThumb(abs, out, sizeName, bytes) {
  const side = THUMB_SIDES[sizeName];
  const jpeg = /\.jpe?g$/i.test(abs);
  // JPEG can be decoded at 1/2, 1/4 or 1/8 size, which is several times faster
  // than decoding a 12 MP photo in full just to shrink it to 240 px.
  let lowres = 0;
  if (jpeg && sizeName === 'thumb' && bytes > 1_500_000) lowres = 2;
  else if (jpeg && sizeName === 'medium' && bytes > 3_000_000) lowres = 1;

  const turn = jpeg ? ORIENTATION_FILTER[await exifOrientation(abs)] : null;
  const filter = [turn, `scale=${side}:${side}:force_original_aspect_ratio=decrease`].filter(Boolean).join(',');
  const tmp = `${out}.${process.pid}.tmp.jpg`;
  const args = ['-v', 'error', '-y', '-noautorotate', ...(lowres ? ['-lowres', String(lowres)] : []), '-i', abs, '-vf', filter, '-frames:v', '1', '-q:v', '5', tmp];
  const result = await run('ffmpeg', args, 30000);
  if (!result.ok) {
    await fsp.rm(tmp, { force: true });
    return false;
  }
  await fsp.rename(tmp, out);
  return true;
}

// GET /api/photoframe/thumb?path=&size=thumb|medium - a downscaled copy of a photo
router.get('/thumb', async (req, res) => {
  const logger = req.app.locals.logger;
  const rel = cleanRel(req.query.path);
  const sizeName = req.query.size === 'medium' ? 'medium' : 'thumb';
  const abs = rel ? resolveSubdir(rel) : null;
  if (!abs || abs === PHOTO_ROOT || !isPhotoFile(rel)) return res.status(400).json({ error: 'Not a photo in the photo directory' });

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return res.status(404).end();
  }
  if (!stat.isFile()) return res.status(404).end();

  const cached = path.join(THUMB_DIR, `${thumbKey(sizeName, rel, stat)}.jpg`);
  const send = (file) => res.sendFile(file, { maxAge: '1d' });
  try {
    await fsp.access(cached);
    return send(cached);
  } catch {
    // not cached yet
  }

  try {
    await fsp.mkdir(THUMB_DIR, { recursive: true });
    if (await withThumbSlot(() => makeThumb(abs, cached, sizeName, stat.size))) return send(cached);
  } catch (err) {
    logger.warn('Thumbnail failed for %j: %s', rel, err.message);
  }
  send(abs); // ffmpeg missing or unreadable: the original still shows
});

// --- Immich -----------------------------------------------------------------

/** One page of the library for the picture browser, newest first. */
function immichBrowseBody(albumId, personId, page) {
  return {
    ...immichSearchBody(albumId, personId ? [personId] : []),
    size: BROWSE_IMMICH_PAGE,
    order: 'desc',
    ...(page ? { page: Number(page) } : {}),
  };
}

// GET /api/photoframe/browse/immich?albumId=&personId=&page=
router.get('/browse/immich', async (req, res) => {
  const logger = req.app.locals.logger;
  const albumId = String(req.query.albumId || '');
  const personId = String(req.query.personId || '');
  const page = String(req.query.page || '');
  if (albumId && albumId !== 'favorites' && !UUID_RE.test(albumId)) return res.status(400).json({ error: 'Invalid album id' });
  if (personId && !UUID_RE.test(personId)) return res.status(400).json({ error: 'Invalid person id' });
  if (page && !/^\d{1,6}$/.test(page)) return res.status(400).json({ error: 'Invalid page' });

  const cfg = immichConfig(req.app.locals.db);
  if (!cfg.base || !cfg.key) return res.status(503).json({ error: 'Immich is not configured' });

  try {
    const r = await immichFetch(cfg, '/search/metadata', { method: 'POST', body: JSON.stringify(immichBrowseBody(albumId, personId, page)) });
    const body = await r.json();
    const assets = immichItems(body)
      .filter((a) => a?.id && a.type === 'IMAGE')
      .map((a) => ({ id: a.id, name: a.originalFileName || a.id }));
    const next = body?.assets?.nextPage;
    res.json({ assets, nextPage: next ? String(next) : null });
  } catch (err) {
    logger.error('Immich browse failed: %s', err.message);
    res.status(502).json({ error: 'Could not reach Immich', status: err.status || null });
  }
});

// GET /api/photoframe/people/:id/face - Immich's own face crop of a person, which
// is already the right shape for an avatar.
router.get('/people/:id/face', async (req, res) => {
  const logger = req.app.locals.logger;
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid person id' });
  const cfg = immichConfig(req.app.locals.db);
  if (!cfg.base || !cfg.key) return res.status(503).json({ error: 'Immich is not configured' });

  try {
    const r = await immichFetch(cfg, `/people/${id}/thumbnail`, { redirect: 'follow' });
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    logger.warn('Immich face %s failed: %s', id, err.message);
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
module.exports.mergeSettledAssets = mergeSettledAssets;
module.exports.listFolder = listFolder;
module.exports.parseExifOrientation = parseExifOrientation;
module.exports.thumbKey = thumbKey;
module.exports.immichBrowseBody = immichBrowseBody;
module.exports.cleanRel = cleanRel;
