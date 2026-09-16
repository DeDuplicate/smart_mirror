'use strict';

const { Router } = require('express');
const { randomUUID } = require('node:crypto');
const router = Router();

function localDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && localDate(new Date(`${value}T12:00:00`)) === value;
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringList(value) {
  return Array.isArray(value) && value.every(nonemptyString);
}

function emitUpdated(req) {
  const io = req.app.locals.io;
  if (io) io.emit('school:updated');
}

router.get('/schedule', (req, res) => {
  const db = req.app.locals.db;
  try {
    const schedule = Object.create(null);
    for (const person of db.prepare('SELECT id FROM chore_people ORDER BY position, rowid').all()) {
      schedule[person.id] = Object.create(null);
    }
    for (const row of db.prepare('SELECT * FROM school_schedule ORDER BY position, rowid').all()) {
      (schedule[row.person_id][row.day_of_week] ||= []).push(row.subject);
    }
    res.json({ schedule });
  } catch (err) {
    req.app.locals.logger.error('School schedule fetch error: %s', err.message);
    res.status(500).json({ error: 'Failed to fetch school schedule' });
  }
});

router.put('/schedule/:personId/:dayOfWeek', (req, res) => {
  const db = req.app.locals.db;
  const { personId, dayOfWeek } = req.params;
  const { subjects } = req.body || {};
  if (!/^[0-6]$/.test(dayOfWeek)) {
    return res.status(400).json({ error: 'dayOfWeek must be an integer from 0 to 6' });
  }
  if (!stringList(subjects)) {
    return res.status(400).json({ error: 'subjects must be an array of nonempty strings' });
  }
  try {
    if (!db.prepare('SELECT id FROM chore_people WHERE id = ?').get(personId)) {
      return res.status(404).json({ error: 'Person not found' });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM school_schedule WHERE person_id = ? AND day_of_week = ?')
        .run(personId, Number(dayOfWeek));
      const insert = db.prepare(
        'INSERT INTO school_schedule (id, person_id, day_of_week, subject, position) VALUES (?, ?, ?, ?, ?)'
      );
      subjects.forEach((subject, position) => {
        insert.run(randomUUID(), personId, Number(dayOfWeek), subject, position);
      });
    })();
    emitUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    req.app.locals.logger.error('School schedule update error: %s', err.message);
    res.status(500).json({ error: 'Failed to update school schedule' });
  }
});

router.get('/items', (req, res) => {
  try {
    const items = Object.create(null);
    for (const row of req.app.locals.db.prepare(
      'SELECT subject, item FROM school_subject_items ORDER BY position, rowid'
    ).all()) {
      (items[row.subject] ||= []).push(row.item);
    }
    res.json({ items });
  } catch (err) {
    req.app.locals.logger.error('School items fetch error: %s', err.message);
    res.status(500).json({ error: 'Failed to fetch school items' });
  }
});

router.put('/items/:subject', (req, res) => {
  const db = req.app.locals.db;
  // Express already decodes route parameters; decoding twice corrupts literal % sequences.
  const { subject } = req.params;
  const { items } = req.body || {};
  if (!nonemptyString(subject) || !stringList(items)) {
    return res.status(400).json({ error: 'subject and items must contain nonempty strings' });
  }
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM school_subject_items WHERE subject = ?').run(subject);
      const insert = db.prepare(
        'INSERT INTO school_subject_items (id, subject, item, position) VALUES (?, ?, ?, ?)'
      );
      items.forEach((item, position) => insert.run(randomUUID(), subject, item, position));
    })();
    emitUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    req.app.locals.logger.error('School items update error: %s', err.message);
    res.status(500).json({ error: 'Failed to update school items' });
  }
});

router.get('/today', (req, res) => {
  const db = req.app.locals.db;
  const date = req.query.date === undefined ? localDate() : req.query.date;
  if (!validDate(date)) {
    return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD calendar date' });
  }
  try {
    const day = new Date(`${date}T12:00:00`).getDay();
    const subjects = db.prepare(
      'SELECT subject FROM school_schedule WHERE person_id = ? AND day_of_week = ? ORDER BY position, rowid'
    );
    const items = db.prepare(
      'SELECT item FROM school_subject_items WHERE subject = ? ORDER BY position, rowid'
    );
    const checkedRows = db.prepare(
      'SELECT item_key FROM school_checklist_checked WHERE person_id = ? AND date = ?'
    );
    const people = db.prepare('SELECT id, name, color FROM chore_people ORDER BY position, rowid')
      .all().map((person) => {
        const checked = new Set(checkedRows.all(person.id, date).map((row) => row.item_key));
        return {
          personId: person.id,
          name: person.name,
          color: person.color,
          subjects: subjects.all(person.id, day).map(({ subject }) => ({
            subject,
            items: items.all(subject).map(({ item }) => {
              const itemKey = `${subject}::${item}`;
              return { itemKey, label: item, checked: checked.has(itemKey) };
            }),
          })),
        };
      });
    res.json({ date, people });
  } catch (err) {
    req.app.locals.logger.error('School today fetch error: %s', err.message);
    res.status(500).json({ error: 'Failed to fetch school checklist' });
  }
});

router.post('/checklist/toggle', (req, res) => {
  const db = req.app.locals.db;
  const { personId, date, itemKey, checked } = req.body || {};
  if (!nonemptyString(personId) || !validDate(date) || !nonemptyString(itemKey)
    || typeof checked !== 'boolean') {
    return res.status(400).json({ error: 'personId, valid date, itemKey and boolean checked are required' });
  }
  try {
    if (!db.prepare('SELECT id FROM chore_people WHERE id = ?').get(personId)) {
      return res.status(404).json({ error: 'Person not found' });
    }
    if (checked) {
      db.prepare('INSERT OR IGNORE INTO school_checklist_checked (person_id, date, item_key) VALUES (?, ?, ?)')
        .run(personId, date, itemKey);
    } else {
      db.prepare('DELETE FROM school_checklist_checked WHERE person_id = ? AND date = ? AND item_key = ?')
        .run(personId, date, itemKey);
    }
    const io = req.app.locals.io;
    if (io) io.emit('school:checklist-updated', { personId, date, itemKey, checked });
    res.json({ ok: true });
  } catch (err) {
    req.app.locals.logger.error('School checklist toggle error: %s', err.message);
    res.status(500).json({ error: 'Failed to toggle school checklist item' });
  }
});

module.exports = router;
