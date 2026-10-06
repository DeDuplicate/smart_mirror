// Run with plain node: node frontend/src/hooks/slideTransition.test.mjs
import assert from 'node:assert/strict';
import { TRANSITIONS, RANDOM_POOL, DEFAULT_TRANSITION, pickTransition } from './slideTransition.js';

// A chosen transition is used as is.
for (const kind of TRANSITIONS) assert.equal(pickTransition(kind), kind, kind);

// Anything unknown falls back to the default rather than to "no transition".
for (const bad of [undefined, null, '', 'wipe', 'FADE', 42]) {
  assert.equal(pickTransition(bad), DEFAULT_TRANSITION, String(bad));
}

// Random only ever draws from the pool, and every pool entry is reachable.
const seen = new Set();
for (let i = 0; i < RANDOM_POOL.length; i += 1) {
  const kind = pickTransition('random', () => i / RANDOM_POOL.length);
  assert.ok(RANDOM_POOL.includes(kind), kind);
  seen.add(kind);
}
assert.equal(seen.size, RANDOM_POOL.length, 'every pool entry can be drawn');
assert.ok(RANDOM_POOL.includes(pickTransition('random', () => 0.999999)), 'top of the range stays in bounds');
assert.ok(RANDOM_POOL.every((k) => TRANSITIONS.includes(k)), 'the pool holds real transitions');
assert.ok(DEFAULT_TRANSITION && TRANSITIONS.includes(DEFAULT_TRANSITION));

console.log('slideTransition: all assertions passed');
