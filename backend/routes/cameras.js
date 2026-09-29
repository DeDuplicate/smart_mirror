'use strict';

const express = require('express');
const crypto = require('crypto');
const { Readable } = require('stream');
const engine = require('./go2rtc');
const homeAssistant = require('./homeassistant');
const router = express.Router();

// ---------------------------------------------------------------------------
// Security cameras. The DB holds the cameras; go2rtc (routes/go2rtc.js) turns
// them into streams named <id> (main), <id>_sub and <id>_snap (camera-native
// JPEG). On a Pi 2 the cheap path is JPEG snapshots, so snapshot.jpg prefers
// _snap (no decode at all) and only then asks go2rtc for a keyframe of the
// sub-stream, which costs an ffmpeg run per request.
//
// Events come from outside - this app does no detection: HA motion sensors
// (motion_entity) and Frigate's event API (objects, recognised faces).
// ---------------------------------------------------------------------------

const KINDS = ['rtsp', 'hikvision', 'dahua', 'dvrip', 'onvif', 'frigate', 'http'];
const HOST_KINDS = ['hikvision', 'dahua', 'dvrip', 'onvif'];
const EVENT_TYPES = ['motion', 'object', 'face'];
const MASK = '***';
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])$/;
const ENTITY_RE = /^[a-z_]+\.[a-z0-9_]+$/;
const FRIGATE_CAM_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Interpolated into an upstream PATH: no leading dot and no '..', or fetch
// normalises /api/events/../x to another Frigate endpoint. (Camera names are
// dot-free by FRIGATE_CAM_RE; go2rtc stream names only travel in ?src=.)
const FRIGATE_EVENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const safeSegment = (s) => FRIGATE_EVENT_RE.test(s) && !s.includes('..');
// Only schemes whose go2rtc modules are loaded; never exec:/echo:/expr:.
const SOURCE_RE = { rtsp: /^(?:rtsps?|rtspx|https?|onvif|dvrip):\/\/\S+$/i, http: /^https?:\/\/\S+$/i };

const MOTION_DEBOUNCE_MS = 30000;
const SNAP_RETRY_MS = 60000;
const MAX_RECENT = 20;

const enc = encodeURIComponent;

function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  if (!row || row.value == null || row.value === '') return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function frigateBase(db) {
  const v = String(getSetting(db, 'frigateUrl', '') || '').trim().replace(/\/+$/, '');
  try {
    return /^https?:\/\/[^/\s]+/i.test(v) && new URL(v) ? v : '';
  } catch {
    return '';
  }
}

function eventTypes(db) {
  const v = getSetting(db, 'cameraEventTypes', EVENT_TYPES);
  return Array.isArray(v) ? v : EVENT_TYPES;
}

// ---------------------------------------------------------------------------
// Source URLs. Split the way Go's net/url (go2rtc) does: the authority ends at
// the first / ? or #, userinfo runs to the LAST @, the password starts after
// the first : of the userinfo.
// ---------------------------------------------------------------------------
function splitUrl(u) {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/is.exec(String(u || ''));
  if (!m) return null;
  const at = m[2].lastIndexOf('@');
  if (at < 0) return { head: m[1], password: null, tail: m[2] + m[3] };
  const userinfo = m[2].slice(0, at);
  const colon = userinfo.indexOf(':');
  return {
    head: m[1] + (colon < 0 ? userinfo : userinfo.slice(0, colon)),
    password: colon < 0 ? null : userinfo.slice(colon + 1),
    tail: m[2].slice(at) + m[3],
  };
}

function maskUrl(u) {
  const p = splitUrl(u);
  return p && p.password ? `${p.head}:${MASK}${p.tail}` : u;
}

// '***' in an incoming URL = keep the password stored with the old URL.
function keepUrlPassword(incoming, stored) {
  const p = splitUrl(incoming);
  if (!p || p.password !== MASK) return incoming;
  const s = splitUrl(stored);
  return `${p.head}${s && s.password ? `:${s.password}` : ''}${p.tail}`;
}

