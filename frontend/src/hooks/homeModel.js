// Pure model for the Smart Home page. No React, no i18n import: callers pass in
// their own labels (see homeModel.test.mjs, which runs under plain node on
// shapes captured from the real Home Assistant).
//
// Why this exists: the page used to show `entities.slice(0, 4)` - the first four
// lights/switches/media players HA happened to list, out of 27 media players and
// 14 switches - and read a power sensor that does not exist. Everything here
// replaces a guess with a rule that names what it is looking for.

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const domainOf = (entityId) => entityId.split('.')[0];

// ─── Rooms ──────────────────────────────────────────────────────────────────
// A room is whatever has a Wifi IR blaster: `remote.wifi_ir_<room>` carries the
// remote, and the same device reports `sensor.wifi_ir_<room>_temperature` and
// `_humidity`. Discovering rooms this way means a fourth blaster shows up on its
// own instead of needing a code change.

const ROOM_ORDER = ['living_room', 'master_bedroom', 'childrens_room'];

/** "Wifi IR Kitchen" -> "Kitchen"; falls back to the slug. */
function prettyRoomName(friendlyName, slug) {
  const stripped = String(friendlyName || '').replace(/^wifi\s*ir\s*/i, '').trim();
  return stripped || slug.replace(/_/g, ' ');
}

/**
 * @param {Array} states  every HA state
 * @param {Object} names  slug -> display name (Hebrew), supplied by the caller
 * @returns rooms in a stable order: living room, bedrooms, then the rest
 */
export function discoverRooms(states, names = {}) {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const reading = (id) => num(byId.get(id)?.state);
  const rooms = [];
  for (const s of states) {
    const m = /^remote\.wifi_ir_(.+)$/.exec(s.entity_id);
    if (!m) continue;
    const slug = m[1];
    rooms.push({
      slug,
      name: names[slug] || prettyRoomName(s.attributes?.friendly_name, slug),
      remote: s.entity_id,
      remoteOnline: s.state !== 'unavailable',
      temp: reading(`sensor.wifi_ir_${slug}_temperature`),
      humidity: reading(`sensor.wifi_ir_${slug}_humidity`),
    });
  }
  const rank = (slug) => {
    const i = ROOM_ORDER.indexOf(slug);
    return i === -1 ? ROOM_ORDER.length : i;
  };
  return rooms.sort((a, b) => rank(a.slug) - rank(b.slug) || a.name.localeCompare(b.name, 'he'));
}

// ─── Gauges ─────────────────────────────────────────────────────────────────

export const COMFORT_RANGE = { min: 16, max: 32 };

/** Where a value sits on a scale, 0..1, or null when there is no reading. */
export function gaugePosition(value, min, max) {
  const n = num(value);
  return n === null ? null : clamp01((n - min) / (max - min));
}

/** cool < 20 <= ok < 26 <= warm < 29 <= hot (a room reading, in Celsius). */
export function comfortTone(temp) {
  const n = num(temp);
  if (n === null) return null;
  if (n < 20) return 'cool';
  if (n < 26) return 'ok';
  if (n < 29) return 'warm';
  return 'hot';
}

// ─── Devices ────────────────────────────────────────────────────────────────

// HA's switch domain is full of things that are not switches a person wants on a
// wall: utility-company alert toggles, a weather-service sensor toggle, plug
// child-locks, and the Shelly meter's own relay (the meter belongs to the power
// card; its relay is not a light).
const NOT_A_DEVICE = /threshold|alert|leak|consumption|unique_device_name|pre_release|child_lock|_sms|e_mail|meteorological|power_meter/;

// Primary devices stay listed (greyed) when offline so a dead light is visible
// rather than silently gone; switches that are offline are noise and are dropped.
const ALWAYS_LISTED = ['light', 'cover', 'fan', 'lock', 'climate'];
const SWITCH_LIKE = ['switch', 'input_boolean'];

const DEVICE_ORDER = ['light', 'cover', 'switch', 'input_boolean', 'fan', 'lock', 'climate'];

/** Display-name keys for devices whose HA name is a model number or a slug. */
export const DEVICE_NAME_KEYS = {
  'switch.switcher_boiler_ba88': 'deviceBoiler',
  'input_boolean.power': 'deviceMasterPower',
  'cover.smart_curtain_robot_curtain': 'curtain',
};

export function pickDevices(states) {
  const keep = states.filter((e) => {
    const domain = domainOf(e.entity_id);
    if (ALWAYS_LISTED.includes(domain)) return true;
    if (SWITCH_LIKE.includes(domain)) return e.state !== 'unavailable' && !NOT_A_DEVICE.test(e.entity_id);
    return false;
  });
  const rank = (e) => DEVICE_ORDER.indexOf(domainOf(e.entity_id));
  return keep.sort((a, b) => rank(a) - rank(b));
}

/** Resolve a device's display name. `labels` maps a DEVICE_NAME_KEYS value to text. */
export function deviceName(entity, labels = {}) {
  const key = DEVICE_NAME_KEYS[entity.entity_id];
  return (key && labels[key]) || entity.attributes?.friendly_name || entity.entity_id;
}

export function isDeviceOn(entity) {
  switch (domainOf(entity.entity_id)) {
    case 'lock': return entity.state === 'unlocked';
    case 'cover': return entity.state === 'open';
    case 'climate': return entity.state !== 'off' && entity.state !== 'unavailable';
    default: return entity.state === 'on';
  }
}

export const countOn = (devices) => devices.filter(isDeviceOn).length;

// ─── Electricity ────────────────────────────────────────────────────────────
// A Shelly EM reports each channel as sensor.<name>_channel_<n>_power. The old
// tile looked for `sensor.2_power_meter`, which has never existed, so it showed
// "--" while the real meter read 2.6 kW.

