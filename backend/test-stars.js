'use strict';

// Self-check for the weekly stars. No framework, no fixtures:
//   node backend/test-stars.js
// Covers what would quietly give a child the wrong week: the Saturday/Sunday
// boundary, a star that must survive the nightly reset, a removed star that must
// not come back just because the chores are still ticked, and a week that must
// not be able to earn a reward from last week's stars.

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const stars = require('./lib/stars');

const migration = (name) => fs.readFileSync(path.join(__dirname, 'db/migrations', name), 'utf-8');

// ─── the calendar ───────────────────────────────────────────────────────────
// 2026-10-04 is a Sunday, 2026-10-10 the Saturday that ends that week.

test('the week runs Sunday to Saturday', () => {
  assert.equal(stars.weekStart('2026-10-04'), '2026-10-04', 'a Sunday starts its own week');
  assert.equal(stars.weekStart('2026-10-06'), '2026-10-04', 'Tuesday');
  assert.equal(stars.weekStart('2026-10-10'), '2026-10-04', 'Saturday is still that week');
  assert.equal(stars.weekStart('2026-10-11'), '2026-10-11', 'Sunday starts the next one');
  assert.deepEqual(stars.weekDays('2026-10-07'), [
    '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
  ]);
});

test('day arithmetic does not slip over a clock change (Israel goes back on 25 Oct 2026)', () => {
  assert.equal(stars.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(stars.addDays('2026-03-26', 2), '2026-03-28');
  assert.equal(stars.weekStart('2026-10-25'), '2026-10-25');
  assert.equal(stars.weekDays('2026-10-28').length, 7);
});

test('isDay accepts real calendar days only', () => {
  assert.equal(stars.isDay('2026-10-06'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '26-10-06', '2026-10-6', 'today', '', null, undefined, 20261006]) {
    assert.equal(stars.isDay(bad), false, String(bad));
  }
});

test('summarize counts earned stars only, inside the week', () => {
  const rows = [
    { day: '2026-10-03', status: 'earned' },   // the Saturday before: last week
    { day: '2026-10-04', status: 'earned' },
    { day: '2026-10-05', status: 'removed' },  // taken back
    { day: '2026-10-06', status: 'earned' },
    { day: '2026-10-11', status: 'earned' },   // next week
  ];
  const s = stars.summarize(rows, '2026-10-06');
  assert.equal(s.week, 2);
  assert.equal(s.goal, 6);
  assert.equal(s.reward, false);
  assert.equal(s.weekStart, '2026-10-04');
  assert.deepEqual(s.days.map((d) => d.status), ['earned', 'removed', 'earned', null, null, null, null]);
  // the same rows seen from the next Sunday: only that day's star counts
  assert.equal(stars.summarize(rows, '2026-10-11').week, 1);
});

test('six earned stars in the week reach the reward', () => {
  const rows = stars.weekDays('2026-10-06').slice(0, 6).map((day) => ({ day, status: 'earned' }));
  const s = stars.summarize(rows, '2026-10-06');
  assert.equal(s.week, 6);
  assert.equal(s.reward, true);
  rows[2].status = 'removed';
  assert.equal(stars.summarize(rows, '2026-10-06').reward, false, 'a removed star takes it back under six');
});

// ─── the rules, on a real database ──────────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(migration('002_chores.sql'));
  db.exec(migration('012_chore_stars.sql'));
  db.prepare("INSERT INTO chore_people (id, name) VALUES ('kid', 'Noa')").run();
  return db;
}
const addChore = (db, id) => db.prepare("INSERT INTO chore_tasks (id, person_id, title) VALUES (?, 'kid', ?)").run(id, id);
const tick = (db, id, on = 1) => db.prepare('UPDATE chore_tasks SET completed = ? WHERE id = ?').run(on, id);
const rowsOf = (db) => db.prepare('SELECT day, status FROM chore_stars ORDER BY day').all();

test('the star comes with the last chore, not before', () => {
  const db = makeDb();
  ['a', 'b', 'c'].forEach((id) => addChore(db, id));
  tick(db, 'a');
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-06'), false);
  tick(db, 'b');
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-06'), false);
  tick(db, 'c');
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-06'), true);
  assert.deepEqual(rowsOf(db), [{ day: '2026-10-06', status: 'earned' }]);
});

test('a child with no chores earns nothing', () => {
  const db = makeDb();
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-06'), false);
  assert.deepEqual(rowsOf(db), []);
});

test('one star a day however often the last chore is ticked', () => {
  const db = makeDb();
  addChore(db, 'a');
  tick(db, 'a');
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-06'), true);
  tick(db, 'a', 0);
  tick(db, 'a', 1);
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-06'), false, 'ticked again the same day');
  assert.equal(rowsOf(db).length, 1);
});

