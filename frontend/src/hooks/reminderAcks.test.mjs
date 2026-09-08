// Self-check for approve/snooze persistence.
// Run: node reminderAcks.test.mjs
import assert from 'node:assert/strict';

// ─── localStorage stub ──────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  handledKeys,
  markAcked,
  snoozeReminder,
  takeDueSnoozes,
  clearReminderState,
} = await import('./reminderAcks.js');
const { reminderKey, dueReminders } = await import('./reminderSchedule.js');

const NOW = new Date('2026-09-08T17:16:00Z').getTime();
const EVENT = { id: 'uid_0', title: 'חוג הישרדות', start: '2026-09-08T17:30:00.000Z' };
const KEY = reminderKey(EVENT);

// ─── Approving survives a reload ───────────────────────────────────────────

clearReminderState();
assert.equal(handledKeys(NOW).size, 0, 'starts clean');

markAcked(KEY, EVENT.start);
assert.ok(handledKeys(NOW).has(KEY), 'approval is remembered');

// This is the actual reload scenario: fired set rebuilt from storage, event
// still 14 min out and inside a 15 min lead — it must NOT alarm again.
const afterReload = handledKeys(NOW);
assert.equal(
  dueReminders([EVENT], 15, NOW, afterReload).length,
  0,
  'approved event does not re-alarm after a reload inside the lead window',
);
// Sanity: without the persisted ack it WOULD have fired, so the guard is what
// prevents it rather than the lead maths.
assert.equal(
  dueReminders([EVENT], 15, NOW, new Set()).length,
  1,
  'control: unacknowledged event does fire',
);

// ─── The recurring-series trap (verified against the live ICS feed) ────────
// A weekly class returns the SAME event id every week; only `start` differs.
// Approving one occurrence must not silence next week's.

const NEXT_WEEK = { ...EVENT, start: '2026-09-15T17:30:00.000Z' };
assert.equal(EVENT.id, NEXT_WEEK.id, 'same series shares an id (as the feed does)');
assert.notEqual(reminderKey(EVENT), reminderKey(NEXT_WEEK), 'but the keys differ');
const nextWeekNow = new Date('2026-09-15T17:16:00Z').getTime();
assert.equal(
  dueReminders([NEXT_WEEK], 15, nextWeekNow, handledKeys(nextWeekNow)).length,
  1,
  "next week's occurrence still alarms after this week's was approved",
);

// ─── Snooze behaves like an alarm clock ────────────────────────────────────

clearReminderState();
const reminder = { id: KEY, title: EVENT.title, start: EVENT.start, location: '' };
snoozeReminder(KEY, reminder, 5, NOW);

// Quiet immediately after snoozing...
assert.equal(takeDueSnoozes(NOW).length, 0, 'nothing due the instant you snooze');
assert.ok(handledKeys(NOW).has(KEY), 'snoozed key is treated as handled');
assert.equal(
  dueReminders([EVENT], 15, NOW, handledKeys(NOW)).length,
  0,
  'the lead-window path must not double-fire a snoozed event',
);

// ...and rings again 5 minutes later.
const plus5 = NOW + 5 * 60000;
const due = takeDueSnoozes(plus5);
assert.equal(due.length, 1, 'rings again after the snooze elapses');
assert.equal(due[0].title, EVENT.title, 'same event comes back');
assert.equal(takeDueSnoozes(plus5).length, 0, 'a due snooze is consumed once');

// Snoozing past the event start still rings — the whole point of a snooze.
clearReminderState();
const late = new Date('2026-09-08T17:28:00Z').getTime();
snoozeReminder(KEY, reminder, 5, late);
const afterStart = late + 5 * 60000; // 17:33, event began at 17:30
assert.equal(
  takeDueSnoozes(afterStart).length,
  1,
  'snooze fires even after the event has started',
);

// Repeated snoozing, like hitting snooze twice on a clock.
clearReminderState();
snoozeReminder(KEY, reminder, 5, NOW);
snoozeReminder(KEY, reminder, 5, NOW + 5 * 60000);
assert.equal(takeDueSnoozes(NOW + 5 * 60000).length, 0, 're-snooze pushes it back');
assert.equal(takeDueSnoozes(NOW + 10 * 60000).length, 1, 'and it returns after that');

// Approving cancels a pending snooze.
clearReminderState();
snoozeReminder(KEY, reminder, 5, NOW);
markAcked(KEY, EVENT.start);
assert.equal(takeDueSnoozes(NOW + 10 * 60000).length, 0, 'approve wins over a snooze');

// ─── Housekeeping ──────────────────────────────────────────────────────────

// Yesterday's entries are pruned rather than accumulating forever.
clearReminderState();
markAcked('old@2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
markAcked(KEY, EVENT.start);
const keys = handledKeys(NOW);
assert.ok(keys.has(KEY), "today's ack kept");
assert.equal(keys.size, 1, 'stale ack pruned');

// Corrupt storage must not throw.
store.set('smartMirror.reminders.v1', '{not json');
assert.equal(handledKeys(NOW).size, 0, 'corrupt payload degrades to empty');

// A storage-less browser (private mode) must not throw either.
const saved = globalThis.localStorage;
globalThis.localStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};
assert.equal(handledKeys(NOW).size, 0, 'blocked storage degrades to empty');
markAcked(KEY, EVENT.start); // must not throw
globalThis.localStorage = saved;

console.log('reminderAcks: all assertions passed');
