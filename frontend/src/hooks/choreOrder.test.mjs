// Self-check for chore drag-reordering.  Run: node choreOrder.test.mjs
import assert from 'node:assert/strict';
import { insertionPoint, moveNextTo } from './choreOrder.js';

// ─── insertionPoint ─────────────────────────────────────────────────────────
// Three cards, 56px tall, 8px apart: midpoints at 28, 92, 156.
const cards = [
  { id: 'a', top: 0, height: 56 },
  { id: 'b', top: 64, height: 56 },
  { id: 'c', top: 128, height: 56 },
];
assert.deepEqual(insertionPoint(cards, -20), { targetId: 'a', after: false }, 'above everything');
assert.deepEqual(insertionPoint(cards, 27), { targetId: 'a', after: false }, 'just above the first midpoint');
assert.deepEqual(insertionPoint(cards, 29), { targetId: 'b', after: false }, 'just past it goes before the next');
assert.deepEqual(insertionPoint(cards, 100), { targetId: 'c', after: false });
assert.deepEqual(insertionPoint(cards, 157), { targetId: 'c', after: true }, 'past the last midpoint = after the last');
assert.deepEqual(insertionPoint(cards, 9999), { targetId: 'c', after: true });
assert.equal(insertionPoint([], 50), null, 'a lone chore has nowhere to go');

// ─── moveNextTo ─────────────────────────────────────────────────────────────
assert.deepEqual(moveNextTo(['a', 'b', 'c', 'd'], 'd', 'a', false), ['d', 'a', 'b', 'c'], 'to the top');
assert.deepEqual(moveNextTo(['a', 'b', 'c', 'd'], 'a', 'd', true), ['b', 'c', 'd', 'a'], 'to the bottom');
assert.deepEqual(moveNextTo(['a', 'b', 'c', 'd'], 'a', 'c', false), ['b', 'a', 'c', 'd'], 'down one, before c');
assert.deepEqual(moveNextTo(['a', 'b', 'c', 'd'], 'd', 'b', true), ['a', 'b', 'd', 'c'], 'up one, after b');

// The point of working on the FULL list: other-group chores keep their slots.
// open: a, c ; done: b, d  (saved order a b c d). Drag c above a.
assert.deepEqual(moveNextTo(['a', 'b', 'c', 'd'], 'c', 'a', false), ['c', 'a', 'b', 'd'],
  'done chores b and d keep their relative order and stay after the open ones');

// Dropping where it already is changes nothing (caller compares and skips the save).
assert.deepEqual(moveNextTo(['a', 'b', 'c'], 'b', 'c', false), ['a', 'b', 'c']);
assert.deepEqual(moveNextTo(['a', 'b', 'c'], 'b', 'a', true), ['a', 'b', 'c']);

// Garbage in, same list out - never a crash or a lost chore.
const ids = ['a', 'b'];
assert.equal(moveNextTo(ids, 'zzz', 'a', false), ids);
assert.equal(moveNextTo(ids, 'a', 'zzz', false), ids);
assert.equal(moveNextTo(ids, 'a', 'a', false), ids);

console.log('choreOrder: all assertions passed');