test('the star survives the nightly reset, and the next day earns its own', () => {
  const db = makeDb();
  addChore(db, 'a');
  tick(db, 'a');
  stars.awardStarIfDone(db, 'kid', '2026-10-06');
  db.prepare('UPDATE chore_tasks SET completed = 0').run();   // what the 00:00 reset does
  assert.deepEqual(rowsOf(db), [{ day: '2026-10-06', status: 'earned' }], 'still there');
  tick(db, 'a');
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-07'), true);
  assert.equal(stars.summarize(db.prepare('SELECT day, status FROM chore_stars').all(), '2026-10-07').week, 2);
});

test('a removed star stays removed even though the chores are all ticked', () => {
  const db = makeDb();
  addChore(db, 'a');
  tick(db, 'a');
  stars.awardStarIfDone(db, 'kid', '2026-10-06');
  assert.equal(stars.removeStar(db, 'kid', '2026-10-06', '2026-10-06'), true);
  assert.deepEqual(rowsOf(db), [{ day: '2026-10-06', status: 'removed' }]);
  tick(db, 'a', 0);
  tick(db, 'a', 1);
  assert.equal(stars.awardStarIfDone(db, 'kid', '2026-10-06'), false, 'not earned a second time');
  assert.equal(stars.summarize(db.prepare('SELECT day, status FROM chore_stars').all(), '2026-10-06').week, 0);
});

test('only an earned star of this week can be removed', () => {
  const db = makeDb();
  db.prepare("INSERT INTO chore_stars (person_id, day) VALUES ('kid', '2026-10-06'), ('kid', '2026-10-02')").run();
  assert.equal(stars.removeStar(db, 'kid', '2026-10-02', '2026-10-06'), false, 'last week');
  assert.equal(stars.removeStar(db, 'kid', '2026-10-07', '2026-10-06'), false, 'no star that day');
  assert.equal(stars.removeStar(db, 'kid', 'nonsense', '2026-10-06'), false, 'not a day');
  assert.equal(stars.removeStar(db, 'nobody', '2026-10-06', '2026-10-06'), false, 'not a child');
  assert.equal(stars.removeStar(db, 'kid', '2026-10-06', '2026-10-06'), true);
  assert.equal(stars.removeStar(db, 'kid', '2026-10-06', '2026-10-06'), false, 'already removed');
});

test('a parent can give back a removed star, and only a removed one of this week', () => {
  const db = makeDb();
  db.prepare("INSERT INTO chore_stars (person_id, day, status) VALUES ('kid', '2026-10-06', 'earned'), ('kid', '2026-10-05', 'removed'), ('kid', '2026-10-02', 'removed')").run();
  assert.equal(stars.restoreStar(db, 'kid', '2026-10-06', '2026-10-06'), false, 'already earned: nothing to give back');
  assert.equal(stars.restoreStar(db, 'kid', '2026-10-07', '2026-10-06'), false, 'no star that day: it cannot be made');
  assert.equal(stars.restoreStar(db, 'kid', '2026-10-02', '2026-10-06'), false, 'last week');
  assert.equal(stars.restoreStar(db, 'kid', 'nonsense', '2026-10-06'), false, 'not a day');
  assert.equal(stars.restoreStar(db, 'nobody', '2026-10-05', '2026-10-06'), false, 'not a child');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM chore_stars").get().n, 3, 'no row was made along the way');
  assert.equal(stars.restoreStar(db, 'kid', '2026-10-05', '2026-10-06'), true);
  assert.equal(stars.restoreStar(db, 'kid', '2026-10-05', '2026-10-06'), false, 'once');
  assert.equal(stars.summarize(db.prepare('SELECT day, status FROM chore_stars').all(), '2026-10-06').week, 2);
});

test('stars follow the child out when they are deleted', () => {
  const db = makeDb();
  db.prepare("INSERT INTO chore_stars (person_id, day) VALUES ('kid', '2026-10-06')").run();
  db.prepare("DELETE FROM chore_people WHERE id = 'kid'").run();
  assert.deepEqual(rowsOf(db), []);
});

// ─── through the routes the screens use ─────────────────────────────────────

function makeApp() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of ['002_chores.sql', '003_kanban_tasks.sql', '005_task_subtasks.sql', '012_chore_stars.sql']) db.exec(migration(m));
  const app = express();
  app.use(express.json());
  app.locals.db = db;
  app.locals.logger = { info() {}, warn() {}, error() {} };
  const emitted = [];
  app.locals.io = { emit: (name) => emitted.push(name) };
  app.use('/api/tasks', require('./routes/tasks'));
  const server = app.listen(0);
  return { db, server, emitted, base: `http://127.0.0.1:${server.address().port}/api/tasks` };
}

async function call(base, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* a plain 404 page */ }
  return { status: res.status, body: parsed };
}

