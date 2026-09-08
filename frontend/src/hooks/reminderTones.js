// Reminder ringtones.
//
// Two kinds:
//   - built-in patterns synthesised with Web Audio (no asset to ship to the
//     Pi, no decode latency when an alarm fires, tunable right here);
//   - user-supplied files dropped into backend/data/sounds/reminders/, played
//     via <audio> and addressed as `file:<name>`.
//
// Licensed audio (e.g. an Epidemic Sound download) belongs in the second
// group: it stays on the device and out of git.

let audioCtx = null;

/** Lazily create the shared AudioContext. Returns null if unavailable. */
export function getAudioCtx() {
  if (audioCtx) return audioCtx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    return null;
  }
  return audioCtx;
}

/**
 * Browsers start an AudioContext 'suspended' until a user gesture. The Pi
 * kiosk passes --autoplay-policy=no-user-gesture-required (see
 * scripts/start-kiosk.sh) so it starts running there; in a normal desktop
 * browser this unlocks it on the first tap or keypress.
 */
export function unlockAudioOnGesture() {
  const unlock = () => {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  const opts = { once: true, passive: true };
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}

/**
 * Schedule one note.
 * `decay: true` gives a struck-bell envelope; otherwise it's a flat pulse
 * with short ramps (a bare start/stop on a gain node clicks audibly).
 */
function note(ctx, { freq, at, dur, volume, type = 'sine', decay = false }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.012);
  if (decay) {
    gain.gain.exponentialRampToValueAtTime(Math.max(volume * 0.001, 1e-4), at + dur);
  } else {
    gain.gain.setValueAtTime(volume, at + Math.max(dur - 0.03, 0.02));
    gain.gain.linearRampToValueAtTime(0, at + dur);
  }
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
  // Registered so stopReminderTone() can cut a pattern mid-flight.
  activeOscillators.push(osc);
  osc.onended = () => {
    activeOscillators = activeOscillators.filter((o) => o !== osc);
  };
}

// ─── Patterns ───────────────────────────────────────────────────────────────
// Each builder schedules its notes from `t0` and returns nothing.

const PATTERNS = {
  // Three even mid-high pips — the default, cuts through room noise.
  beep(ctx, t0, v) {
    for (let i = 0; i < 3; i++) {
      note(ctx, { freq: 880, at: t0 + i * 0.32, dur: 0.18, volume: v });
    }
  },

  // Urgent clock-radio buzz: fast alternating pulses.
  alarm(ctx, t0, v) {
    for (let i = 0; i < 8; i++) {
      note(ctx, {
        freq: i % 2 ? 1100 : 880,
        at: t0 + i * 0.16,
        dur: 0.12,
        volume: v,
        type: 'square',
      });
    }
  },

  // Gentle descending arpeggio.
  chime(ctx, t0, v) {
    [1318.5, 1046.5, 784].forEach((freq, i) => {
      note(ctx, {
        freq,
        at: t0 + i * 0.22,
        dur: 0.6,
        volume: v * 0.85,
        type: 'triangle',
        decay: true,
      });
    });
  },

  // Single struck bell with a harmonic, long tail.
  bell(ctx, t0, v) {
    note(ctx, { freq: 1568, at: t0, dur: 1.4, volume: v, type: 'triangle', decay: true });
    note(ctx, { freq: 3136, at: t0, dur: 0.9, volume: v * 0.3, type: 'sine', decay: true });
  },
};

export const REMINDER_TONES = ['beep', 'alarm', 'chime', 'bell'];
// Roughly how long each pattern sounds (seconds) - used only to report
// completion back to the UI; the oscillators stop themselves.
const PATTERN_SECONDS = { beep: 0.85, alarm: 1.4, chime: 1.05, bell: 1.45 };
export const DEFAULT_TONE = 'beep';

// User-supplied files are addressed as `file:<name>` and served by the backend
// from backend/data/sounds/reminders/. Kept separate from the synthesised
// patterns so a missing/deleted file degrades to the default beep instead of
// silently doing nothing.
export const FILE_TONE_PREFIX = 'file:';