function sourcesFor(cam, frigateUrl) {
  const auth = cam.username
    ? `${enc(cam.username)}${cam.password ? `:${enc(cam.password)}` : ''}@`
    : '';
  const ch = cam.channel || 1;
  const rtsp = `rtsp://${auth}${cam.host}:${cam.port || 554}`;
  const http = `http://${auth}${cam.host}:${cam.httpPort || 80}`;
  switch (cam.kind) {
    case 'hikvision':
      return {
        main: `${rtsp}/Streaming/Channels/${ch}01`,
        sub: `${rtsp}/Streaming/Channels/${ch}02`,
        snap: `${http}/ISAPI/Streaming/channels/${ch}01/picture`,
      };
    case 'dahua':
      return {
        main: `${rtsp}/cam/realmonitor?channel=${ch}&subtype=0`,
        sub: `${rtsp}/cam/realmonitor?channel=${ch}&subtype=1`,
        snap: `${http}/cgi-bin/snapshot.cgi?channel=${ch}`,
      };
    case 'dvrip': { // XMEye channels are 0-based
      const base = `dvrip://${auth}${cam.host}:${cam.port || 34567}?channel=${ch - 1}&subtype=`;
      return { main: `${base}0`, sub: `${base}1` };
    }
    case 'onvif': {
      const base = `onvif://${auth}${cam.host}:${cam.port || 80}`;
      return { main: base, sub: `${base}?subtype=1`, snap: `${base}?subtype=1&snapshot` };
    }
    case 'frigate': {
      if (!frigateUrl || !cam.frigateCamera) return null;
      const name = enc(cam.frigateCamera);
      return {
        main: `rtsp://${new URL(frigateUrl).hostname}:8554/${name}`,
        snap: `${frigateUrl}/api/${name}/latest.jpg?height=720`,
      };
    }
    case 'rtsp':
      return cam.source ? { main: cam.source } : null;
    case 'http':
      return cam.source ? { main: cam.source, snap: cam.source } : null;
    default:
      return null;
  }
}

// go2rtc streams for one camera + which name serves what. Identical URLs are
// registered once (an rtsp kind's "sub" is its main) - two names would mean
// two connections to the same camera.
function streamPlan(cam, frigateUrl) {
  const s = sourcesFor(cam, frigateUrl);
  if (!s) return null;
  const streams = { [cam.id]: s.main };
  const names = { main: cam.id, sub: cam.id, snap: null };
  if (s.sub && s.sub !== s.main) {
    names.sub = `${cam.id}_sub`;
    streams[names.sub] = s.sub;
  }
  if (s.snap) {
    names.snap = s.snap === s.main ? cam.id : `${cam.id}_snap`;
    streams[names.snap] = s.snap;
  }
  return { streams, names };
}

function fromRow(r) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    host: r.host || '',
    port: r.port ?? null,
    httpPort: r.http_port ?? null,
    username: r.username || '',
    password: r.password || '',
    channel: r.channel || 1,
    source: r.source || '',
    frigateCamera: r.frigate_camera || '',
    motionEntity: r.motion_entity || '',
    enabled: Boolean(r.enabled),
    sort: r.sort || 0,
  };
}

// Passwords never leave the backend.
function toPublic(cam) {
  const { password, ...rest } = cam;
  return {
    id: rest.id,
    name: rest.name,
    kind: rest.kind,
    host: rest.host,
    port: rest.port,
    httpPort: rest.httpPort,
    username: rest.username,
    passwordSet: Boolean(password),
    channel: rest.channel,
    source: maskUrl(rest.source),
    frigateCamera: rest.frigateCamera,
    motionEntity: rest.motionEntity,
    enabled: rest.enabled,
    sort: rest.sort,
  };
}

