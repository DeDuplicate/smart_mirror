// Self-check for the Smart Home page model.  Run: node homeModel.test.mjs
// Fixtures are trimmed from the real Home Assistant (2026-10-05): the entity ids,
// states and units are the ones the page actually has to cope with.
import assert from 'node:assert/strict';
import {
  discoverRooms, gaugePosition, comfortTone, pickDevices, deviceName, isDeviceOn, countOn,
  powerReading, powerTone, visibleScenes, remoteScriptsFor, TV_REMOTE_SCRIPTS,
} from './homeModel.js';

const s = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

const REAL = [
  s('remote.wifi_ir_master_bedroom', 'on', { friendly_name: 'Wifi IR Master Bedroom' }),
  s('remote.wifi_ir_living_room', 'on', { friendly_name: 'Wifi IR Living Room' }),
  s('remote.wifi_ir_childrens_room', 'on', { friendly_name: 'Wifi IR Childrens Room' }),
  s('remote.shield', 'off', { friendly_name: 'SHIELD' }),               // Android TV remote: not a room
  s('sensor.wifi_ir_living_room_temperature', '21.48', { unit_of_measurement: '°C' }),
  s('sensor.wifi_ir_living_room_humidity', '59.09', { unit_of_measurement: '%' }),
  s('sensor.wifi_ir_master_bedroom_temperature', '25.64'),
  s('sensor.wifi_ir_master_bedroom_humidity', '47.35'),
  s('sensor.wifi_ir_childrens_room_temperature', '26.42'),
  s('sensor.wifi_ir_childrens_room_humidity', 'unavailable'),            // a sensor can drop out

  s('light.cololight', 'on', { friendly_name: 'Cololight', brightness: 74 }),
  s('cover.smart_curtain_robot_curtain', 'open', { friendly_name: 'Smart curtain robot 2 וילון' }),
  s('input_boolean.power', 'on', { friendly_name: 'power' }),
  s('switch.switcher_boiler_ba88', 'off', { friendly_name: 'Switcher Boiler BA88' }),
  s('switch.2_power_meter', 'off', { friendly_name: 'shellyem-BCFF4DFD02F1' }),
  s('switch.israel_meteorological_service_sensor_pre_release', 'on'),
  s('switch.wifi_plug_child_lock', 'unavailable'),
  s('switch.wifi_plug_socket_1', 'unavailable'),
  s('switch.tasmota', 'unavailable'),
  s('switch.shlvmyt_bvknyq_5901390_daily_threshold_exceeded_sms', 'on'),
  s('switch.shlvmyt_bvknyq_5901390_leak_alert_sms', 'on'),
  s('switch.shlvmyt_bvknyq_5901390_use_unique_device_name', 'on'),
  s('media_player.tv', 'off'),
  s('media_player.shield_3', 'off'),

  s('sensor.2_power_meter_channel_1_power', '2666.48', { unit_of_measurement: 'W' }),
  s('sensor.2_power_meter_channel_2_power', '0.0', { unit_of_measurement: 'W' }),
  s('sensor.2_power_meter_channel_1_voltage', '233.79', { unit_of_measurement: 'V' }),
  s('sensor.2_power_meter_channel_1_energy', '27672.7941', { unit_of_measurement: 'kWh' }),
  s('sensor.rmx3301_battery_power', '0.0', { unit_of_measurement: 'W' }),  // a phone, not the house
];

// ─── Rooms ──────────────────────────────────────────────────────────────────
const names = { living_room: 'סלון', master_bedroom: 'חדר שינה', childrens_room: 'חדר ילדים' };
const rooms = discoverRooms(REAL, names);
assert.deepEqual(rooms.map((r) => r.slug), ['living_room', 'master_bedroom', 'childrens_room'],
  'living room first, whatever order HA lists them in');
assert.equal(rooms[0].name, 'סלון');
assert.equal(rooms[0].remote, 'remote.wifi_ir_living_room');
assert.equal(rooms[0].temp, 21.48);
assert.equal(rooms[0].humidity, 59.09);
assert.equal(rooms[2].humidity, null, 'an unavailable sensor reads as no reading, never NaN');
assert.ok(!rooms.some((r) => r.remote === 'remote.shield'), 'only Wifi IR blasters define rooms');

const withKitchen = discoverRooms([...REAL, s('remote.wifi_ir_kitchen', 'on', { friendly_name: 'Wifi IR Kitchen' })], names);
assert.equal(withKitchen.at(-1).name, 'Kitchen', 'a new blaster appears on its own, after the known rooms');
assert.deepEqual(discoverRooms([], names), []);

