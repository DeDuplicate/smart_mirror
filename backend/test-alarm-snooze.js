'use strict';

// Self-check for the escalating snooze. No framework, no fixtures:
//   node backend/test-alarm-snooze.js
// The ladder is the whole point — a snooze that always bought the same ten
// minutes is what this replaced — so the things worth pinning are that each
// press is worth one more multiple of the base, that it stops at an hour, and
// that the count is persisted rather than recomputed from the clock.

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

function makeApp() {
  const db = new Database(':memory:');
  for (const file of ['006_alarms.sql', '007_alarms_snooze.sql', '009_alarm_snooze_count.sql']) {
    db.exec(fs.readFileSync(path.join(__dirname, 'db/migrations', file), 'utf-8'));
  }

  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.locals.logger = { info() {}, warn() {}, error() {} };
  app.use('/api/alarms', require('./routes/alarms'));

  const server = app.listen(0);
  return { db, server, base: `http://127.0.0.1:${server.address().port}` };
}

async function req(base, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function addAlarm(db, id = 'a1') {
  db.prepare("INSERT INTO alarms (id, time, media_id) VALUES (?, '07:00', 'vid1')").run(id);
  return id;
}

test('escalating snooze', async (t) => {
  const { db, server, base } = makeApp();
  t.after(() => server.close());

  await t.test('each press buys one more multiple of the base', async () => {
    const id = addAlarm(db, 'ladder');
    const got = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await req(base, 'POST', `/api/alarms/${id}/snooze`, { minutes: 10 });
      assert.equal(r.status, 200);
      got.push(r.body.minutes);
    }
    assert.deepEqual(got, [10, 20, 30]);
    assert.equal(db.prepare('SELECT snooze_count c FROM alarms WHERE id = ?').get(id).c, 3);
  });

  await t.test('honours the base from Settings', async () => {
    const id = addAlarm(db, 'base5');
    const a = await req(base, 'POST', `/api/alarms/${id}/snooze`, { minutes: 5 });
    const b = await req(base, 'POST', `/api/alarms/${id}/snooze`, { minutes: 5 });
    assert.deepEqual([a.body.minutes, b.body.minutes], [5, 10]);
  });

  await t.test('caps at an hour instead of climbing forever', async () => {
    const id = addAlarm(db, 'cap');
    let last = 0;
    for (let i = 0; i < 8; i += 1) {
      last = (await req(base, 'POST', `/api/alarms/${id}/snooze`, { minutes: 20 })).body.minutes;
    }
    assert.equal(last, 60);
  });

  await t.test('sets snooze_until that far ahead, not the base', async () => {
    const id = addAlarm(db, 'until');
    await req(base, 'POST', `/api/alarms/${id}/snooze`, { minutes: 10 });
    const second = Date.now();
    await req(base, 'POST', `/api/alarms/${id}/snooze`, { minutes: 10 });
    const { snooze_until: until } = db.prepare('SELECT snooze_until FROM alarms WHERE id = ?').get(id);
    const aheadMin = (until - second) / 60000;
    assert.ok(aheadMin > 19.5 && aheadMin < 20.5, `expected ~20 min ahead, got ${aheadMin}`);
  });

  await t.test('a missing or junk base falls back to the default', async () => {
    const id = addAlarm(db, 'junk');
    const a = await req(base, 'POST', `/api/alarms/${id}/snooze`, {});
    const b = await req(base, 'POST', `/api/alarms/${id}/snooze`, { minutes: 'soon' });
    assert.deepEqual([a.body.minutes, b.body.minutes], [10, 20]);
  });

  await t.test('404s for an alarm that is not there', async () => {
    const r = await req(base, 'POST', '/api/alarms/nope/snooze', { minutes: 10 });
    assert.equal(r.status, 404);
  });
});