export function isFileTone(id) {
  return typeof id === 'string' && id.startsWith(FILE_TONE_PREFIX);
}

export function fileToneUrl(id) {
  return `/api/sounds/reminders/${encodeURIComponent(id.slice(FILE_TONE_PREFIX.length))}`;
}

const fileToneCache = new Map();

// What is sounding right now, so it can be cut short. Without this, pressing
// the Settings test button gives you no way to stop a 16s clip, and -- worse
// -- acknowledging an alarm mid-ring leaves the audio playing.
let currentAudio = null;
let activeOscillators = [];
let endTimer = null;
let endedCb = null;

function fireEnded() {
  const cb = endedCb;
  endedCb = null;
  if (endTimer) {
    clearTimeout(endTimer);
    endTimer = null;
  }
  if (cb) cb();
}

/** True while a tone is still sounding. */
export function isTonePlaying() {
  if (currentAudio && !currentAudio.paused && !currentAudio.ended) return true;
  return activeOscillators.length > 0;
}

/** Silence whatever is playing. Safe to call when nothing is. */
export function stopReminderTone() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      // element not seekable yet - pausing was the important part
    }
    currentAudio = null;
  }
  for (const osc of activeOscillators) {
    try {
      osc.stop();
    } catch {
      // already stopped
    }
  }
  activeOscillators = [];
  fireEnded();
}

/** Play a user-supplied audio file. Falls back to the default beep on error. */
function playFileTone(id, volume) {
  const url = fileToneUrl(id);
  let audio = fileToneCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    fileToneCache.set(url, audio);
  }
  audio.volume = Math.min(1, Math.max(0, volume));
  try {
    audio.currentTime = 0;
  } catch {
    // not yet seekable - fine, it plays from the start anyway
  }
  currentAudio = audio;
  audio.onended = () => {
    if (currentAudio === audio) currentAudio = null;
    fireEnded();
  };
  audio.play().catch((err) => {
    // Pausing an element whose play() is still pending rejects it with
    // AbortError. That is a DELIBERATE stop (snooze / approve / retest), not a
    // failure - falling back here would restart the sound we just silenced.
    // `currentAudio` has already been cleared or replaced in that case.
    if (currentAudio !== audio || err?.name === 'AbortError') return;
    // Genuine failure (file missing, bad codec, autoplay blocked): keep the
    // reminder audible rather than failing silently.
    currentAudio = null;
    playSynthTone(DEFAULT_TONE, volume);
  });
  return true;
}

/** Normalise a stored tone id to one we can actually play. */
export function normalizeTone(id) {
  if (isFileTone(id)) return id;
  return REMINDER_TONES.includes(id) ? id : DEFAULT_TONE;
}

/** Play one of the built-in synthesised patterns. */
function playSynthTone(toneId, volume) {
  const ctx = getAudioCtx();
  if (!ctx) return false;
  // Kick a suspended context; if the policy still blocks it the notes below
  // are simply inaudible rather than an error.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  try {
    PATTERNS[REMINDER_TONES.includes(toneId) ? toneId : DEFAULT_TONE](
      ctx,
      ctx.currentTime + 0.02,
      volume
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Play a ringtone: either a user-supplied file (`file:<name>`) or a built-in
 * synthesised pattern. Returns false when audio is unavailable or blocked, so
 * callers can surface "no audio" instead of failing silently.
 *
 * Always stops whatever was sounding first, so re-testing or switching tones
 * replaces the sound instead of layering another copy on top of it.
 *
 * `onEnded` fires when the tone finishes on its own OR is stopped.
 */
export function playReminderTone(toneId = DEFAULT_TONE, volume = 0.5, onEnded = null) {
  stopReminderTone();
  endedCb = onEnded;

  if (isFileTone(toneId)) return playFileTone(toneId, volume);

  const ok = playSynthTone(toneId, volume);
  if (!ok) {
    fireEnded();
    return false;
  }
  // Oscillators have no single 'ended' we can hang the UI off, so time it out.
  const secs = PATTERN_SECONDS[normalizeTone(toneId)] ?? 1;
  endTimer = setTimeout(fireEnded, secs * 1000 + 150);
  return true;
}
