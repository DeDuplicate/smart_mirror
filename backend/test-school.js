'use strict';

// Run with: node --test backend/test-school.js
const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');
const { runMigrations } = require('./db/migrate');

test('school schedule and daily packing checklist', async (t) => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, { info() {} });
  const app = express();
  const events = [];
  app.use(express.json());
  app.locals.db = db;
  app.locals.logger = { error() {} };
  app.locals.io = { emit: (...args) => events.push(args) };
  app.use('/api/school', require('./routes/school'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/school`;
  async function request(method, url, body, status = 200) {
    const response = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  db.prepare('INSERT INTO chore_people (id, name, color, position) VALUES (?, ?, ?, ?)')
    .run('child', 'Test child', '#123456', 0);
  db.prepare('INSERT INTO chore_people (id, name, color, position) VALUES (?, ?, ?, ?)')
    .run('other', 'Other child', '#654321', 1);

  const subject = 'אמנות / 100%20';
  const equipment = ['תיק אמנות', 'צבעים'];
  const itemUrl = `/items/${encodeURIComponent(subject)}`;
  const date = '2026-09-16';
  const itemKey = `${subject}::${equipment[0]}`;
  const toggle = { personId: 'child', date, itemKey, checked: true };
  await request('PUT', itemUrl, { items: ['old'] });
  await request('PUT', itemUrl, { items: equipment });
  await request('PUT', '/schedule/child/3', { subjects: ['old'] });
  await request('PUT', '/schedule/child/3', { subjects: [subject, 'math'] });
  assert.deepEqual(await request('GET', '/items'), { items: { [subject]: equipment } });
  assert.deepEqual(await request('GET', '/schedule'), {
    schedule: { child: { 3: [subject, 'math'] }, other: {} },
  });
  const today = await request('GET', `/today?date=${date}`);
  assert.deepEqual(today, {
    date,
    people: [
      {
        personId: 'child', name: 'Test child', color: '#123456',
        subjects: [
          { subject, items: equipment.map((label) => ({ itemKey: `${subject}::${label}`, label, checked: false })) },
          { subject: 'math', items: [] },
        ],
      },
      { personId: 'other', name: 'Other child', color: '#654321', subjects: [] },
    ],
  });
  await request('POST', '/checklist/toggle', toggle);
  await request('POST', '/checklist/toggle', toggle);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM school_checklist_checked').get().n, 1);
  assert.equal((await request('GET', `/today?date=${date}`)).people[0].subjects[0].items[0].checked, true);
  assert.equal((await request('GET', '/today?date=2026-09-23')).people[0].subjects[0].items[0].checked, false);
  await request('PUT', '/schedule/other/3', { subjects: [subject] });
  assert.equal((await request('GET', `/today?date=${date}`)).people[1].subjects[0].items[0].checked, false);
  await request('POST', '/checklist/toggle', { ...toggle, checked: false });
  assert.equal((await request('GET', `/today?date=${date}`)).people[0].subjects[0].items[0].checked, false);
  assert.deepEqual(events.at(-1), ['school:checklist-updated', { ...toggle, checked: false }]);
  assert.ok(events.some((event) => event.length === 1 && event[0] === 'school:updated'));

  for (const day of ['-1', '7', '1.5', '3x']) {
    await request('PUT', `/schedule/child/${day}`, { subjects: [] }, 400);
  }
  for (const subjects of [null, 'math', [3], [' ']]) {
    await request('PUT', '/schedule/child/3', { subjects }, 400);
  }
  await request('PUT', '/schedule/missing/3', { subjects: [] }, 404);
  await request('POST', '/checklist/toggle', { ...toggle, personId: 'missing' }, 404);
  for (const invalidDate of ['2026-02-30', '2026-13-01', '2026-9-16', '']) {
    await request('GET', `/today?date=${invalidDate}`, undefined, 400);
    await request('POST', '/checklist/toggle', { ...toggle, date: invalidDate }, 400);
  }
  await request('GET', '/today?date[]=2026-09-16', undefined, 400);
  await request('POST', '/checklist/toggle', { ...toggle, checked: 'true' }, 400);
  await request('POST', '/checklist/toggle', undefined, 400);
  await request('PUT', itemUrl, { items: [null] }, 400);
  assert.deepEqual((await request('GET', '/items')).items[subject], equipment);
  const now = new Date();
  const expectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal((await request('GET', '/today')).date, expectedDate);

  await request('PUT', '/items/__proto__', { items: ['constructor'] });
  assert.deepEqual((await request('GET', '/items')).items.__proto__, ['constructor']);
  await request('PUT', '/items/__proto__', { items: [] });
  await request('PUT', itemUrl, { items: [] });
  assert.deepEqual(await request('GET', '/items'), { items: {} });
  await request('PUT', '/schedule/other/3', { subjects: [] });
  assert.deepEqual((await request('GET', '/schedule')).schedule.other, {});
  await request('POST', '/checklist/toggle', toggle);
  db.prepare('DELETE FROM chore_people WHERE id = ?').run('child');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM school_schedule').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM school_checklist_checked').get().n, 0);
});
