'use strict';

// Sonos speakers, controlled directly over the LAN (UPnP) with @svrooij/sonos.
//
// Sonos rooms are presented to the rest of the app as Home Assistant-shaped
// media players (id `sonos:<RINCON uuid>`). The music picker, cast playback,
// progress bar, auto-advance and alarms all already speak that shape, so they
// work unchanged; homeassistant.js hands `sonos:` ids to this module.
//
// Deliberately NOT SonosManager: it opens an inbound event listener and keeps
// subscriptions alive, which is wasted on a 1GB Pi when state is polled anyway.
// The pieces used are discovery and the zone-group query.
//
// The library sets no network timeouts, so every call here is raced against one:
// a powered-off speaker would otherwise hang a request for minutes.

const { Router } = require('express');
const router = Router();

const PREFIX = 'sonos:';
const RESCAN_MS = 10 * 60 * 1000;
const CALL_TIMEOUT_MS = 4000;
const SCAN_TIMEOUT_MS = 8000;

let lib = null; // lazy: a mirror without Sonos never loads the library
const load = () => lib || (lib = require('@svrooij/sonos'));

let getHosts = () => [];
let logger = console;
let rooms = new Map(); // id -> room
let lastScan = 0;
let scanning = null;
const devices = new Map(); // "host:port" -> SonosDevice

// ---------------------------------------------------------------------------
// Pure helpers (covered by backend/test-sonos.js)
// ---------------------------------------------------------------------------