// ─── Gauges ─────────────────────────────────────────────────────────────────
assert.equal(gaugePosition(24, 16, 32), 0.5);
assert.equal(gaugePosition(10, 16, 32), 0, 'clamped below');
assert.equal(gaugePosition(99, 16, 32), 1, 'clamped above');
assert.equal(gaugePosition(null, 16, 32), null);
assert.equal(gaugePosition('abc', 16, 32), null);
assert.deepEqual([19.9, 20, 25.9, 26, 28.9, 29].map(comfortTone), ['cool', 'ok', 'ok', 'warm', 'warm', 'hot']);
assert.equal(comfortTone(null), null);

// ─── Devices ────────────────────────────────────────────────────────────────
const devices = pickDevices(REAL);
assert.deepEqual(devices.map((d) => d.entity_id), [
  'light.cololight',
  'cover.smart_curtain_robot_curtain',
  'switch.switcher_boiler_ba88',
  'input_boolean.power',
], 'the real devices, in a stable order - none of the 14 switches\' noise, no media players');
assert.ok(!devices.some((d) => d.entity_id === 'switch.2_power_meter'), "the meter's relay belongs to the power card");

const offlineLight = pickDevices([s('light.lamp', 'unavailable'), s('switch.plug', 'unavailable')]);
assert.deepEqual(offlineLight.map((d) => d.entity_id), ['light.lamp'], 'an offline light stays visible; an offline plug is dropped');

const labels = { deviceBoiler: 'דוד מים', deviceMasterPower: 'מתג ראשי', curtain: 'וילון חכם' };
assert.equal(deviceName(REAL.find((e) => e.entity_id === 'switch.switcher_boiler_ba88'), labels), 'דוד מים');
assert.equal(deviceName(REAL.find((e) => e.entity_id === 'input_boolean.power'), labels), 'מתג ראשי', 'not "power"');
assert.equal(deviceName(REAL.find((e) => e.entity_id === 'light.cololight'), labels), 'Cololight', 'falls back to HA\'s own name');
assert.equal(deviceName(s('light.x', 'on'), {}), 'light.x', 'and finally the id');

assert.equal(isDeviceOn(s('cover.c', 'open')), true);
assert.equal(isDeviceOn(s('cover.c', 'closed')), false);
assert.equal(isDeviceOn(s('lock.l', 'unlocked')), true);
assert.equal(countOn(devices), 3, 'light, curtain and master power are on; the boiler is off');

// ─── Electricity ────────────────────────────────────────────────────────────
const power = powerReading(REAL);
assert.equal(power.watts, 2666.48, 'channels summed; the phone battery sensor is ignored');
assert.equal(power.volts, 233.79);
assert.equal(power.totalKwh, 27672.7941);
assert.equal(powerReading([s('sensor.x', '1')]), null, 'no meter -> no card, not a fake "--" reading');
const two = powerReading([
  s('sensor.a_channel_1_power', '100', { unit_of_measurement: 'W' }),
  s('sensor.a_channel_2_power', '50', { unit_of_measurement: 'W' }),
  s('sensor.b_channel_1_power', '999', { unit_of_measurement: 'W' }),
]);
assert.equal(two.watts, 150, 'a second meter is not added to the first');
assert.deepEqual([0, 499, 500, 2000, 2001].map(powerTone), ['low', 'low', 'mid', 'mid', 'high']);
assert.equal(powerTone(null), null);

// ─── Scenes ─────────────────────────────────────────────────────────────────
const SCENES = [{ key: 'movie', entityId: 'scene.movie_mode' }, { key: 'night', entityId: 'scene.good_night' }];
assert.deepEqual(visibleScenes(REAL, SCENES), [], 'HA has no scenes, so no dead scene buttons');
assert.deepEqual(visibleScenes([s('scene.movie_mode', 'unknown')], SCENES).map((x) => x.key), ['movie']);

// ─── Living-room remote ─────────────────────────────────────────────────────
assert.equal(remoteScriptsFor({ slug: 'living_room' }), TV_REMOTE_SCRIPTS);
assert.equal(remoteScriptsFor({ slug: 'master_bedroom' }), null, 'other rooms keep the generic IR commands');
assert.equal(TV_REMOTE_SCRIPTS.power, 'script.tv');

console.log('homeModel: all assertions passed');