test('stars through the routes: earn, keep, remove, reward', async (t) => {
  const { db, server, base, emitted } = makeApp();
  t.after(() => server.close());
  db.prepare("INSERT INTO chore_people (id, name, color, position) VALUES ('p1', 'Noa', '#111', 0)").run();
  const ids = [];
  for (const title of ['sweep', 'dishes', 'bed']) ids.push((await call(base, 'POST', '/people/p1/tasks', { title })).body.id);
  const toggle = async (id, completed) => (await call(base, 'PATCH', `/people/p1/tasks/${id}/toggle`, { completed })).body;
  const noa = async () => (await call(base, 'GET', '/people')).body[0];
  const today = stars.localDay();

  assert.equal((await noa()).stars.week, 0);
  assert.equal((await toggle(ids[0], true)).starAwarded, false);
  assert.equal((await toggle(ids[1], true)).starAwarded, false);
  assert.equal((await noa()).stars.week, 0, 'two of three is no star');
  const last = await toggle(ids[2], true);
  assert.equal(last.starAwarded, true, 'the last chore earns it');
  const earned = await noa();
  assert.equal(earned.stars.week, 1);
  assert.equal(earned.stars.days.find((d) => d.day === today).status, 'earned');
  assert.ok(emitted.length > 0, 'screens are told');

  // the nightly reset un-ticks everything; the star stays
  for (const id of ids) await toggle(id, false);
  assert.equal((await noa()).stars.week, 1);
  // ticking everything again the same day earns nothing more
  for (const id of ids.slice(0, 2)) await toggle(id, true);
  assert.equal((await toggle(ids[2], true)).starAwarded, false);
  assert.equal((await noa()).stars.week, 1);

  // a parent takes it back; it does not return by itself
  assert.equal((await call(base, 'DELETE', `/people/p1/stars/${today}`)).status, 200);
  assert.equal((await noa()).stars.week, 0);
  assert.equal((await noa()).stars.days.find((d) => d.day === today).status, 'removed');
  for (const id of ids) await toggle(id, false);
  for (const id of ids.slice(0, 2)) await toggle(id, true);
  assert.equal((await toggle(ids[2], true)).starAwarded, false);
  assert.equal((await noa()).stars.week, 0);

  // giving it back: the star returns, the count and the reward follow
  assert.equal((await call(base, 'POST', `/people/p1/stars/${today}/restore`)).status, 200);
  assert.equal((await noa()).stars.week, 1);
  assert.equal((await noa()).stars.days.find((d) => d.day === today).status, 'earned');
  assert.equal((await call(base, 'POST', `/people/p1/stars/${today}/restore`)).status, 404, 'nothing left to give back');
  // and it can be taken away again
  assert.equal((await call(base, 'DELETE', `/people/p1/stars/${today}`)).status, 200);
  assert.equal((await noa()).stars.week, 0);

  // taking back what is not there, or what is not this week's, is a 404
  assert.equal((await call(base, 'DELETE', `/people/p1/stars/${today}`)).status, 404);
  assert.equal((await call(base, 'DELETE', `/people/p1/stars/${stars.addDays(today, -8)}`)).status, 404);
  assert.equal((await call(base, 'DELETE', '/people/p1/stars/garbage')).status, 404);
  assert.equal((await call(base, 'DELETE', `/people/nobody/stars/${today}`)).status, 404);

  // six this week is a reward; stars from last week are not counted towards it
  const week = stars.weekDays(today);
  const put = db.prepare("INSERT OR REPLACE INTO chore_stars (person_id, day, status) VALUES ('p1', ?, 'earned')");
  for (const day of week.slice(0, 5)) put.run(day);
  put.run(stars.addDays(week[0], -1));
  put.run(stars.addDays(week[0], -2));
  assert.equal((await noa()).stars.week, 5, 'last week is not counted');
  assert.equal((await noa()).stars.reward, false);
  put.run(week[5]);
  const done = await noa();
  assert.equal(done.stars.week, 6);
  assert.equal(done.stars.reward, true);
  assert.equal(done.stars.goal, 6);
});

test('there is no way to add a star by hand', async (t) => {
  const { db, server, base } = makeApp();
  t.after(() => server.close());
  db.prepare("INSERT INTO chore_people (id, name, color, position) VALUES ('p1', 'Noa', '#111', 0)").run();
  const day = stars.localDay();
  for (const method of ['POST', 'PUT', 'PATCH']) {
    const r = await call(base, method, `/people/p1/stars/${day}`, { status: 'earned' });
    assert.ok([404, 405].includes(r.status), `${method} -> ${r.status}`);
  }
  // restoring is not a back door either: a day with no star has nothing to restore
  const restore = await call(base, 'POST', `/people/p1/stars/${day}/restore`);
  assert.equal(restore.status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM chore_stars').get().n, 0);
});
