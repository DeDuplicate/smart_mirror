// Self-check for output-picker status mapping.  Run: node speakerStatus.test.mjs
import assert from 'node:assert/strict';
import {
  speakerStatus,
  nowPlayingLine,
  dedupeSpeakers,
  classifyKind,
  prefersAudioStream,
} from './speakerStatus.js';

// ─── The actual regression ─────────────────────────────────────────────────
// Every one of these was labelled "connected" by the old fixed string.

for (const state of ['off', 'unavailable', 'unknown']) {
  const st = speakerStatus({ state });
  assert.notEqual(st.key, 'on', `${state} must not read as connected`);
  assert.notEqual(st.key, 'playing', `${state} must not read as playing`);
}

assert.equal(speakerStatus({ state: 'off' }).key, 'off');
assert.equal(speakerStatus({ state: 'off' }).tone, 'asleep');
assert.equal(speakerStatus({ state: 'off' }).selectable, true, 'an off device still wakes on cast');

assert.equal(speakerStatus({ state: 'unavailable' }).key, 'unavailable');
assert.equal(speakerStatus({ state: 'unavailable' }).tone, 'gone');
assert.equal(speakerStatus({ state: 'unavailable' }).selectable, false, 'cannot cast to a gone device');

// ─── Live states ───────────────────────────────────────────────────────────

assert.equal(speakerStatus({ state: 'playing' }).key, 'playing');
assert.equal(speakerStatus({ state: 'playing' }).tone, 'active');
assert.equal(speakerStatus({ state: 'buffering' }).key, 'playing', 'buffering reads as playing');
assert.equal(speakerStatus({ state: 'paused' }).key, 'paused');
assert.equal(speakerStatus({ state: 'idle' }).key, 'ready');
assert.equal(speakerStatus({ state: 'standby' }).key, 'ready');
assert.equal(speakerStatus({ state: 'on' }).key, 'on');

// Case and whitespace from the API must not matter.
assert.equal(speakerStatus({ state: 'PLAYING' }).key, 'playing');

// Missing/garbage input must not throw or claim a live device.
assert.equal(speakerStatus({}).key, 'unavailable');
assert.equal(speakerStatus(null).key, 'unavailable');
assert.equal(speakerStatus({ state: 'weird_new_state' }).key, 'unknown');
assert.equal(speakerStatus({ state: 'weird_new_state' }).selectable, true);

// ─── Now-playing line ──────────────────────────────────────────────────────

assert.equal(nowPlayingLine({ mediaTitle: 'מלכת הדור', appName: 'YouTube' }), 'מלכת הדור · YouTube');
assert.equal(nowPlayingLine({ mediaTitle: 'מלכת הדור' }), 'מלכת הדור');
assert.equal(nowPlayingLine({ appName: 'Spotify' }), 'Spotify');
assert.equal(nowPlayingLine({}), '', 'nothing to say when the device reports nothing');
assert.equal(nowPlayingLine(null), '');

// ─── Dedupe ────────────────────────────────────────────────────────────────
// Mirrors the real HA payload: the same name repeated, mostly unavailable.

const real = [
  { id: 'media_player.g1_a', name: 'G1', state: 'unavailable' },
  { id: 'media_player.g1_b', name: 'G1', state: 'unavailable' },
  { id: 'media_player.g1_c', name: 'G1', state: 'off' },
  { id: 'media_player.g1_d', name: 'G1', state: 'unavailable' },
  { id: 'media_player.shield_a', name: 'SHIELD', state: 'off' },
  { id: 'media_player.shield_b', name: 'SHIELD', state: 'unavailable' },
  { id: 'media_player.living', name: 'Living Room', state: 'off' },
];
const deduped = dedupeSpeakers(real);
assert.equal(deduped.length, 3, '4x G1 + 2x SHIELD + 1 collapse to 3 rows');
assert.equal(deduped.find((s) => s.name === 'G1').id, 'media_player.g1_c', 'kept the off one, not unavailable');
assert.equal(deduped.find((s) => s.name === 'SHIELD').id, 'media_player.shield_a', 'kept the off SHIELD');

// A playing duplicate always wins over off/unavailable.
const withPlaying = dedupeSpeakers([
  { id: 'a', name: 'TV', state: 'off' },
  { id: 'b', name: 'TV', state: 'playing' },
  { id: 'c', name: 'TV', state: 'unavailable' },
]);
assert.equal(withPlaying.length, 1);
assert.equal(withPlaying[0].id, 'b', 'the playing entity is the useful one');

