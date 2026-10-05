'use strict';

// Run with: node --test backend/test-ac.js
// Rows are the real AC scripts of the mirror's Home Assistant (2026-10-05).
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseAcCommand, buildAcCatalog } = require('./routes/homeassistant')._test;

test('parseAcCommand reads the command names the scripts really use', () => {
  assert.deepEqual(parseAcCommand('Power On Cold 24 Low'), { kind: 'on', mode: 'cold', temp: 24, fan: 'low' });
  assert.deepEqual(parseAcCommand('Power On Heat 30 High'), { kind: 'on', mode: 'heat', temp: 30, fan: 'high' });
  assert.deepEqual(parseAcCommand('  power on cold 24 mid '), { kind: 'on', mode: 'cold', temp: 24, fan: 'mid' }, 'case and stray spaces');
  assert.deepEqual(parseAcCommand('AirCon Power OFF'), { kind: 'off' });
  // Not AC commands: the TV scripts live alongside and must never be mistaken for presets.
  for (const other of ['Power', 'Volume Up', 'table backlight on', 'mute', '', null, undefined]) {
    assert.equal(parseAcCommand(other), null, String(other));
  }
});

test('buildAcCatalog groups presets per blaster and drops duplicates', () => {
  const LIVING = 'remote.wifi_ir_living_room';
  const KIDS = 'remote.wifi_ir_childrens_room';
  const rows = [
    { script: 'script.aircon_power_off', blaster: LIVING, command: 'AirCon Power OFF' },
    { script: 'script.aircon_24_low_on', blaster: LIVING, command: 'Power On Cold 24 Low' },
    { script: 'script.aircon_on_24_mid', blaster: LIVING, command: 'Power On Cold 24 Mid' },
    { script: 'script.aircon_cold_24_high', blaster: LIVING, command: 'Power On Cold 24 High' },
    { script: 'script.aircon_heat_30_high', blaster: LIVING, command: 'Power On Heat 30 High' },
    { script: 'script.aircon_heat_30_low', blaster: LIVING, command: 'Power On Heat 30 Low' },
    // the kids' room really has two scripts that send the same preset
    { script: 'script.power_on_cold_24_high_3', blaster: KIDS, command: 'Power On Cold 24 High' },
    { script: 'script.power_on_cold_24_high_2', blaster: KIDS, command: 'Power On Cold 24 High' },
    { script: 'script.aircon_power_off_3', blaster: KIDS, command: 'AirCon Power OFF' },
    { script: 'script.tv', blaster: LIVING, command: 'Power' },            // a TV script: ignored
    { script: 'script.orphan', blaster: null, command: 'Power On Cold 24 Low' }, // no blaster found: ignored
  ];
  const c = buildAcCatalog(rows);

  assert.deepEqual(Object.keys(c).sort(), [KIDS, LIVING].sort());
  assert.equal(c[LIVING].off, 'script.aircon_power_off');
  assert.deepEqual(c[LIVING].on.map((p) => `${p.mode} ${p.temp} ${p.fan}`), [
    'cold 24 low', 'cold 24 mid', 'cold 24 high', 'heat 30 low', 'heat 30 high',
  ], 'ordered by mode, temperature, then fan speed low -> high (not alphabetically)');
  assert.equal(c[LIVING].on[0].script, 'script.aircon_24_low_on');

  assert.equal(c[KIDS].on.length, 1, 'the duplicate is one preset');
  assert.equal(c[KIDS].on[0].script, 'script.power_on_cold_24_high_2', 'the alphabetically first script wins, every run');
  assert.deepEqual(buildAcCatalog([]), {});
});
