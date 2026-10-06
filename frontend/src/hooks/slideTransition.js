// Pure helpers for the photo-frame transitions (no React, so
// slideTransition.test.mjs runs under plain node).
//
// Every transition moves only opacity and transform: the mirror renders in
// software (GPU is off on the Pi 2), so anything that repaints per frame - blur,
// clip-path, filters - would stutter. The animations themselves live in
// global.css (.ss-<kind>-in / .ss-<kind>-out); keep TRANSITION_MS in step.

export const TRANSITIONS = ['fade', 'slide', 'zoom', 'quick'];

// What 'random' draws from. 'quick' is a 0.2 s dissolve, a safe choice rather
// than a look worth surprising anyone with.
export const RANDOM_POOL = ['fade', 'slide', 'zoom'];

// How long the outgoing layer stays mounted: the longest animation plus slack.
// A layer removed while still on screen is a pop.
export const TRANSITION_MS = 900;

export const DEFAULT_TRANSITION = 'fade';

/**
 * The transition for the next photo change. `setting` is the saved choice:
 * one of TRANSITIONS, or 'random'. Anything else (an older install, a typo in
 * the database) falls back to the default instead of showing nothing.
 */
export function pickTransition(setting, rand = Math.random) {
  if (setting === 'random') return RANDOM_POOL[Math.floor(rand() * RANDOM_POOL.length)];
  return TRANSITIONS.includes(setting) ? setting : DEFAULT_TRANSITION;
}
