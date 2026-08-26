'use strict';

const { Router } = require('express');
const { PHRASES } = require('../data/phrases');

const router = Router();
const SLOT_MS = 10 * 60 * 1000;

function currentPhrase(now = Date.now()) {
  const slot = Math.floor(now / SLOT_MS);
  const item = PHRASES[slot % PHRASES.length];
  return {
    text: item.text,
    source: item.source || '',
    slot,
    nextChangeAt: (slot + 1) * SLOT_MS,
    intervalMs: SLOT_MS,
  };
}

router.get('/', (_req, res) => {
  res.json(currentPhrase());
});

module.exports = router;
module.exports.currentPhrase = currentPhrase;