// ─── Air conditioner presets ────────────────────────────────────────────────
import {
  acModes, acTemps, acFans, findAcPreset, acDefaultSelection, acSelectMode, acStepTemp,
} from './homeModel.js';

const preset = (mode, temp, fan) => ({ mode, temp, fan, script: `script.${mode}_${temp}_${fan}` });
// What HA really has for every room: cool 24 and heat 30, three fan speeds, off.
const REAL_AC = {
  off: 'script.aircon_power_off',
  on: [preset('cold', 24, 'low'), preset('cold', 24, 'mid'), preset('cold', 24, 'high'),
    preset('heat', 30, 'low'), preset('heat', 30, 'mid'), preset('heat', 30, 'high')],
};

assert.deepEqual(acModes(REAL_AC), ['cold', 'heat']);
assert.deepEqual(acTemps(REAL_AC, 'cold'), [24]);
assert.deepEqual(acTemps(REAL_AC, 'heat'), [30]);
assert.deepEqual(acTemps(REAL_AC, 'dry'), [], 'a mode HA has nothing for offers nothing');
assert.deepEqual(acFans(REAL_AC, 'cold', 24), ['low', 'mid', 'high'], 'slowest to fastest, not alphabetical');
assert.deepEqual(acFans(REAL_AC, 'cold', 25), []);
assert.deepEqual(acModes(null), []);
assert.deepEqual(acModes({ off: null, on: [] }), []);

assert.deepEqual(acDefaultSelection(REAL_AC), { mode: 'cold', temp: 24, fan: 'low' }, 'cooling first');
assert.equal(acDefaultSelection({ off: 'script.x', on: [] }), null, 'only an off script: nothing to select');
assert.equal(findAcPreset(REAL_AC, { mode: 'heat', temp: 30, fan: 'mid' }).script, 'script.heat_30_mid');
assert.equal(findAcPreset(REAL_AC, { mode: 'heat', temp: 24, fan: 'mid' }), null, 'a combination HA does not have');

// Switching mode lands on a real combination, never an invented one.
assert.deepEqual(acSelectMode(REAL_AC, { mode: 'cold', temp: 24, fan: 'high' }, 'heat'), { mode: 'heat', temp: 30, fan: 'high' },
  'closest available temperature, fan speed kept');
assert.deepEqual(acSelectMode(REAL_AC, { mode: 'cold', temp: 24, fan: 'low' }, 'dry'), { mode: 'cold', temp: 24, fan: 'low' },
  'unavailable mode: selection unchanged');

// With a wider catalogue (e.g. later generated codes) the stepper walks it.
const WIDE = { off: null, on: [22, 23, 24, 26].flatMap((t) => ['low', 'high'].map((f) => preset('cold', t, f))) };
assert.deepEqual(acStepTemp(WIDE, { mode: 'cold', temp: 24, fan: 'high' }, +1), { mode: 'cold', temp: 26, fan: 'high' }, 'skips the missing 25');
assert.deepEqual(acStepTemp(WIDE, { mode: 'cold', temp: 22, fan: 'low' }, -1), { mode: 'cold', temp: 22, fan: 'low' }, 'stops at the ends');
assert.deepEqual(acStepTemp(REAL_AC, { mode: 'cold', temp: 24, fan: 'mid' }, +1), { mode: 'cold', temp: 24, fan: 'mid' }, 'a single temperature has nowhere to step');

console.log('homeModel (air conditioner): all assertions passed');

// ─── Where the popup opens ──────────────────────────────────────────────────
// With a wide catalogue the lowest temperature would be 16 degrees of cooling:
// open on a preset the user already taught HA (one with a script) instead.
const MIXED = { off: null, on: [
  { mode: 'cold', temp: 16, fan: 'low', script: null },
  { mode: 'cold', temp: 18, fan: 'low', script: null },
  { mode: 'cold', temp: 24, fan: 'low', script: 'script.cold_24_low' },
  { mode: 'cold', temp: 24, fan: 'high', script: 'script.cold_24_high' },
] };
assert.deepEqual(acDefaultSelection(MIXED), { mode: 'cold', temp: 24, fan: 'low' }, 'a known-good preset, not 16 degrees');
assert.deepEqual(acDefaultSelection({ off: null, on: [{ mode: 'cold', temp: 20, fan: 'low', script: null }] }),
  { mode: 'cold', temp: 20, fan: 'low' }, 'with no scripts at all: the lowest');

console.log('homeModel (default selection): all assertions passed');
