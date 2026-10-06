'use strict';

// Weekly stars for chores.
//
// A child earns a star on a day when every one of their chores is ticked. Six
// stars in a week earns a reward. The week is the Israeli one: Sunday to Saturday,
// so the count starts again on Sunday. Nothing is "reset" - the week is worked
// out from the date, and last week's rows simply fall outside it.
//
// Days are the mirror's own calendar days as 'YYYY-MM-DD' strings (not UTC): a
// chore finished at 23:50 Israel time is that evening's, whatever the UTC date.

const STAR_GOAL = 6;

const pad = (n) => String(n).padStart(2, '0');

function localDay(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Noon, so a daylight-saving change can never land the arithmetic on the day before.
function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function addDays(day, n) {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/** The Sunday that starts the week containing `day`. */
function weekStart(day) {
  return addDays(day, -parseDay(day).getDay());
}

/** The seven days of that week, Sunday first. */
function weekDays(day) {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && localDay(parseDay(value)) === value;
}

/** One child's week from their star rows: [{ day, status: 'earned' | 'removed' | null }, ...]. */
function summarize(rows, today) {
  const days = weekDays(today);
  const byDay = new Map(rows.map((r) => [r.day, r.status]));
  const list = days.map((day) => ({ day, status: byDay.get(day) || null }));
  const week = list.filter((d) => d.status === 'earned').length;
  return { goal: STAR_GOAL, today, weekStart: days[0], week, reward: week >= STAR_GOAL, days: list };
}

/** Every star row of the week containing `today`, for all children. */
function weekRows(db, today) {
  const days = weekDays(today);
  return db.prepare('SELECT person_id, day, status FROM chore_stars WHERE day >= ? AND day <= ?').all(days[0], days[6]);
}

/**
 * Called right after a chore is ticked. Earns `today`'s star if that was the last
 * chore. Returns true only when a star was newly earned: INSERT OR IGNORE means a
 * day already earned, or one a parent took back, is never earned again.
 */
function awardStarIfDone(db, personId, today) {
  const { total, done } = db
    .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(completed), 0) AS done FROM chore_tasks WHERE person_id = ?')
    .get(personId);
  if (!total || done !== total) return false;
  return db.prepare("INSERT OR IGNORE INTO chore_stars (person_id, day, status) VALUES (?, ?, 'earned')").run(personId, today).changes === 1;
}

/** A parent takes one earned star back. Only days of the current week; true if one was removed. */
function removeStar(db, personId, day, today) {
  if (!isDay(day) || !weekDays(today).includes(day)) return false;
  return db.prepare("UPDATE chore_stars SET status = 'removed' WHERE person_id = ? AND day = ? AND status = 'earned'").run(personId, day).changes === 1;
}

/**
 * A parent gives back a star they took away. Only a REMOVED one of this week: it
 * was earned by finishing that day's chores, so bringing it back adds nothing the
 * child did not do. A day with no star has no row to restore, so this can never
 * create one - stars still only come from finishing the day.
 */
function restoreStar(db, personId, day, today) {
  if (!isDay(day) || !weekDays(today).includes(day)) return false;
  return db.prepare("UPDATE chore_stars SET status = 'earned' WHERE person_id = ? AND day = ? AND status = 'removed'").run(personId, day).changes === 1;
}

module.exports = { STAR_GOAL, localDay, addDays, weekStart, weekDays, isDay, summarize, weekRows, awardStarIfDone, removeStar, restoreStar };