// Validate + normalise a request body, merged over the stored camera on
// update (so a partial body such as {enabled:false} works too).
function normalize(body, stored) {
  const b = { ...(stored || {}), ...(body && typeof body === 'object' ? body : {}) };
  const errors = [];
  const str = (v, max, label) => {
    const s = v == null ? '' : String(v).trim();
    if (s.length > max) errors.push(`${label} is too long`);
    return s;
  };
  const port = (v, label) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) errors.push(`${label} must be 1-65535`);
    return n;
  };

  const cam = {
    name: str(b.name, 60, 'name'),
    kind: String(b.kind || ''),
    host: str(b.host, 253, 'host'),
    port: port(b.port, 'port'),
    httpPort: port(b.httpPort, 'httpPort'),
    username: str(b.username, 64, 'username'),
    channel: b.channel === '' || b.channel == null ? 1 : Number(b.channel),
    source: str(b.source, 1024, 'source'),
    frigateCamera: str(b.frigateCamera, 64, 'frigateCamera'),
    motionEntity: str(b.motionEntity, 255, 'motionEntity'),
    enabled: b.enabled !== false && b.enabled !== 0,
  };
  // Empty / '***' = keep the stored one (the UI never gets it back to resend).
  const pw = body?.password;
  cam.password = pw == null || pw === '' || pw === MASK ? stored?.password || '' : String(pw);
  if (cam.password.length > 128) errors.push('password is too long');
  cam.source = SOURCE_RE[cam.kind] ? keepUrlPassword(cam.source, stored?.source) : '';

  if (!cam.name) errors.push('name is required');
  if (!KINDS.includes(cam.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  if (HOST_KINDS.includes(cam.kind) && !cam.host) errors.push('host is required');
  if (cam.host && !HOST_RE.test(cam.host)) errors.push('host must be a hostname or IP address');
  if (!Number.isInteger(cam.channel) || cam.channel < 1 || cam.channel > 256) errors.push('channel must be 1-256');
  if (SOURCE_RE[cam.kind] && !SOURCE_RE[cam.kind].test(cam.source)) {
    errors.push(cam.kind === 'http' ? 'source must be an http(s):// URL' : 'source must be an rtsp:// URL');
  }
  if (cam.kind === 'frigate' && !cam.frigateCamera) errors.push('frigateCamera is required');
  if (cam.frigateCamera && !FRIGATE_CAM_RE.test(cam.frigateCamera)) errors.push('frigateCamera may only contain letters, digits, _ and -');
  if (cam.motionEntity && !ENTITY_RE.test(cam.motionEntity)) errors.push('motionEntity must be an entity id like binary_sensor.front_motion');
  return { cam, errors };
}

function desiredStreams(db) {
  const frigate = frigateBase(db);
  const out = {};
  for (const row of db.prepare('SELECT * FROM cameras WHERE enabled = 1').all()) {
    Object.assign(out, streamPlan(fromRow(row), frigate)?.streams);
  }
  return out;
}

// Every mutation: tell clients now, resync go2rtc, and tell them again if
// that changed the engine status the list carries.
function changed(req) {
  const io = req.app.locals.io;
  io?.emit('cameras:updated');
  const before = JSON.stringify(engine.status());
  engine.resync().then(() => {
    if (JSON.stringify(engine.status()) !== before) io?.emit('cameras:updated');
  });
}

const fail = (res, status, error, code) => res.status(status).json({ error, ...(code ? { code } : {}) });
const errStatus = (err) => (err.code === 'engine_down' ? 503 : 502);

function sendJpeg(res, buf) {
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }).send(buf);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const rows = req.app.locals.db.prepare('SELECT * FROM cameras ORDER BY sort, created_at').all();
  res.json({ cameras: rows.map((r) => toPublic(fromRow(r))), engine: engine.status() });
});

