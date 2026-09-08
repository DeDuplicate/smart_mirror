// Self-check for ringtone playback control — specifically that a tone can be
// STOPPED (Settings preview, and acknowledging an alarm mid-ring).
// Run: node reminderTones.test.mjs
import assert from 'node:assert/strict';

// ─── Minimal browser audio stubs ────────────────────────────────────────────

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.volume = 1;
    this.onended = null;
    FakeAudio.instances.push(this);
  }
  /**
   * Real browsers resolve this only once playback actually begins, and REJECT
   * it with AbortError if the element is paused while still pending. That
   * rejection is what made snooze restart the sound via the fallback path.
   */
  play() {
    this.paused = false;
    FakeAudio.playCount++;
    return new Promise((resolve, reject) => {
      this._settle = { resolve, reject };
    });
  }
  pause() {
    this.paused = true;
    FakeAudio.pauseCount++;
    if (this._settle) {
      const err = new Error('The play() request was interrupted by a call to pause().');
      err.name = 'AbortError';
      this._settle.reject(err);
      this._settle = null;
    }
  }
  /** Simulate a genuine load/codec failure. */
  failToPlay() {
    if (this._settle) {
      this._settle.reject(new Error('NotSupportedError'));
      this._settle = null;
    }
  }
  finish() {
    this.paused = true;
    this.ended = true;
    if (this.onended) this.onended();
  }
}
FakeAudio.instances = [];
FakeAudio.playCount = 0;
FakeAudio.pauseCount = 0;

class FakeOsc {
  constructor() {
    this.frequency = { value: 0 };
    this.onended = null;
    this.stopped = false;
    this.stopScheduledAt = null;
    FakeOsc.live.add(this);
  }
  connect(next) {
    return next;
  }
  start() {}
  /**
   * Matches Web Audio: `stop(when)` SCHEDULES a stop for later (which is what
   * note() does for every note), while a bare `stop()` halts immediately -
   * which is how stopReminderTone() cuts a pattern short. Getting this
   * distinction wrong makes a scheduled note look already-finished.
   */
  stop(when) {
    if (when !== undefined) {
      this.stopScheduledAt = when;
      return;
    }
    if (this.stopped) return; // re-stopping is legal
    this.stopped = true;
    FakeOsc.live.delete(this);
    if (this.onended) this.onended();
  }
}
FakeOsc.live = new Set();

const gainNode = () => ({
  gain: {
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  },
  connect(next) {
    return next;
  },
});

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  createOscillator() {
    return new FakeOsc();
  }
  createGain() {
    return gainNode();
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

globalThis.window = { AudioContext: FakeAudioContext, addEventListener() {}, removeEventListener() {} };
globalThis.Audio = FakeAudio;
globalThis.AudioContext = FakeAudioContext;

const { playReminderTone, stopReminderTone, isTonePlaying, normalizeTone, isFileTone } = await import(
  './reminderTones.js'
);

// ─── File tones: the case the user hit (a 16s clip with no way to stop) ─────

assert.equal(playReminderTone('file:Alarm Clock.mp3', 0.5), true, 'file tone starts');
assert.equal(isTonePlaying(), true, 'reports playing');
const audio = FakeAudio.instances.at(-1);
assert.equal(audio.paused, false, 'element is playing');

stopReminderTone();
assert.equal(audio.paused, true, 'stop() pauses the element');
assert.equal(audio.currentTime, 0, 'stop() rewinds it');
assert.equal(isTonePlaying(), false, 'no longer reports playing');

// Stopping when nothing plays must be harmless (dismiss after ring finished).
stopReminderTone();
assert.equal(isTonePlaying(), false, 'idle stop is a no-op');

// ─── Re-testing must replace, not layer ────────────────────────────────────

FakeAudio.pauseCount = 0;
playReminderTone('file:Chime.mp3');
const first = FakeAudio.instances.at(-1);
playReminderTone('file:Chime.mp3'); // press test again
assert.ok(FakeAudio.pauseCount >= 1, 'the previous tone was stopped before replaying');
assert.equal(isTonePlaying(), true, 'still playing after replay');
stopReminderTone();

// A cached element is reused per URL rather than leaking a new one each press.
playReminderTone('file:Chime.mp3');
assert.equal(FakeAudio.instances.at(-1), first, 'Audio element is cached per file');
stopReminderTone();

// ─── onEnded callback drives the play/stop button label ────────────────────

let ended = 0;
playReminderTone('file:Pager.mp3', 0.5, () => {
  ended++;
});
stopReminderTone();
assert.equal(ended, 1, 'stopping fires onEnded so the button resets to "play"');

ended = 0;
playReminderTone('file:Pager.mp3', 0.5, () => {
  ended++;
});
FakeAudio.instances.at(-1).finish(); // clip runs to its natural end
assert.equal(ended, 1, 'natural end also fires onEnded');
assert.equal(isTonePlaying(), false, 'not playing after it ends');

// ─── Synthesised tones are stoppable too ───────────────────────────────────

playReminderTone('alarm');
assert.ok(FakeOsc.live.size > 0, 'alarm pattern scheduled oscillators');
stopReminderTone();
assert.equal(FakeOsc.live.size, 0, 'stop() cut every oscillator');
assert.equal(isTonePlaying(), false, 'synth tone reports stopped');

// ─── Tone id handling ──────────────────────────────────────────────────────

assert.equal(normalizeTone('nonsense'), 'beep', 'unknown id falls back to beep');
assert.equal(normalizeTone('file:Whatever.mp3'), 'file:Whatever.mp3', 'file ids pass through');
assert.equal(isFileTone('file:x.mp3'), true);
assert.equal(isFileTone('bell'), false);

// ─── Stopping must NOT retrigger the fallback beep ─────────────────────────
// Regression: pause() rejects the pending play() with AbortError, and the
// fallback treated that as "file broken" and played a synth beep — so snooze
// silenced the mp3 then immediately started beeping.

stopReminderTone();
FakeOsc.live.clear();
playReminderTone('file:Alarm Clock.mp3');
stopReminderTone(); // user presses snooze
await Promise.resolve(); // let the rejected play() promise settle
await Promise.resolve();
assert.equal(FakeOsc.live.size, 0, 'snoozing must not start a fallback beep');
assert.equal(isTonePlaying(), false, 'stays silent after snooze');

// A genuine failure SHOULD still fall back, so a broken file is not silent.
stopReminderTone();
FakeOsc.live.clear();
playReminderTone('file:Broken.mp3');
FakeAudio.instances.at(-1).failToPlay();
await Promise.resolve();
await Promise.resolve();
assert.ok(FakeOsc.live.size > 0, 'a real load failure still falls back to a beep');
stopReminderTone();

console.log('reminderTones: all assertions passed');
