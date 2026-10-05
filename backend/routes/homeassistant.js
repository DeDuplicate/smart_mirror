'use strict';

const { Router } = require('express');
const sonos = require('./sonos');
const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let configDb = null;

function getConfigValue(key) {
  if (!configDb) return '';
  try {
    const row = configDb.prepare('SELECT value FROM config WHERE key = ?').get(key);
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

function getHAConfig() {
  const host = process.env.HA_HOST || getConfigValue('haHost') || 'http://homeassistant.local:8123';
  const token = process.env.HA_TOKEN || getConfigValue('haToken');
  return { host: host.replace(/\/+$/, ''), token };
}

function haHeaders() {
  const { token } = getHAConfig();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function ensureConfigured(res) {
  const { token } = getHAConfig();
  if (!token) {
    res.status(503).json({ error: 'Home Assistant not configured — HA_TOKEN missing' });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/ha/states — all entity states
// ---------------------------------------------------------------------------
router.get('/states', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;

  try {
    const { host } = getHAConfig();
    const response = await fetch(`${host}/api/states`, {
      headers: haHeaders(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    const states = await response.json();
    res.json({ states });
  } catch (err) {
    logger.error('HA states error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ha/media-players — states enriched with manufacturer + model
//
// `/api/states` alone cannot tell a Nest Mini from a Nest Hub: both are
// `media_player` entities and Home Assistant often sets no `device_class`, so
// a speaker named after its room ("Master Bedroom") looks identical to a TV.
// Guessing from the friendly name is what previously filed a Nest Hub under
// "TVs" and a Nest Mini under "other".
//
// The manufacturer/model live in HA's DEVICE registry, which the REST API does
// not expose - but `device_attr()` in a template does, so one POST /api/template
// call returns the lot without any WebSocket plumbing. Registry data barely
// changes, so it is cached; live state still comes fresh from /api/states.
// ---------------------------------------------------------------------------

const DEVICE_META_TTL_MS = 60 * 60 * 1000;
let deviceMetaCache = { at: 0, map: {} };

const DEVICE_META_TEMPLATE = `
{%- set out = namespace(rows=[]) -%}
{%- for s in states.media_player -%}
  {%- set out.rows = out.rows + [{
    "entity_id": s.entity_id,
    "model": device_attr(s.entity_id, "model"),
    "manufacturer": device_attr(s.entity_id, "manufacturer")
  }] -%}
{%- endfor -%}
{{ out.rows | tojson }}
`.trim();

async function fetchDeviceMeta(logger) {
  if (Date.now() - deviceMetaCache.at < DEVICE_META_TTL_MS) return deviceMetaCache.map;

  const { host } = getHAConfig();
  const response = await fetch(`${host}/api/template`, {
    method: 'POST',
    headers: haHeaders(),
    body: JSON.stringify({ template: DEVICE_META_TEMPLATE }),
  });
  if (!response.ok) {
    throw new Error(`HA template ${response.status}: ${await response.text()}`);
  }

  const rows = JSON.parse(await response.text());
  const map = {};
  for (const row of rows) {
    if (!row?.entity_id) continue;
    map[row.entity_id] = {
      model: row.model && row.model !== 'None' ? row.model : '',
      manufacturer: row.manufacturer && row.manufacturer !== 'None' ? row.manufacturer : '',
    };
  }
  deviceMetaCache = { at: Date.now(), map };
  logger.info('HA device metadata cached for %d media players', Object.keys(map).length);
  return map;
}

router.get('/media-players', async (req, res) => {
  const logger = req.app.locals.logger;

  // Sonos rooms are controlled directly, so they are listed even when Home
  // Assistant is unconfigured or down.
  const sonosPlayers = await sonos.players().catch(() => []);
  if (!getHAConfig().token) return res.json({ players: sonosPlayers });

  try {
    const { host } = getHAConfig();
    const response = await fetch(`${host}/api/states`, { headers: haHeaders() });
    if (!response.ok) {
      throw new Error(`HA API ${response.status}: ${await response.text()}`);
    }
    const states = (await response.json()).filter((e) =>
      String(e.entity_id).startsWith('media_player.')
    );

    // Enrichment is a bonus: if the template call fails (old HA, permissions)
    // fall back to bare states rather than losing the device list entirely.
    let meta = {};
    try {
      meta = await fetchDeviceMeta(logger);
    } catch (err) {
      logger.warn('HA device metadata unavailable, falling back to states only: %s', err.message);
    }

    res.json({
      players: [
        ...states.map((e) => ({
          ...e,
          model: meta[e.entity_id]?.model || '',
          manufacturer: meta[e.entity_id]?.manufacturer || '',
        })),
        ...sonosPlayers,
      ],
    });
  } catch (err) {
    logger.error('HA media-players error: %s', err.message);
    if (sonosPlayers.length) return res.json({ players: sonosPlayers });
    res.status(502).json({ error: err.message });
  }
});


// ---------------------------------------------------------------------------
// GET /api/ha/entities — discover entities (grouped by domain)
// ---------------------------------------------------------------------------
router.get('/entities', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;

  try {
    const { host } = getHAConfig();
    const response = await fetch(`${host}/api/states`, {
      headers: haHeaders(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    const states = await response.json();

    // Group entities by domain
    const grouped = {};
    for (const entity of states) {
      const domain = entity.entity_id.split('.')[0];
      if (!grouped[domain]) grouped[domain] = [];
      grouped[domain].push({
        entity_id: entity.entity_id,
        friendly_name: entity.attributes?.friendly_name || entity.entity_id,
        state: entity.state,
        attributes: entity.attributes,
      });
    }

    res.json({ entities: grouped, total: states.length });
  } catch (err) {
    logger.error('HA entities error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ha/services/:domain/:service — call HA service
// ---------------------------------------------------------------------------
router.post('/services/:domain/:service', async (req, res) => {
  const logger = req.app.locals.logger;
  const { domain, service } = req.params;

  if (domain === 'media_player' && sonos.owns(req.body?.entity_id)) {
    try {
      await sonos.act(service, req.body);
      return res.json({ result: [] });
    } catch (err) {
      logger.error('Sonos %s error: %s', service, err.message);
      return res.status(502).json({ error: err.message });
    }
  }

  if (!ensureConfigured(res)) return;

  try {
    const { host } = getHAConfig();
    const response = await fetch(
      `${host}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      {
        method: 'POST',
        headers: haHeaders(),
        body: JSON.stringify(req.body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA service call ${response.status}: ${text}`);
    }

    const result = await response.json();
    logger.info('HA service called: %s.%s', domain, service);

    // Notify connected clients about the state change
    const io = req.app.locals.io;
    if (io) {
      io.emit('ha:service_called', { domain, service, data: req.body });
    }

    res.json({ result });
  } catch (err) {
    logger.error('HA service error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ha/todo/:entity_id — fetch todo list items
// ---------------------------------------------------------------------------
router.get('/todo/:entity_id', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;
  const entityId = req.params.entity_id;

  try {
    const { host } = getHAConfig();
    // todo.get_items is a response-data service — HA 400s without
    // ?return_response ("Service call requires responses but caller did
    // not ask for responses").
    const response = await fetch(
      `${host}/api/services/todo/get_items?return_response`,
      {
        method: 'POST',
        headers: haHeaders(),
        body: JSON.stringify({ entity_id: entityId }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    const result = await response.json();
    // With ?return_response the REST API wraps the service data:
    // { changed_states: [...], service_response: { "<entity_id>": { items: [...] } } }.
    // Older shapes (bare service response / state-objects array / flat
    // {items}) kept as fallbacks.
    const items =
      result?.service_response?.[entityId]?.items ||
      result?.[entityId]?.items ||
      (Array.isArray(result)
        ? result.find((e) => e.entity_id === entityId)?.attributes?.items
        : null) ||
      result?.items ||
      [];

    res.json({ items });
  } catch (err) {
    logger.error('HA todo fetch error: %s', err.message);
    // Fallback: try fetching from entity state directly
    try {
      const { host } = getHAConfig();
      const stateRes = await fetch(`${host}/api/states/${encodeURIComponent(entityId)}`, {
        headers: haHeaders(),
      });
      if (stateRes.ok) {
        const state = await stateRes.json();
        res.json({ items: state.attributes?.items || [], state: state.state });
      } else {
        res.status(502).json({ error: err.message });
      }
    } catch (err2) {
      res.status(502).json({ error: err2.message });
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/ha/todo/:entity_id/add — add item to todo list
// ---------------------------------------------------------------------------
router.post('/todo/:entity_id/add', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;
  const entityId = req.params.entity_id;
  const { item } = req.body;

  if (!item) {
    return res.status(400).json({ error: 'Missing "item" field' });
  }

  try {
    const { host } = getHAConfig();
    const response = await fetch(
      `${host}/api/services/todo/add_item`,
      {
        method: 'POST',
        headers: haHeaders(),
        body: JSON.stringify({ entity_id: entityId, item }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    logger.info('Todo item added to %s: %s', entityId, item);
    res.json({ ok: true });
  } catch (err) {
    logger.error('HA todo add error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ha/todo/:entity_id/update — update item in todo list (complete/rename)
// ---------------------------------------------------------------------------
router.post('/todo/:entity_id/update', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;
  const entityId = req.params.entity_id;
  const { item, rename, status } = req.body;

  if (!item) {
    return res.status(400).json({ error: 'Missing "item" field' });
  }

  try {
    const { host } = getHAConfig();
    const body = { entity_id: entityId, item };
    if (rename) body.rename = rename;
    if (status) body.status = status;

    const response = await fetch(
      `${host}/api/services/todo/update_item`,
      {
        method: 'POST',
        headers: haHeaders(),
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    logger.info('Todo item updated in %s: %s -> status=%s', entityId, item, status || 'unchanged');
    res.json({ ok: true });
  } catch (err) {
    logger.error('HA todo update error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ha/todo/:entity_id/remove — remove item from todo list
// ---------------------------------------------------------------------------
router.post('/todo/:entity_id/remove', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;
  const entityId = req.params.entity_id;
  const { item } = req.body;

  if (!item) {
    return res.status(400).json({ error: 'Missing "item" field' });
  }

  try {
    const { host } = getHAConfig();
    const response = await fetch(
      `${host}/api/services/todo/remove_item`,
      {
        method: 'POST',
        headers: haHeaders(),
        body: JSON.stringify({ entity_id: entityId, item }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    logger.info('Todo item removed from %s: %s', entityId, item);
    res.json({ ok: true });
  } catch (err) {
    logger.error('HA todo remove error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ha/state/:entity_id — fetch a single entity state (lightweight;
// used e.g. to poll media_player position while casting without pulling all
// ~383 entity states each tick).
// ---------------------------------------------------------------------------
router.get('/state/:entity_id', async (req, res) => {
  const logger = req.app.locals.logger;
  const entityId = req.params.entity_id;

  if (sonos.owns(entityId)) {
    const st = await sonos.state(entityId);
    return st ? res.json({ state: st }) : res.status(404).json({ error: 'unknown Sonos speaker' });
  }

  if (!ensureConfigured(res)) return;

  try {
    const { host } = getHAConfig();
    const response = await fetch(
      `${host}/api/states/${encodeURIComponent(entityId)}`,
      { headers: haHeaders() }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    const state = await response.json();
    res.json({ state });
  } catch (err) {
    logger.error('HA state entity error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ha/weather/:entity_id — fetch weather entity state (for IMS)
// ---------------------------------------------------------------------------
router.get('/weather/:entity_id', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;
  const entityId = req.params.entity_id;

  try {
    const { host } = getHAConfig();
    const response = await fetch(
      `${host}/api/states/${encodeURIComponent(entityId)}`,
      { headers: haHeaders() }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API ${response.status}: ${text}`);
    }

    const state = await response.json();
    res.json({ state });
  } catch (err) {
    logger.error('HA weather entity error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ha/script-health?ids=script.a,script.b
//
// The living-room TV remote is a face over HA scripts. Several of them send
// their IR code through a blaster entity that no longer exists in HA, and HA
// answers a call to such a script with a happy 200 and then logs the failure
// where nobody on the mirror will see it - the button just does nothing. This
// reads each script's definition and reports whether everything it targets is
// there, so the remote can say so instead of staying silent.
//
// Scripts HA will not show us (YAML-defined) report ok: unknown, not broken.
// ---------------------------------------------------------------------------
const SCRIPT_HEALTH_TTL_MS = 60 * 1000;
let scriptHealthCache = { at: 0, key: '', body: null };

/** Entity ids a script's top-level actions aim at. */
function scriptTargets(config) {
  const out = new Set();
  for (const step of (config && config.sequence) || []) {
    const ids = [].concat((step && step.target && step.target.entity_id) || (step && step.entity_id) || []);
    ids.filter((id) => typeof id === 'string').forEach((id) => out.add(id));
  }
  return [...out];
}

router.get('/script-health', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;
  const ids = [...new Set(String(req.query.ids || '').split(',').map((s) => s.trim()))]
    .filter((id) => /^script\.[a-z0-9_]+$/.test(id))
    .slice(0, 40);
  const key = ids.slice().sort().join(',');

  if (scriptHealthCache.key === key && Date.now() - scriptHealthCache.at < SCRIPT_HEALTH_TTL_MS) {
    return res.json(scriptHealthCache.body);
  }

  try {
    const { host } = getHAConfig();
    const statesRes = await fetch(`${host}/api/states`, { headers: haHeaders() });
    if (!statesRes.ok) throw new Error(`HA API ${statesRes.status}`);
    const live = new Set((await statesRes.json()).map((s) => s.entity_id));

    const scripts = {};
    await Promise.all(ids.map(async (id) => {
      const r = await fetch(`${host}/api/config/script/config/${id.slice('script.'.length)}`, { headers: haHeaders() });
      if (!r.ok) { scripts[id] = { ok: true, unknown: true }; return; }
      const missing = scriptTargets(await r.json()).filter((target) => !live.has(target));
      scripts[id] = { ok: missing.length === 0, missing };
    }));

    const body = { scripts };
    scriptHealthCache = { at: Date.now(), key, body };
    res.json(body);
  } catch (err) {
    logger.error('HA script-health error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ha/ac-presets
//
// The air conditioners are driven by learned IR commands that live in HA
// scripts ("Power On Cold 24 Low", "AirCon Power OFF"). The AC popup used to
// guess script names from a temperature/fan pattern (`script.aircon_26_low_on`)
// that matches almost nothing HA has - HA has presets (cool 24, heat 30, three
// fan speeds, off), and the popup offered a 13-temperature dial on top of them,
// so almost every press called a script that does not exist.
//
// This reads the scripts that HA really has and reports, per IR blaster, which
// (mode, temperature, fan) presets exist and which script performs each, so the
// popup can offer exactly those. Add a script (or later a generated code) and
// the popup grows with no code change.
// ---------------------------------------------------------------------------

const AC_ON = /^power on (cold|heat|dry|fan|auto) (\d{2}) (low|mid|high|auto)$/i;
const AC_OFF = /^aircon power off$/i;
const FAN_RANK = { low: 0, mid: 1, high: 2, auto: 3 };

/** "Power On Cold 24 Low" -> { kind:'on', mode:'cold', temp:24, fan:'low' }; "AirCon Power OFF" -> { kind:'off' }. */
function parseAcCommand(command) {
  const text = String(command || '').trim();
  const on = AC_ON.exec(text);
  if (on) return { kind: 'on', mode: on[1].toLowerCase(), temp: Number(on[2]), fan: on[3].toLowerCase() };
  if (AC_OFF.test(text)) return { kind: 'off' };
  return null;
}

/**
 * items: [{ script, blaster, command }] -> { [blaster]: { off, on: [{ mode, temp, fan, script }] } }
 * Two scripts that send the same thing to the same blaster are one preset (the
 * kids' room has a stray duplicate); the alphabetically first script wins so
 * the answer does not change between runs.
 */
function buildAcCatalog(items) {
  const catalog = {};
  for (const item of [...items].sort((a, b) => a.script.localeCompare(b.script))) {
    const parsed = parseAcCommand(item.command);
    if (!parsed || !item.blaster) continue;
    const room = (catalog[item.blaster] = catalog[item.blaster] || { off: null, on: [] });
    if (parsed.kind === 'off') {
      if (!room.off) room.off = item.script;
    } else if (!room.on.some((p) => p.mode === parsed.mode && p.temp === parsed.temp && p.fan === parsed.fan)) {
      room.on.push({ mode: parsed.mode, temp: parsed.temp, fan: parsed.fan, script: item.script });
    }
  }
  for (const room of Object.values(catalog)) {
    room.on.sort((a, b) => a.mode.localeCompare(b.mode) || a.temp - b.temp || FAN_RANK[a.fan] - FAN_RANK[b.fan]);
  }
  return catalog;
}

const AC_CACHE_TTL_MS = 5 * 60 * 1000;
let acCache = { at: 0, body: null };

router.get('/ac-presets', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;
  if (acCache.body && Date.now() - acCache.at < AC_CACHE_TTL_MS) return res.json(acCache.body);

  try {
    const { host } = getHAConfig();
    const statesRes = await fetch(`${host}/api/states`, { headers: haHeaders() });
    if (!statesRes.ok) throw new Error(`HA API ${statesRes.status}`);
    const scriptIds = (await statesRes.json())
      .map((s) => s.entity_id)
      .filter((id) => /^script\.[a-z0-9_]+$/.test(id));

    // Read every script's definition, a few at a time (HA may be a WAN hop away).
    const found = [];
    for (let i = 0; i < scriptIds.length; i += 8) {
      await Promise.all(scriptIds.slice(i, i + 8).map(async (id) => {
        const r = await fetch(`${host}/api/config/script/config/${id.slice('script.'.length)}`, { headers: haHeaders() });
        if (!r.ok) return;
        for (const step of (await r.json()).sequence || []) {
          if ((step.action || step.service) !== 'remote.send_command' || typeof step.data?.command !== 'string') continue;
          if (!parseAcCommand(step.data.command)) continue;
          found.push({
            script: id,
            command: step.data.command,
            entity: [].concat(step.target?.entity_id || step.entity_id || [])[0] || null,
            device: [].concat(step.target?.device_id || [])[0] || null,
          });
        }
      }));
    }

    // A script may name its blaster by device instead of entity; resolve those
    // devices to their remote entity in one template call.
    const devices = [...new Set(found.map((f) => f.device).filter((d) => d && /^[a-f0-9]{32}$/.test(d)))];
    const blasterOf = {};
    if (devices.length) {
      const template = `{%- set out = namespace(rows=[]) -%}
{%- for d in ${JSON.stringify(devices)} -%}
  {%- set e = device_entities(d) | select('match', 'remote\\\\.') | list -%}
  {%- set out.rows = out.rows + [[d, e[0] if e else '']] -%}
{%- endfor -%}
{{ out.rows | tojson }}`;
      const tr = await fetch(`${host}/api/template`, { method: 'POST', headers: haHeaders(), body: JSON.stringify({ template }) });
      if (tr.ok) for (const [d, e] of JSON.parse(await tr.text())) blasterOf[d] = e;
    }

    const body = {
      presets: buildAcCatalog(found.map((f) => ({ script: f.script, command: f.command, blaster: f.entity || blasterOf[f.device] || null }))),
    };
    acCache = { at: Date.now(), body };
    res.json(body);
  } catch (err) {
    logger.error('HA ac-presets error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

router._test = { parseAcCommand, buildAcCatalog };

// ---------------------------------------------------------------------------
// POST /api/ha/remote/:entity_id/command — send IR remote command
// ---------------------------------------------------------------------------
router.post('/remote/:entity_id/command', async (req, res) => {
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;

  const { entity_id } = req.params;
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({ error: 'Missing "command" in request body' });
  }

  try {
    const { host } = getHAConfig();
    const response = await fetch(
      `${host}/api/services/remote/send_command`,
      {
        method: 'POST',
        headers: haHeaders(),
        body: JSON.stringify({
          entity_id: entity_id,
          command: command,
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA remote command ${response.status}: ${text}`);
    }

    const result = await response.json();
    logger.info('HA IR remote command: %s -> %s', entity_id, command);
    res.json({ result });
  } catch (err) {
    logger.error('HA remote command error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// WebSocket relay setup — subscribe to HA events and forward via Socket.io
// ---------------------------------------------------------------------------
let haWebSocket = null;
let haWsReconnectTimer = null;
// Backend modules that want state_changed too (cameras: motion sensors).
const stateListeners = [];

function setupHAWebSocketRelay(io, logger, db) {
  configDb = db || configDb;
  const { host, token } = getHAConfig();
  if (!token) {
    logger.warn('HA WebSocket relay not started — HA_TOKEN not set');
    return;
  }

  // Convert http(s) to ws(s)
  const wsUrl = host.replace(/^http/, 'ws') + '/api/websocket';

  function connect() {
    // Dynamic import for WebSocket (Node 18+ has experimental WebSocket, but
    // we wrap in try/catch for compatibility)
    let WS;
    try {
      WS = globalThis.WebSocket || require('ws');
    } catch {
      logger.warn('WebSocket not available — HA relay disabled (install "ws" package for full support)');
      return;
    }

    try {
      haWebSocket = new WS(wsUrl);
    } catch {
      logger.warn('Failed to create WebSocket to HA — will retry in 30s');
      haWsReconnectTimer = setTimeout(connect, 30000);
      return;
    }

    let msgId = 1;

    haWebSocket.onopen = () => {
      logger.info('HA WebSocket connected');
    };

    haWebSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());

        if (msg.type === 'auth_required') {
          // Authenticate
          haWebSocket.send(JSON.stringify({ type: 'auth', access_token: token }));
        } else if (msg.type === 'auth_ok') {
          logger.info('HA WebSocket authenticated');
          // Subscribe to state-changed events
          haWebSocket.send(
            JSON.stringify({ id: msgId++, type: 'subscribe_events', event_type: 'state_changed' })
          );
        } else if (msg.type === 'auth_invalid') {
          logger.error('HA WebSocket auth failed: %s', msg.message);
          haWebSocket.close();
        } else if (msg.type === 'event') {
          // Forward to Socket.io clients
          const data = msg.event?.data || msg.event;
          io.emit('ha:state_changed', data);
          for (const fn of stateListeners) {
            try {
              fn(data);
            } catch (err) {
              logger.warn('HA state listener failed: %s', err.message);
            }
          }
        }
      } catch (err) {
        logger.error('HA WebSocket message parse error: %s', err.message);
      }
    };

    haWebSocket.onerror = (err) => {
      logger.error('HA WebSocket error: %s', err.message || 'unknown');
    };

    haWebSocket.onclose = () => {
      logger.info('HA WebSocket closed — reconnecting in 30s');
      haWsReconnectTimer = setTimeout(connect, 30000);
    };
  }

  connect();
}

// Export the relay setup so server.js can call it after io is ready
module.exports = router;
module.exports.setupHAWebSocketRelay = setupHAWebSocketRelay;
module.exports.onStateChanged = (fn) => stateListeners.push(fn);

// Cleanup helper
module.exports.closeHAWebSocket = function () {
  if (haWsReconnectTimer) clearTimeout(haWsReconnectTimer);
  if (haWebSocket) {
    try {
      haWebSocket.close();
    } catch {
      // ignore
    }
  }
};
