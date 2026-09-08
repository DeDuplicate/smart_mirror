// Real per-device status for the audio output picker.
//
// The picker used to print a fixed "connected" string under every device that
// was not literally `unavailable`. On a live system that read as connected for
// six devices that were all `off` — the label was decorative, not information.
// This maps the actual Home Assistant media_player state instead.
//
// Kept free of React/i18n imports so it can be exercised by node; callers pass
// their own label lookup (see speakerStatus.test.mjs).

/** Device states, ordered from most to least alive. Used for dedupe too. */
export const LIVENESS = ['playing', 'paused', 'buffering', 'on', 'idle', 'standby', 'off'];

/**
 * @returns {{ key: string, tone: 'active'|'ready'|'asleep'|'gone', selectable: boolean }}
 *   `key`  - i18n key under music.state.*
 *   `tone` - drives the state dot colour
 */
export function speakerStatus(speaker) {
  const state = String(speaker?.state || '').toLowerCase();

  switch (state) {
    case 'playing':
    case 'buffering':
      return { key: 'playing', tone: 'active', selectable: true };
    case 'paused':
      return { key: 'paused', tone: 'active', selectable: true };
    case 'idle':
    case 'standby':
      return { key: 'ready', tone: 'ready', selectable: true };
    case 'on':
      return { key: 'on', tone: 'ready', selectable: true };
    // `off` is still a valid cast target: Chromecast/Android TV devices wake
    // on a play command. Say so rather than either hiding them or lying that
    // they are connected.
    case 'off':
      return { key: 'off', tone: 'asleep', selectable: true };
    case 'unavailable':
    case 'unknown':
    case '':
      return { key: 'unavailable', tone: 'gone', selectable: false };
    default:
      // Unrecognised state: surface it as-is rather than guessing.
      return { key: 'unknown', tone: 'asleep', selectable: true };
  }
}

/** What is actually playing, when the device reports it. */
export function nowPlayingLine(speaker) {
  const title = String(speaker?.mediaTitle || '').trim();
  const app = String(speaker?.appName || '').trim();
  if (title) return app ? `${title} · ${app}` : title;
  return app || '';
}

/**
 * Collapse duplicate entities by display name, keeping the liveliest.
 *
 * A real setup exposes the same physical device several times (one HA install
 * here reports G1 five times and Mi Box four, nearly all `unavailable`),
 * which buried the two or three usable outputs in a 27-row list.
 */
export function dedupeSpeakers(speakers) {
  const rank = (s) => {
    const i = LIVENESS.indexOf(String(s?.state || '').toLowerCase());
    return i === -1 ? LIVENESS.length : i;
  };
  const best = new Map();
  for (const s of speakers || []) {
    if (!s?.id) continue;
    const key = (s.name || s.id).trim().toLowerCase();
    const kept = best.get(key);
    if (!kept || rank(s) < rank(kept)) best.set(key, s);
  }
  return [...best.values()];
}

// ─── Device classification ──────────────────────────────────────────────────

const SPEAKER_RE = /nest[ _-]?(mini|audio)|google[ _-]?home|home[ _-]?mini|minispeaker|homepod|sonos|\bspeaker\b/
const TV_RE = /\btv\b|shield|mi[ _-]?box|android[ _-]?tv|\bstb\b|xiaomi|nest[ _-]?hub|chromecast|firestick|apple[ _-]?tv/

/**
 * Decide what a media_player actually is.
 *
 * Returns 'speaker' | 'tv' | 'other'. 'other' means genuinely unknown - it is
 * NOT a synonym for TV, which is what the picker used to imply by lumping
 * everything non-speaker under "TVs and streamers".
 *
 * A Nest speaker named after its room ("Master Bedroom") carries no keyword in
 * either its id or its name, so `device_class` is the only reliable signal.
 * When Home Assistant does not set one, we say "other" rather than guessing.
 */
// Audio-only Cast devices. Everything else Google makes in this space
// (Nest Hub, Hub Max, Chromecast) has a screen and can render the
// YouTube app, so it must NOT be lumped in here.
const AUDIO_MODEL_RE = /nest\s*mini|nest\s*audio|google\s*home(?!\s*hub)|home\s*mini|homepod|sonos|echo\s*(dot|studio)?/i,

// Cast devices with a display, plus ordinary TVs and streaming boxes.
  VIDEO_MODEL_RE = /nest\s*hub|hub\s*max|chromecast|shield|mibox|mi\s*box|android\s*tv|google\s*tv|fire\s*tv|apple\s*tv/i;

/**
 * Decide what a media_player actually is.
 *
 * Returns 'speaker' | 'tv' | 'other'. 'other' means genuinely unknown - it
 * is NOT a synonym for TV.
 *
 * `model` is the reliable signal and comes from HA's device registry (see
 * GET /api/ha/media-players). Name and id keywords are only a fallback: a
 * Nest device named after its room carries no hint at all, which is how a
 * Google Nest Hub previously ended up classified from the word "bedroom".
 */
export function classifyKind({ entityId = '', name = '', deviceClass = '', model = '' } = {}) {
  // 1. Model from the device registry - definitive.
  if (model) {
    if (AUDIO_MODEL_RE.test(model)) return 'speaker';
    if (VIDEO_MODEL_RE.test(model)) return 'tv';
  }
  // 2. Explicit device_class, if the integration set one.
  if (deviceClass === 'speaker') return 'speaker';
  if (deviceClass === 'tv') return 'tv';
  // 3. Last resort: keywords in the id or friendly name.
  const blob = `${entityId} ${name}`.toLowerCase();
  if (SPEAKER_RE.test(blob)) return 'speaker';
  if (TV_RE.test(blob)) return 'tv';
  return 'other';
}

/**
 * Should this target be fed a plain audio stream rather than the YouTube app?
 *
 * Only devices we positively identify as TVs can render the YouTube app, so
 * anything else - speakers and unknowns alike - takes the audio path. Cast
 * video devices play a bare MP3 URL happily, whereas a speaker cannot render
 * YouTube at all, which makes audio the safe default. Getting this wrong for
 * an unknown device is not fatal (the video path falls back to the stream
 * eventually) but it costs four doomed play_media calls first.
 */
export function prefersAudioStream(kind) {
  return kind !== 'tv';
}

/**
 * True for Google Cast receivers (Nest, Chromecast, Google TV).
 *
 * Matters for stopping playback: `media_stop` halts the audio but leaves the
 * Cast receiver app resident, so HA keeps reporting `playing`/`buffering` for
 * a silent device. `turn_off` quits the app and returns the entity to `off` -
 * harmless on a Cast device, but it would genuinely power down an ordinary
 * TV, so the escalation has to be gated on this.
 */
export function isCastDevice({ manufacturer = '', model = '' } = {}) {
  const blob = `${manufacturer} ${model}`.toLowerCase();
  if (/google|nest|chromecast/.test(blob)) return true;
  return false;
}