export function powerReading(states) {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  let prefix = null;
  const channels = [];
  for (const s of states) {
    const m = /^sensor\.(.+)_channel_(\d+)_power$/.exec(s.entity_id);
    if (!m || s.attributes?.unit_of_measurement !== 'W') continue;
    if (prefix === null) prefix = m[1];
    if (m[1] !== prefix) continue; // one meter; a second would double-count the house
    const w = num(s.state);
    if (w !== null) channels.push({ n: Number(m[2]), w });
  }
  if (!channels.length) return null;
  const first = Math.min(...channels.map((c) => c.n));
  return {
    watts: channels.reduce((sum, c) => sum + c.w, 0),
    volts: num(byId.get(`sensor.${prefix}_channel_${first}_voltage`)?.state),
    totalKwh: num(byId.get(`sensor.${prefix}_channel_${first}_energy`)?.state),
  };
}

export const POWER_SCALE_MAX = 4000;

/** low < 500 W <= mid <= 2000 W < high  (same bands the old tile used). */
export function powerTone(watts) {
  const n = num(watts);
  if (n === null) return null;
  if (n < 500) return 'low';
  if (n <= 2000) return 'mid';
  return 'high';
}

// ─── Scenes ─────────────────────────────────────────────────────────────────
// Offering four scene buttons when HA has no scenes gave four buttons that did
// nothing. A scene is shown only when its entity exists.

export const visibleScenes = (states, config) => {
  const ids = new Set(states.map((s) => s.entity_id));
  return config.filter((scene) => ids.has(scene.entityId));
};

// ─── Living-room TV remote ──────────────────────────────────────────────────
// The living-room blaster has no generic command set: the TV is driven by HA
// scripts that carry the right device name, repeats and delays. The remote is a
// thin face over them, so fixing a script in HA fixes the button.

export const TV_REMOTE_SCRIPTS = {
  power: 'script.tv',
  volume_up: 'script.tv_volume_up',
  volume_down: 'script.volume_down',
  mute: 'script.mute',
  source: 'script.source',
  hdmi: 'script.hdmi_input',
  up: 'script.up',
  down: 'script.down',
  left: 'script.left',
  right: 'script.right',
  ok: 'script.ok',
  back: 'script.return',
  menu: 'script.tools',
  exit: 'script.exit',
};

/** The living room is the room whose TV those scripts drive. */
export const remoteScriptsFor = (room) => (room.slug === 'living_room' ? TV_REMOTE_SCRIPTS : null);

/** IR-only table backlight (no state to read back, so two buttons, not a toggle). */
export const TABLE_BACKLIGHT = { on: 'script.table_backlight_on', off: 'script.table_backlight_off' };

// ─── Air conditioner presets ────────────────────────────────────────────────
// `room` is one blaster's entry from GET /api/ha/ac-presets:
//   { off: 'script.x' | null, on: [{ mode, temp, fan, script }] }
// The popup offers exactly the presets HA has. With IR there is no way to read
// the AC's state back, so nothing here pretends to know it.

const AC_MODE_ORDER = ['cold', 'heat', 'dry', 'fan', 'auto'];
const AC_FAN_ORDER = ['low', 'mid', 'high', 'auto'];
const byOrder = (order) => (a, b) => order.indexOf(a) - order.indexOf(b);

export const acModes = (room) => [...new Set((room?.on || []).map((p) => p.mode))].sort(byOrder(AC_MODE_ORDER));

export const acTemps = (room, mode) =>
  [...new Set((room?.on || []).filter((p) => p.mode === mode).map((p) => p.temp))].sort((a, b) => a - b);

export const acFans = (room, mode, temp) =>
  (room?.on || []).filter((p) => p.mode === mode && p.temp === temp).map((p) => p.fan).sort(byOrder(AC_FAN_ORDER));

export const findAcPreset = (room, sel) =>
  (room?.on || []).find((p) => p.mode === sel.mode && p.temp === sel.temp && p.fan === sel.fan) || null;

/** Keep the fan speed if the new (mode, temp) has it, else the slowest it has. */
function withFan(room, mode, temp, fan) {
  const fans = acFans(room, mode, temp);
  return { mode, temp, fan: fans.includes(fan) ? fan : fans[0] };
}

/**
 * Where the popup opens. A preset the user already taught HA (an IR script) is a
 * known-good starting point - cooling at 24 - so prefer the first of those; with
 * a wide catalogue, "the lowest temperature" would open at 16 degrees.
 */
export function acDefaultSelection(room) {
  const ir = acModes({ on: (room?.on || []).filter((p) => p.script) })[0];
  const mode = ir || acModes(room)[0];
  if (!mode) return null;
  const known = (room.on || []).filter((p) => p.script && p.mode === mode);
  const temp = known.length ? Math.min(...known.map((p) => p.temp)) : acTemps(room, mode)[0];
  return withFan(room, mode, temp, 'low');
}

/** Switch mode: keep the temperature if the new mode has it, else the closest one. */
export function acSelectMode(room, sel, mode) {
  const temps = acTemps(room, mode);
  if (!temps.length) return sel;
  const temp = temps.includes(sel.temp)
    ? sel.temp
    : temps.reduce((best, t) => (Math.abs(t - sel.temp) < Math.abs(best - sel.temp) ? t : best), temps[0]);
  return withFan(room, mode, temp, sel.fan);
}

/** One step up (+1) or down (-1) through the temperatures this mode really has. */
export function acStepTemp(room, sel, direction) {
  const temps = acTemps(room, sel.mode);
  const i = temps.indexOf(sel.temp);
  const next = temps[i + direction];
  return next === undefined ? sel : withFan(room, sel.mode, next, sel.fan);
}
