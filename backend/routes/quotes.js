'use strict';

const { Router } = require('express');
const { PHRASES } = require('../data/phrases');

const router = Router();
const SLOT_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_SLOT_MS = 60 * 1000;
const MAX_SLOT_MS = DAY_MS;

/** Deterministic 32-bit PRNG — same seed always yields the same sequence. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Order of phrases for a given day.
 *
 * Indexing the list directly by slot made the sequence fixed: with a 10-minute
 * slot the pool cycled every N*10 minutes and landed on the same phrase at the
 * same clock time every week. Reshuffling with the day as the seed keeps a
 * given day's order stable (so the server stays stateless and every client
 * agrees) while making each day's order different.
 */
function orderForDay(dayIndex) {
  const order = PHRASES.map((_, i) => i);
  const rand = mulberry32(dayIndex * 2654435761);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function currentPhrase(now = Date.now(), slotMs = SLOT_MS) {
  // Clamp so a bad client value can't produce a zero/negative slot.
  const step = Math.min(MAX_SLOT_MS, Math.max(MIN_SLOT_MS, Number(slotMs) || SLOT_MS));

  const slot = Math.floor(now / step);
  const dayIndex = Math.floor(now / DAY_MS);
  const slotOfDay = Math.floor((now % DAY_MS) / step);

  const item = PHRASES[orderForDay(dayIndex)[slotOfDay % PHRASES.length]];
  return {
    text: item.text,
    source: item.source || '',
    explanation: item.explanation || '',
    slot,
    nextChangeAt: (slot + 1) * step,
    intervalMs: step,
  };
}

router.get('/', (req, res) => {
  const minutes = Number(req.query.intervalMin);
  const slotMs = Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : SLOT_MS;
  res.json(currentPhrase(Date.now(), slotMs));
});

module.exports = router;
module.exports.currentPhrase = currentPhrase;
