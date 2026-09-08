'use strict';

const { Router } = require('express');
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
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;

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
      players: states.map((e) => ({
        ...e,
        model: meta[e.entity_id]?.model || '',
        manufacturer: meta[e.entity_id]?.manufacturer || '',
      })),
    });
  } catch (err) {
    logger.error('HA media-players error: %s', err.message);
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
  if (!ensureConfigured(res)) return;
  const logger = req.app.locals.logger;

  const { domain, service } = req.params;

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
          io.emit('ha:state_changed', msg.event?.data || msg.event);
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
