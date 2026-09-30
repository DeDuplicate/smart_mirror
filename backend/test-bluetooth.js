'use strict';

// Run with: node --test backend/test-bluetooth.js
// Fixtures are trimmed from real `bluetoothctl` output captured on the mirror
// (addresses replaced) - including the "speaker with no Class/Icon" case.
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseDevices, parseInfo, sinkMac, macKey, sortDevices, stripAnsi } = require('./routes/bluetooth')._test;

test('parseDevices drops anonymous advertisers but keeps named devices', () => {
  const out = parseDevices([
    'Device 5F:5A:74:7D:0A:20 5F-5A-74-7D-0A-20',
    'Device AA:BB:CC:00:00:02 Razer Stereo',
    'Device aa:bb:cc:00:00:03 [TV] Samsung 7 Series (55)',
    'not a device line',
  ].join('\n'));
  assert.deepEqual(out, [
    { mac: 'AA:BB:CC:00:00:02', name: 'Razer Stereo' },
    { mac: 'AA:BB:CC:00:00:03', name: '[TV] Samsung 7 Series (55)' },
  ]);
});

test('parseInfo reads state and flags audio sinks without requiring them', () => {
  const tv = parseInfo([
    'Device AA:BB:CC:00:00:05 (public)', '\tName: Android TV', '\tClass: 0x003e0424',
    '\tIcon: audio-card', '\tPaired: no', '\tConnected: no',
    '\tUUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)',
  ].join('\n'));
  assert.deepEqual(tv, { paired: false, connected: false, audio: true });

  // A real speaker before first connect: no Class, no Icon, no UUIDs.
  const bare = parseInfo('Device AA:BB:CC:00:00:02 (public)\n\tPaired: yes\n\tConnected: yes');
  assert.deepEqual(bare, { paired: true, connected: true, audio: false });
});

test('sink names map back to MACs (PulseAudio and PipeWire), HDMI/combined do not', () => {
  assert.equal(sinkMac('bluez_sink.D8_37_3B_60_55_50.a2dp_sink'), 'D8:37:3B:60:55:50');
  assert.equal(sinkMac('bluez_output.d8_37_3b_60_55_50.1'), 'D8:37:3B:60:55:50');
  assert.equal(sinkMac('alsa_output.platform-3f902000.hdmi.hdmi-stereo'), null);
  assert.equal(sinkMac('mirror_out'), null);
  assert.equal(macKey('d8:37:3b:60:55:50'), 'D8_37_3B_60_55_50');
});

test('sortDevices: connected, then saved, then speaker-looking, then name', () => {
  const d = (name, paired, connected, audio) => ({ name, paired, connected, audio });
  const names = sortDevices([
    d('Zed', false, false, false), d('Amp', false, false, true),
    d('Saved', true, false, false), d('Live', true, true, false),
  ]).map((x) => x.name);
  assert.deepEqual(names, ['Live', 'Saved', 'Amp', 'Zed']);
});

test('stripAnsi removes bluetoothctl colour codes and readline markers', () => {
  assert.equal(stripAnsi('[\x1b[0;92mNEW\x1b[0m] Device X'), '[NEW] Device X');
  assert.equal(stripAnsi('\x01\x1b[0;94m\x02[bluetooth]\x01\x1b[0m\x02# ok'), '[bluetooth]# ok');
});
