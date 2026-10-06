'use strict';

// Self-check for the person-based chores routes. No framework, no fixtures:
//   node backend/test-chores.js
// Covers the three things that made "add chore" fail silently in the UI —
// blank titles reaching SQLite, every chore landing on position 0, and the
// people sync stomping positions on every poll.

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

function makeApp() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, 'db/migrations/002_chores.sql'), 'utf-8'));
  db.exec(fs.readFileSync(path.join(__dirname, 'db/migrations/003_kanban_tasks.sql'), 'utf-8'));
  db.exec(fs.readFileSync(path.join(__dirname, 'db/migrations/005_task_subtasks.sql'), 'utf-8'));
  db.exec(fs.readFileSync(path.join(__dirname, 'db/migrations/012_chore_stars.sql'), 'utf-8'));

  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.locals.logger = { info() {}, error() {} };
  app.use('/api/tasks', require('./routes/tasks'));

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, server, base };
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

test('chores routes', async (t) => {
  const { db, server, base } = makeApp();
  t.after(() => server.close());

  db.prepare("INSERT INTO chore_people (id, name, color, position) VALUES ('p1','Ann','#111',0)").run();

  await t.test('rejects a blank title instead of writing it', async () => {
    for (const body of [undefined, {}, { title: '' }, { title: '   ' }]) {
      const r = await req(base, 'POST', '/api/tasks/people/p1/tasks', body);
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM chore_tasks').get().n, 0);
  });

  await t.test('trims the title and gives each chore its own position', async () => {
    const a = await req(base, 'POST', '/api/tasks/people/p1/tasks', { title: '  sweep  ' });
    const b = await req(base, 'POST', '/api/tasks/people/p1/tasks', { title: 'dishes' });
    assert.equal(a.status, 201);
    assert.equal(a.body.title, 'sweep');
    // created_at is second-resolution, so position is the only stable ordering.
    const rows = db.prepare('SELECT title, position FROM chore_tasks ORDER BY position').all();
    assert.deepEqual(rows, [
      { title: 'sweep', position: 0 },
      { title: 'dishes', position: 1 },
    ]);
    assert.equal(b.body.completed, false);
  });

  await t.test('toggle sets the state the screen asks for, so a repeat cannot flip it back', async () => {
    const id = db.prepare("SELECT id FROM chore_tasks WHERE title = 'sweep'").get().id;
    const url = `/api/tasks/people/p1/tasks/${id}/toggle`;
    assert.equal((await req(base, 'PATCH', url, { completed: true })).body.completed, true);
    assert.equal((await req(base, 'PATCH', url, { completed: true })).body.completed, true, 'same request twice stays done');
    assert.equal(db.prepare('SELECT completed FROM chore_tasks WHERE id = ?').get(id).completed, 1);
    assert.equal((await req(base, 'PATCH', url, { completed: false })).body.completed, false);
    assert.equal((await req(base, 'PATCH', url, { completed: false })).body.completed, false, 'same request twice stays open');
    // Older clients send no body and still get a flip.
    assert.equal((await req(base, 'PATCH', url)).body.completed, true);
    assert.equal((await req(base, 'PATCH', url)).body.completed, false);
  });

  await t.test('unknown person is a 404, not a 500', async () => {
    const r = await req(base, 'POST', '/api/tasks/people/nope/tasks', { title: 'x' });
    assert.equal(r.status, 404);
  });

  await t.test('people sync updates names but never restomps position', async () => {
    // A person added straight to the DB (Settings on another device) sits at 1.
    db.prepare("INSERT INTO chore_people (id, name, color, position) VALUES ('p2','Bob','#222',1)").run();
    // A poll from a client whose localStorage only knows Ann, at index 0.
    const sync = encodeURIComponent(JSON.stringify([{ id: 'p1', name: 'Anna', color: '#111' }]));
    const r = await req(base, 'GET', `/api/tasks/people?sync=${sync}`);
    assert.equal(r.status, 200);

    const people = db.prepare('SELECT id, name, position FROM chore_people ORDER BY position').all();
    assert.deepEqual(people, [
      { id: 'p1', name: 'Anna', position: 0 }, // renamed by the sync
      { id: 'p2', name: 'Bob', position: 1 },  // untouched, still distinct
    ]);
  });
});

test('nightly chore reset', async (t) => {
  const { runNightlyReset } = require('./routes/tasks');
  const db = new Database(':memory:');
  for (const f of ['001_initial.sql', '002_chores.sql']) {
    db.exec(fs.readFileSync(path.join(__dirname, 'db/migrations', f), 'utf-8'));
  }
  db.prepare("INSERT INTO chore_people (id, name) VALUES ('p1', 'Anna'), ('p2', 'Bob')").run();
  const seed = () => {
    db.prepare('DELETE FROM chore_tasks').run();
    db.prepare(`INSERT INTO chore_tasks (id, person_id, title, completed, recurrence) VALUES
      ('a', 'p1', 'dishes', 1, 'once'), ('b', 'p1', 'bed', 0, 'daily'),
      ('c', 'p2', 'trash', 1, 'once'), ('d', 'p2', 'homework', 1, 'weekly')`).run();
  };
  const done = () => db.prepare('SELECT id FROM chore_tasks WHERE completed = 1 ORDER BY id').all().map((r) => r.id);
  const emitted = [];
  const ctx = { db, io: { emit: (e) => emitted.push(e) }, logger: { info() {} } };

  await t.test('does nothing until the setting is on', () => {
    seed();
    assert.equal(runNightlyReset(ctx), 0, 'no setting row at all');
    db.prepare("INSERT OR REPLACE INTO config VALUES ('choresResetNightly', 'false')").run();
    assert.equal(runNightlyReset(ctx), 0);
    assert.deepEqual(done(), ['a', 'c', 'd']);
    assert.deepEqual(emitted, []);
  });

  await t.test('unchecks every completed chore, for everyone, and tells open screens', () => {
    // The value exactly as PUT /api/settings stores a boolean true.
    db.prepare("INSERT OR REPLACE INTO config VALUES ('choresResetNightly', ?)").run(JSON.stringify(true));
    assert.equal(runNightlyReset(ctx), 3);
    assert.deepEqual(done(), []);
    assert.deepEqual(emitted, ['tasks:updated']);
    // The chores themselves survive - only the ticks go.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chore_tasks').get().n, 4);
  });

  await t.test('a night with nothing ticked is quiet (no needless refetch)', () => {
    emitted.length = 0;
    assert.equal(runNightlyReset(ctx), 0);
    assert.deepEqual(emitted, []);
  });

  await t.test('the cron expression is valid and fires at local midnight', () => {
    const cron = require('node-cron');
    assert.ok(cron.validate('0 0 * * *'));
    assert.match(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8'), /cron\.schedule\('0 0 \* \* \*'/);
  });
});

test('chore reorder', async (t) => {
  const { db, server, base } = makeApp();
  t.after(() => server.close());
  db.prepare("INSERT INTO chore_people (id, name) VALUES ('p1', 'Anna'), ('p2', 'Bob')").run();
  for (const [id, person, pos] of [['a', 'p1', 0], ['b', 'p1', 1], ['c', 'p1', 2], ['x', 'p2', 0]]) {
    db.prepare("INSERT INTO chore_tasks (id, person_id, title, position) VALUES (?, ?, ?, ?)").run(id, person, id, pos);
  }
  const order = (p) => db.prepare('SELECT id FROM chore_tasks WHERE person_id = ? ORDER BY position').all(p).map((r) => r.id);
  const put = (p, body) => req(base, 'PUT', `/api/tasks/people/${p}/tasks/reorder`, body);

  await t.test('saves the new order as contiguous positions, and GET returns it', async () => {
    const r = await put('p1', { order: ['c', 'a', 'b'] });
    assert.equal(r.status, 200);
    assert.deepEqual(order('p1'), ['c', 'a', 'b']);
    assert.deepEqual(db.prepare("SELECT position FROM chore_tasks WHERE person_id='p1' ORDER BY position").all().map((x) => x.position), [0, 1, 2]);
    const people = (await req(base, 'GET', '/api/tasks/people')).body;
    assert.deepEqual(people.find((p) => p.id === 'p1').tasks.map((x) => x.id), ['c', 'a', 'b']);
  });

  await t.test('another kid keeps their own order', () => {
    assert.deepEqual(order('p2'), ['x']);
  });

  await t.test('a stale list is a 409 and changes nothing', async () => {
    const before = order('p1');
    assert.equal((await put('p1', { order: ['a', 'b'] })).status, 409, 'missing a chore');
    assert.equal((await put('p1', { order: ['a', 'b', 'c', 'zzz'] })).status, 409, 'unknown chore');
    assert.equal((await put('p1', { order: ['a', 'a', 'b'] })).status, 409, 'duplicate');
    assert.equal((await put('p1', { order: ['a', 'b', 'x'] })).status, 409, "another kid's chore");
    assert.deepEqual(order('p1'), before);
    assert.deepEqual(order('p2'), ['x'], "the other kid's chore was not touched");
  });

  await t.test('rejects a malformed body', async () => {
    assert.equal((await put('p1', {})).status, 400);
    assert.equal((await put('p1', { order: 'a,b,c' })).status, 400);
    assert.equal((await put('p1', { order: [1, 2, 3] })).status, 400);
  });
});