// Name matching ignores case and padding, and entries without an id are dropped.
assert.equal(dedupeSpeakers([{ id: 'x', name: 'tv ' }, { id: 'y', name: 'TV' }]).length, 1);
assert.equal(dedupeSpeakers([{ name: 'no id' }]).length, 0);
assert.equal(dedupeSpeakers(null).length, 0);
assert.equal(dedupeSpeakers([]).length, 0);


// ─── Device classification ─────────────────────────────────────────────────
// Entity shapes below are copied from a live Home Assistant install.

// device_class wins outright.
assert.equal(
  classifyKind({ entityId: 'media_player.nestmini7418', name: 'Living Room', deviceClass: 'speaker' }),
  'speaker',
);
assert.equal(classifyKind({ entityId: 'media_player.shield', name: 'SHIELD', deviceClass: 'tv' }), 'tv');

// The regression: a Nest speaker named after its room has NO keyword in its id
// or name, and HA sets no device_class. It must not be claimed as a TV.
const bedroom = { entityId: 'media_player.master_bedroom', name: 'Master Bedroom' };
assert.equal(classifyKind(bedroom), 'other', 'unknown device is "other", never "tv"');
assert.equal(prefersAudioStream(classifyKind(bedroom)), true,
  'an unknown device takes the audio path - a speaker cannot render YouTube');

// Keyword fallbacks still work when device_class is absent.
assert.equal(classifyKind({ entityId: 'media_player.nestmini7418', name: 'Kitchen' }), 'speaker');
assert.equal(classifyKind({ entityId: 'media_player.x', name: 'Nest Audio' }), 'speaker');
assert.equal(classifyKind({ entityId: 'media_player.x', name: 'UHD Google TV STB' }), 'tv');
assert.equal(classifyKind({ entityId: 'media_player.x', name: 'SHIELD' }), 'tv');

// "tv" must match as a word, not inside another word - otherwise a speaker
// called e.g. "Betvia" would be routed down the video path.
assert.equal(classifyKind({ entityId: 'media_player.x', name: 'Betvia' }), 'other');

// Only positively-identified TVs get the YouTube-app path.
assert.equal(prefersAudioStream('tv'), false);
assert.equal(prefersAudioStream('speaker'), true);
assert.equal(prefersAudioStream('other'), true);

// Missing input must not throw.
assert.equal(classifyKind(), 'other');
assert.equal(classifyKind({}), 'other');



// ─── Model-based classification (HA device registry) ───────────────────────
// Models below are verbatim from a live install's device registry.

// The device that started all this: HA reports no device_class and the name is
// just a room, but the registry says exactly what it is.
assert.equal(
  classifyKind({ entityId: 'media_player.master_bedroom', name: 'Master Bedroom', model: 'Google Nest Hub' }),
  'tv',
  'a Nest Hub has a screen and can render the YouTube app',
);
assert.equal(
  prefersAudioStream(classifyKind({ entityId: 'media_player.master_bedroom', name: 'Master Bedroom', model: 'Google Nest Hub' })),
  false,
  'a Hub should get the video path, not the audio-only stream',
);

assert.equal(
  classifyKind({ entityId: 'media_player.nestmini7418', name: 'Living Room', model: 'Google Nest Mini' }),
  'speaker',
);
assert.equal(
  classifyKind({ entityId: 'media_player.googlehome4669', name: 'Kitchen', model: 'Google Nest Mini' }),
  'speaker',
  'a second Nest Mini named after a different room still classifies',
);

// "Google Home" is a speaker, but "Google Home Hub" is not - the negative
// lookahead has to hold or every Hub would be treated as audio-only.
assert.equal(classifyKind({ model: 'Google Home' }), 'speaker');
assert.equal(classifyKind({ model: 'Google Home Mini' }), 'speaker');
assert.equal(classifyKind({ model: 'Google Nest Hub Max' }), 'tv');

// Real TV/streamer models from the same install.
for (const model of ['SHIELD Android TV', 'MIBOX4', 'MIBOX3', 'Chromecast']) {
  assert.equal(classifyKind({ model }), 'tv', `${model} is video-capable`);
}

// Model wins over a name that would mislead.
assert.equal(
  classifyKind({ name: 'Bedroom TV', model: 'Google Nest Mini' }),
  'speaker',
  'the registry model beats a misleading friendly name',
);

// Models the registry does not recognise fall through to the old signals.
assert.equal(classifyKind({ model: 'G1', deviceClass: 'tv' }), 'tv');
assert.equal(classifyKind({ model: 'KP1', name: 'Salon' }), 'other', 'unknown model stays honest');


console.log('speakerStatus: all assertions passed');