function withTimeout(promise, ms = CALL_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('sonos: timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** "H:MM:SS" (UPnP) -> seconds. "NOT_IMPLEMENTED" (streams) -> 0. */
function parseHms(value) {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function toHms(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// UPnP transport state -> Home Assistant media_player state. `idle` is what the
// frontend's auto-advance waits for once a track ends; TRANSITIONING is mapped
// to `buffering` so the gap while a track loads is not mistaken for the end.
const STATE = { PLAYING: 'playing', PAUSED_PLAYBACK: 'paused', STOPPED: 'idle', TRANSITIONING: 'buffering' };

/** "192.168.1.5, sonos.lan:1400" -> [{host, port}, ...]; junk dropped. */
function parseHosts(text) {
  return String(text || '').split(/[\s,;]+/)
    .map((h) => /^([\w.-]+)(?::(\d{1,5}))?$/.exec(h))
    .filter(Boolean)
    .map((m) => ({ host: m[1], port: Number(m[2]) || 1400 }));
}

/** Zone groups -> Map of rooms. Invisible members (bonded subs/surrounds) are not rooms. */
function toRooms(groups) {
  const out = new Map();
  for (const g of groups || []) {
    for (const m of g.members || []) {
      if (m.Invisible) continue;
      out.set(PREFIX + m.uuid, {
        id: PREFIX + m.uuid,
        name: m.name,
        host: m.host,
        port: m.port,
        groupSize: (g.members || []).filter((x) => !x.Invisible).length,
        // Transport commands must go to the group coordinator; a non-coordinator
        // member answers AVTransport calls with UPnP error 701.
        coordinator: { host: g.coordinator.host, port: g.coordinator.port },
      });
    }
  }
  return out;
}

/** Transport/position/volume -> HA-shaped entity state. */
function haState(room, transport, position, volume, now = Date.now()) {
  const meta = position && typeof position.TrackMetaData === 'object' ? position.TrackMetaData : {};
  return {
    entity_id: room.id,
    state: STATE[transport.CurrentTransportState] || 'idle',
    attributes: {
      friendly_name: room.name,
      media_position: parseHms(position.RelTime),
      media_position_updated_at: new Date(now).toISOString(),
      media_duration: parseHms(position.TrackDuration),
      media_title: meta.Title || '',
      media_content_id: position.TrackURI || '',
      volume_level: volume.CurrentVolume / 100,
      group_size: room.groupSize,
    },
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function deviceAt({ host, port }) {
  const key = `${host}:${port}`;
  if (!devices.has(key)) devices.set(key, new (load().SonosDevice)(host, port));
  return devices.get(key);
}

async function zonesFrom(host, port) {
  const groups = await withTimeout(new (load().SonosDevice)(host, port).GetZoneGroupState(), SCAN_TIMEOUT_MS);
  return toRooms(groups);
}

/**
 * Find every room in the household. One reachable speaker is enough - it
 * reports the whole topology. Manual addresses go first: SSDP multicast is
 * commonly dropped by WiFi access points, which is the failure mode this
 * setting exists for.
 */
function scan() {
  if (scanning) return scanning;
  scanning = (async () => {
    const seeds = parseHosts(getHosts());
    let found = null;
    for (const seed of seeds) {
      try { found = await zonesFrom(seed.host, seed.port); break; } catch { /* next seed */ }
    }
    if (!found) {
      try {
        const player = await new (load().SonosDeviceDiscovery)().SearchOne(5);
        found = await zonesFrom(player.host, player.port);
      } catch (err) {
        logger.debug?.('Sonos discovery found nothing: %s', err.message);
      }
    }
    lastScan = Date.now();
    if (found && found.size) {
      if (found.size !== rooms.size) logger.info('Sonos: %d room(s) found', found.size);
      rooms = found;
      devices.clear();
    }
    return rooms;
  })().finally(() => { scanning = null; });
  return scanning;
}

// ---------------------------------------------------------------------------
// HA-shaped surface (called from homeassistant.js)
// ---------------------------------------------------------------------------

const owns = (id) => typeof id === 'string' && id.startsWith(PREFIX);

async function state(id) {
  const room = rooms.get(id);
  if (!room) return null;
  try {
    const coordinator = deviceAt(room.coordinator);
    const [transport, position, volume] = await withTimeout(Promise.all([
      coordinator.AVTransportService.GetTransportInfo(),
      coordinator.AVTransportService.GetPositionInfo(),
      deviceAt(room).RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'Master' }),
    ]));
    return haState(room, transport, position, volume);
  } catch {
    return { entity_id: id, state: 'unavailable', attributes: { friendly_name: room.name } };
  }
}

async function players() {
  const all = await Promise.all([...rooms.keys()].map(state));
  return all.filter(Boolean).map((s) => ({ ...s, model: 'Sonos', manufacturer: 'Sonos' }));
}

/** Run one media_player service against a Sonos room. Throws on failure. */
async function act(service, body) {
  const room = rooms.get(body.entity_id);
  if (!room) throw new Error(`unknown Sonos room ${body.entity_id}`);
  const coordinator = deviceAt(room.coordinator);
  const self = deviceAt(room);

  const call = {
    media_play: () => coordinator.Play(),
    media_pause: () => coordinator.Pause(),
    media_stop: () => coordinator.Stop(),
    // The cast code's "quit the receiver app" step; for Sonos that is just stop.
    turn_off: () => coordinator.Stop(),
    media_seek: () => coordinator.SeekPosition(toHms(body.seek_position)),
    volume_set: () => self.SetVolume(Math.round(Math.min(1, Math.max(0, Number(body.volume_level))) * 100)),
    volume_mute: () => self.RenderingControlService.SetMute({ InstanceID: 0, Channel: 'Master', DesiredMute: !!body.is_volume_muted }),
    play_media: async () => {
      if (!/^https?:\/\//i.test(String(body.media_content_id))) throw new Error('play_media needs an http(s) URL');
      // Plain URL, empty metadata: the same call SoCo makes by default, which
      // Sonos accepts for MP3 / AAC-in-MP4 files served with Content-Length.
      await coordinator.SetAVTransportURI(body.media_content_id);
      await coordinator.Play();
    },
  }[service];

  if (!call) throw new Error(`unsupported Sonos service ${service}`);
  await withTimeout(Promise.resolve(call()), 15000);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const summary = () => ({
  scanning: Boolean(scanning),
  lastScan,
  rooms: [...rooms.values()].map(({ id, name, host, groupSize }) => ({ id, name, host, groupSize })),
});

// GET /api/sonos/status - rooms found so far
router.get('/status', (req, res) => res.json(summary()));

// POST /api/sonos/scan - search now (manual IPs first, then SSDP) and report
router.post('/scan', async (req, res) => {
  await scan();
  res.json(summary());
});

/** Wire up config access and start periodic discovery. Called once from server.js. */
function init({ db, logger: log }) {
  logger = log;
  getHosts = () => {
    try {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get('sonosHosts');
      if (!row || row.value == null) return '';
      try { return JSON.parse(row.value); } catch { return String(row.value); }
    } catch { return ''; }
  };
  // Not at boot: the Pi is busy starting Chromium, and most mirrors have no Sonos.
  setTimeout(scan, 30 * 1000).unref();
  setInterval(scan, RESCAN_MS).unref();
}

module.exports = router;
module.exports.init = init;
module.exports.owns = owns;
module.exports.players = players;
module.exports.state = state;
module.exports.act = act;
module.exports.scan = scan;
module.exports._test = { parseHms, toHms, parseHosts, toRooms, haState, withTimeout, STATE };
