// Self-check for the reminder window logic.  Run: node reminderSchedule.test.mjs
import assert from 'node:assert/strict';
import { dueReminders, minutesUntil, isAllDay, reminderKey } from './reminderSchedule.js';

const NOW = new Date('2026-09-08T08:00:00Z').getTime();
const at = (min) => new Date(NOW + min * 60000).toISOString();
const ev = (id, min, extra = {}) => ({ id, title: id, start: at(min), ...extra });

// inside the window
assert.deepEqual(
  dueReminders([ev('a', 5)], 10, NOW).map((d) => d.event.id),
  ['a'],
  'event 5min out should fire with a 10min lead',
);

// outside the window
assert.equal(dueReminders([ev('b', 25)], 10, NOW).length, 0, 'too far out');

// exactly at the lead edge is included
assert.equal(dueReminders([ev('c', 10)], 10, NOW).length, 1, 'lead edge inclusive');

// already started / in the past must never fire — this is the kiosk-reload guard
assert.equal(dueReminders([ev('d', 0)], 10, NOW).length, 0, 'starting now');
assert.equal(dueReminders([ev('e', -30)], 10, NOW).length, 0, 'already past');

// all-day events have no time to alarm against
assert.equal(dueReminders([ev('f', 5, { allDay: true })], 10, NOW).length, 0, 'allDay flag');
assert.equal(
  dueReminders([{ id: 'g', title: 'g', start: '2026-09-08' }], 10, NOW).length,
  0,
  'date-only start',
);

// already-fired events are not repeated. The fired set is keyed per
// OCCURRENCE (id + start), not by id, because the ICS parser reuses an id
// across every week of a recurring series.
const fired = ev('h', 5);
assert.equal(
  dueReminders([fired], 10, NOW, new Set([reminderKey(fired)])).length,
  0,
  'dedupe via fired set',
);
assert.equal(
  dueReminders([fired], 10, NOW, new Set(['h'])).length,
  1,
  'a bare id must NOT suppress it - that would silence the whole series',
);
assert.equal(reminderKey(fired), `h@${fired.start}`, 'key shape is id@start');

// junk input must not throw
assert.equal(dueReminders(null, 10, NOW).length, 0, 'null events');
assert.equal(dueReminders([null, undefined], 10, NOW).length, 0, 'null entries');
assert.equal(dueReminders([{ id: 'i', start: 'not-a-date' }], 10, NOW).length, 0, 'bad date');
assert.equal(minutesUntil('nope', NOW), null, 'unparseable start');

// reported minutes are rounded for display
assert.equal(dueReminders([ev('j', 7)], 10, NOW)[0].minutes, 7, 'minutes reported');

// lead of 60 picks up an event 45min out that a 10min lead would skip
assert.equal(dueReminders([ev('k', 45)], 60, NOW).length, 1, 'hour lead');
assert.equal(dueReminders([ev('k', 45)], 10, NOW).length, 0, 'ten-min lead skips it');

assert.equal(isAllDay({ start: '2026-09-08' }), true);
assert.equal(isAllDay({ start: '2026-09-08T10:00:00Z' }), false);

console.log('reminderSchedule: all assertions passed');