router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const { cam, errors } = normalize(req.body, null);
  if (errors.length) return fail(res, 400, errors.join('; '), 'invalid_camera');

  const id = crypto.randomUUID();
  const sort = (db.prepare('SELECT MAX(sort) AS m FROM cameras').get().m ?? -1) + 1;
  db.prepare(`
    INSERT INTO cameras (id, name, kind, host, port, username, password, channel, source, http_port, frigate_camera, motion_entity, enabled, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, cam.name, cam.kind, cam.host, cam.port, cam.username, cam.password, cam.channel, cam.source,
    cam.httpPort, cam.frigateCamera, cam.motionEntity, cam.enabled ? 1 : 0, sort);
  changed(req);
  res.status(201).json({ camera: toPublic({ id, ...cam, sort }) });
});

// Before /:id so 'order' is not taken for an id.
router.put('/order', (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) return fail(res, 400, 'ids must be an array of camera ids');
  const db = req.app.locals.db;
  const update = db.prepare('UPDATE cameras SET sort = ? WHERE id = ?');
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();
  changed(req);
  res.json({ ok: true });
});

router.put('/:id', (req, res) => {
  const db = req.app.locals.db;
  const row = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  if (!row) return fail(res, 404, 'camera not found', 'not_found');
  const stored = fromRow(row);
  const { cam, errors } = normalize(req.body, stored);
  if (errors.length) return fail(res, 400, errors.join('; '), 'invalid_camera');

  db.prepare(`
    UPDATE cameras SET name = ?, kind = ?, host = ?, port = ?, username = ?, password = ?, channel = ?, source = ?,
      http_port = ?, frigate_camera = ?, motion_entity = ?, enabled = ?
    WHERE id = ?
  `).run(cam.name, cam.kind, cam.host, cam.port, cam.username, cam.password, cam.channel, cam.source,
    cam.httpPort, cam.frigateCamera, cam.motionEntity, cam.enabled ? 1 : 0, stored.id);
  snapFailedUntil.delete(stored.id);
  changed(req);
  res.json({ camera: toPublic({ ...cam, id: stored.id, sort: stored.sort }) });
});

router.delete('/:id', (req, res) => {
  req.app.locals.db.prepare('DELETE FROM cameras WHERE id = ?').run(req.params.id);
  changed(req);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Test (Settings, before saving) + ONVIF discovery
// ---------------------------------------------------------------------------
router.post('/test', async (req, res) => {
  const db = req.app.locals.db;
  const body = { ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  if (!String(body.name || '').trim()) body.name = 'test'; // the form may test before naming
  const row = body.id ? db.prepare('SELECT * FROM cameras WHERE id = ?').get(String(body.id)) : null;
  const { cam, errors } = normalize(body, row ? fromRow(row) : null);
  if (errors.length) return fail(res, 400, errors.join('; '), 'invalid_camera');

  // A temporary UUID so a leftover (crash mid-test) is cleaned by the next sync.
  const plan = streamPlan({ ...cam, id: crypto.randomUUID() }, frigateBase(db));
  if (!plan) return fail(res, 400, 'Frigate URL is not set in Settings', 'not_configured');
  const candidates = [...new Set([plan.names.snap, plan.names.sub].filter(Boolean))];

  try {
    const buf = await engine.withTempStreams(plan.streams, async () => {
      let lastErr;
      for (const name of candidates) {
        try {
          return await engine.frame(name);
        } catch (err) {
          lastErr = err;
        }
      }
      // go2rtc's frame API hides the cause; a probe of the stream reports it.
      const why = await engine.probeError(candidates[candidates.length - 1]);
      throw Object.assign(new Error(why || lastErr.message), { code: lastErr.code });
    });
    sendJpeg(res, buf);
  } catch (err) {
    fail(res, errStatus(err), err.message, err.code || 'test_failed');
  }
});

router.get('/discover', async (req, res) => {
  try {
    const sources = await engine.discover();
    res.json({
      devices: sources.map((s) => {
        // go2rtc fills in a literal user:pass - the form asks for the real ones.
        const url = String(s.url || '').replace(/\/\/[^/@]*@/, '//');
        const hostPort = String(s.name || '');
        const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostPort);
        return {
          host: m ? m[1] : hostPort,
          port: m && m[2] ? Number(m[2]) : null,
          url,
          name: String(s.info || '').trim() || hostPort,
        };
      }),
    });
  } catch (err) {
    fail(res, errStatus(err), err.message, 'discover_failed');
  }
});

// ---------------------------------------------------------------------------
// Events: newest first, same shape as the 'camera:event' socket payload
// ---------------------------------------------------------------------------
const recent = [];

router.get('/events/recent', (req, res) => {
  res.json({ events: recent });
});

router.get('/events/:eventId/snapshot.jpg', async (req, res) => {
  const base = frigateBase(req.app.locals.db);
  if (!base) return fail(res, 404, 'Frigate URL is not set', 'not_configured');
  if (!safeSegment(req.params.eventId)) return fail(res, 400, 'invalid event id');
  try {
    const r = await fetch(`${base}/api/events/${enc(req.params.eventId)}/snapshot.jpg`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return fail(res, r.status === 404 ? 404 : 502, `Frigate answered ${r.status}`);
    sendJpeg(res, Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    fail(res, 502, `Frigate unreachable (${err.cause?.code || err.message})`);
  }
});

// ---------------------------------------------------------------------------
// Snapshot + live proxy
// ---------------------------------------------------------------------------
const snapFailedUntil = new Map(); // camera id -> ms; skip a broken _snap for a while
let lastNoStreamResync = 0;

function lookup(req, res) {
  const db = req.app.locals.db;
  const row = db.prepare('SELECT * FROM cameras WHERE id = ?').get(req.params.id);
  let error = null;
  if (!row) error = [404, 'camera not found', 'not_found'];
  else if (!row.enabled) error = [409, 'camera is disabled', 'camera_disabled'];
  const cam = row && fromRow(row);
  const plan = cam && streamPlan(cam, frigateBase(db));
  if (!error && !plan) error = [409, 'Frigate URL is not set in Settings', 'not_configured'];
  if (error) {
    fail(res, ...error);
    return null;
  }
  return { cam, plan };
}

router.get('/:id/snapshot.jpg', async (req, res) => {
  const found = lookup(req, res);
  if (!found) return;
  const { cam, plan } = found;
  const useSnap = plan.names.snap && !(snapFailedUntil.get(cam.id) > Date.now());
  const fallback = req.query.quality === 'main' ? plan.names.main : plan.names.sub;
  const candidates = [...new Set([useSnap && plan.names.snap, fallback].filter(Boolean))];

  let lastErr;
  for (const name of candidates) {
    try {
      return sendJpeg(res, await engine.frame(name));
    } catch (err) {
      lastErr = err;
      if (name === plan.names.snap && name !== fallback && err.code !== 'engine_down' && err.code !== 'no_stream') {
        snapFailedUntil.set(cam.id, Date.now() + SNAP_RETRY_MS);
      }
    }
  }
  // Streams missing: go2rtc (or an external one) restarted without them.
  if (lastErr.code === 'no_stream' && Date.now() - lastNoStreamResync > 10000) {
    lastNoStreamResync = Date.now();
    engine.resync();
  }
  fail(res, errStatus(lastErr), lastErr.message, lastErr.code || 'snapshot_failed');
});

router.get('/:id/stream.mp4', async (req, res) => {
  const found = lookup(req, res);
  if (!found) return;
  const name = req.query.quality === 'sub' ? found.plan.names.sub : found.plan.names.main;

  // Abort upstream when the viewer leaves, or go2rtc keeps pulling the camera.
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  let up;
  try {
    up = await fetch(engine.streamUrl(name), { signal: ac.signal });
  } catch (err) {
    if (!ac.signal.aborted) fail(res, 503, `go2rtc unreachable (${err.cause?.code || err.message})`, 'engine_down');
    return;
  }
  if (!up.ok || !up.body) {
    const text = (await up.text().catch(() => '')).replace(/\/\/[^/@\s]*@/g, '//***@').trim().slice(0, 300);
    return fail(res, 502, text || `go2rtc answered ${up.status}`, 'stream_failed');
  }
  res.set({ 'Content-Type': up.headers.get('content-type') || 'video/mp4', 'Cache-Control': 'no-store' });
  Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
});

// ---------------------------------------------------------------------------
// Event sources
// ---------------------------------------------------------------------------
let io = null;
let eventDb = null;
let log = console;
const lastMotion = new Map();

function emitEvent(ev) {
  recent.unshift(ev);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  io?.emit('camera:event', ev);
}

// HA: motion_entity going off -> on. Only off -> on: unavailable -> on after an
// HA restart is not motion.
function onHaState(data) {
  if (data?.new_state?.state !== 'on' || data.old_state?.state !== 'off') return;
  const rows = eventDb
    .prepare('SELECT id, name FROM cameras WHERE enabled = 1 AND motion_entity = ?')
    .all(data.entity_id);
  if (!rows.length || !eventTypes(eventDb).includes('motion')) return;
  const now = Date.now();
  for (const cam of rows) {
    if (now - (lastMotion.get(cam.id) || 0) < MOTION_DEBOUNCE_MS) continue;
    lastMotion.set(cam.id, now);
    emitEvent({
      id: `ha-${cam.id}-${now}`,
      cameraId: cam.id,
      cameraName: cam.name,
      type: 'motion',
      label: null,
      subLabel: null,
      score: null,
      snapshotUrl: `/api/cameras/${cam.id}/snapshot.jpg`,
      ts: now,
    });
  }
}

// Frigate: poll /api/events. A recognised face usually lands as sub_label
// AFTER the event started, so recent events are re-read for SEEN_WINDOW_S and
// a late sub_label is emitted once more as 'face'.
const FRIGATE_ACTIVE_MS = 3000;
const FRIGATE_IDLE_MS = 10000;
const FRIGATE_DOWN_MS = 30000;
const SEEN_WINDOW_S = 120;
const frigate = { url: '', since: 0, down: false, seen: new Map(), timer: null };

async function pollFrigate(base, cams) {
  const now = Date.now() / 1000;
  const after = Math.floor(Math.max(frigate.since, now - SEEN_WINDOW_S));
  const names = [...new Set(cams.map((c) => c.frigate_camera))].join(',');
  let events;
  try {
    const r = await fetch(`${base}/api/events?after=${after}&cameras=${enc(names)}&limit=50&include_thumbnails=0`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    events = await r.json();
  } catch (err) {
    // Once per outage, not every 3s.
    if (!frigate.down) log.warn('[cameras] Frigate unreachable at %s (%s) - retrying quietly', base, err.cause?.code || err.message);
    frigate.down = true;
    return false;
  }
  if (frigate.down) log.info('[cameras] Frigate reachable again');
  frigate.down = false;

  const types = eventTypes(eventDb);
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev?.id) continue;
    const sub = (Array.isArray(ev.sub_label) ? ev.sub_label[0] : ev.sub_label) || null;
    const prev = frigate.seen.get(ev.id);
    let type;
    let id = ev.id;
    if (!prev) {
      frigate.seen.set(ev.id, { face: Boolean(sub), start: ev.start_time || now });
      type = sub && types.includes('face') ? 'face' : 'object';
    } else if (sub && !prev.face) {
      prev.face = true;
      type = 'face';
      id = `${ev.id}:face`;
    } else {
      continue;
    }
    if (!types.includes(type)) continue;
    const matches = cams.filter((c) => c.frigate_camera === ev.camera);
    for (const cam of matches) {
      emitEvent({
        id: matches.length > 1 ? `${id}@${cam.id}` : id,
        cameraId: cam.id,
        cameraName: cam.name,
        type,
        label: ev.label || null,
        subLabel: type === 'face' ? sub : null,
        score: ev.data?.top_score ?? ev.top_score ?? ev.data?.score ?? null,
        snapshotUrl: ev.has_snapshot
          ? `/api/cameras/events/${enc(ev.id)}/snapshot.jpg`
          : `/api/cameras/${cam.id}/snapshot.jpg`,
        ts: Date.now(), // when we learned of it; Frigate's clock may differ
      });
    }
  }
  for (const [id, v] of frigate.seen) if (v.start < now - 2 * SEEN_WINDOW_S) frigate.seen.delete(id);
  return true;
}

async function frigateTick() {
  let delay = FRIGATE_IDLE_MS;
  try {
    const base = frigateBase(eventDb);
    if (base !== frigate.url) {
      // Frigate-kind streams are built from this URL; settings.js does not
      // tell us it changed, so the poller notices and resyncs.
      frigate.url = base;
      frigate.since = Date.now() / 1000;
      frigate.down = false;
      engine.resync();
    }
    const cams = eventDb
      .prepare("SELECT id, name, frigate_camera FROM cameras WHERE enabled = 1 AND frigate_camera != ''")
      .all();
    if (base && cams.length) delay = (await pollFrigate(base, cams)) ? FRIGATE_ACTIVE_MS : FRIGATE_DOWN_MS;
  } catch (err) {
    log.warn('[cameras] Frigate poll failed: %s', err.message);
  }
  frigate.timer = setTimeout(frigateTick, delay);
  frigate.timer.unref?.();
}

function start(ioServer, db, logger) {
  io = ioServer;
  eventDb = db;
  log = logger || console;
  engine.init({ logger: log, getStreams: () => desiredStreams(db) });
  homeAssistant.onStateChanged(onHaState);
  frigate.url = frigateBase(db);
  frigate.since = Date.now() / 1000;
  frigateTick();
}

function stop() {
  clearTimeout(frigate.timer);
  engine.stop();
}

router.start = start;
router.stop = stop;
// For test-cameras.js
router._internals = { splitUrl, maskUrl, keepUrlPassword, sourcesFor, streamPlan, normalize, toPublic };

module.exports = router;
