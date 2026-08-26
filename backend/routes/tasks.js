'use strict';

const { Router } = require('express');
const router = Router();

const { getValidGoogleToken, getAccountsByProvider } = require('./auth');

const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

// ---------------------------------------------------------------------------
// Helper: get the first linked Google account's token
// ---------------------------------------------------------------------------
async function getTasksToken(db, logger) {
  const accounts = getAccountsByProvider(db, 'google');
  if (accounts.length === 0) throw new Error('No Google account linked');
  return getValidGoogleToken(db, accounts[0].email, logger);
}

// ---------------------------------------------------------------------------
// GET /api/tasks/lists — available task lists
// ---------------------------------------------------------------------------
router.get('/lists', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const token = await getTasksToken(db, logger);
    const response = await fetch(`${GOOGLE_TASKS_API}/users/@me/lists`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Tasks API ${response.status}: ${text}`);
    }

    const data = await response.json();
    res.json({ lists: data.items || [] });
  } catch (err) {
    logger.error('Tasks lists error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tasks?listId= — all tasks from a task list
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const token = await getTasksToken(db, logger);
    const listId = req.query.listId || '@default';

    const params = new URLSearchParams({
      maxResults: '100',
      showCompleted: req.query.showCompleted || 'true',
      showHidden: 'false',
    });

    const response = await fetch(
      `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(listId)}/tasks?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Tasks API ${response.status}: ${text}`);
    }

    const data = await response.json();
    const tasks = (data.items || []).map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes || '',
      status: t.status,
      due: t.due || null,
      completed: t.completed || null,
      parent: t.parent || null,
      position: t.position,
      updated: t.updated,
    }));

    res.json({ tasks });
  } catch (err) {
    logger.error('Tasks fetch error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks — create a new task
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const token = await getTasksToken(db, logger);
    const listId = req.body.listId || '@default';

    const taskBody = {
      title: req.body.title,
      notes: req.body.notes || '',
      due: req.body.due || undefined,
    };

    const response = await fetch(
      `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskBody),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Tasks API ${response.status}: ${text}`);
    }

    const task = await response.json();
    logger.info('Task created: %s', task.id);
    res.status(201).json({ task });
  } catch (err) {
    logger.error('Task create error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tasks/:id — update a task
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const token = await getTasksToken(db, logger);
    const listId = req.body.listId || '@default';
    const taskId = req.params.id;

    const updates = {};
    if (req.body.title !== undefined) updates.title = req.body.title;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.due !== undefined) updates.due = req.body.due;
    // Google Tasks requires "completed" field when marking as completed
    if (req.body.status === 'completed') {
      updates.completed = new Date().toISOString();
    }

    const response = await fetch(
      `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Tasks API ${response.status}: ${text}`);
    }

    const task = await response.json();
    logger.info('Task updated: %s', task.id);
    res.json({ task });
  } catch (err) {
    logger.error('Task update error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id — delete a task
// ---------------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const token = await getTasksToken(db, logger);
    const listId = req.query.listId || '@default';
    const taskId = req.params.id;

    const response = await fetch(
      `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Tasks API ${response.status}: ${text}`);
    }

    logger.info('Task deleted: %s', taskId);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Task delete error: %s', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ===========================================================================
// Person-based Chores (SQLite-backed)
// ===========================================================================

/** Ensure chore tables exist (idempotent) */
function ensureChoresTables(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS chore_people (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      color TEXT DEFAULT '#6b62e0',
      position INTEGER DEFAULT 0
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS chore_tasks (
      id          TEXT PRIMARY KEY,
      person_id   TEXT NOT NULL REFERENCES chore_people(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      emoji       TEXT DEFAULT '📌',
      completed   INTEGER DEFAULT 0,
      recurrence  TEXT DEFAULT 'once',
      due_date    TEXT,
      created_at  INTEGER DEFAULT (unixepoch()),
      position    INTEGER DEFAULT 0
    )
  `).run();
}

/** Sync people from localStorage-configured family (sent by frontend) */
function syncPeople(db, configuredPeople) {
  if (!Array.isArray(configuredPeople) || configuredPeople.length === 0) return;

  const upsert = db.prepare(`
    INSERT INTO chore_people (id, name, color, position)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, position = excluded.position
  `);

  const tx = db.transaction(() => {
    configuredPeople.forEach((p, i) => {
      upsert.run(p.id, p.name, p.color || '#6b62e0', i);
    });
  });
  tx();
}

// ---------------------------------------------------------------------------
// GET /api/tasks/people — all people with their chore tasks
// ---------------------------------------------------------------------------
router.get('/people', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    ensureChoresTables(db);

    // If frontend sends configured people via query, sync them
    if (req.query.sync) {
      try {
        const people = JSON.parse(req.query.sync);
        syncPeople(db, people);
      } catch { /* ignore bad sync data */ }
    }

    const people = db.prepare('SELECT * FROM chore_people ORDER BY position, rowid').all();
    const taskStmt = db.prepare('SELECT * FROM chore_tasks WHERE person_id = ? ORDER BY position, created_at');

    const result = people.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      tasks: taskStmt.all(p.id).map((t) => ({
        id: t.id,
        title: t.title,
        emoji: t.emoji,
        completed: t.completed === 1,
        recurrence: t.recurrence,
        dueDate: t.due_date,
      })),
    }));

    res.json(result);
  } catch (err) {
    logger.error('Chores people fetch error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/people/:personId/tasks/:taskId/toggle
// ---------------------------------------------------------------------------
router.patch('/people/:personId/tasks/:taskId/toggle', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    ensureChoresTables(db);
    const { personId, taskId } = req.params;

    const task = db.prepare('SELECT * FROM chore_tasks WHERE id = ? AND person_id = ?').get(taskId, personId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const newCompleted = task.completed === 1 ? 0 : 1;
    db.prepare('UPDATE chore_tasks SET completed = ? WHERE id = ?').run(newCompleted, taskId);

    res.json({ id: taskId, completed: newCompleted === 1 });
  } catch (err) {
    logger.error('Chores toggle error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks/people/:personId/tasks — add a chore task
// ---------------------------------------------------------------------------
router.post('/people/:personId/tasks', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    ensureChoresTables(db);
    const { personId } = req.params;

    // Verify person exists
    const person = db.prepare('SELECT id FROM chore_people WHERE id = ?').get(personId);
    if (!person) return res.status(404).json({ error: 'Person not found' });

    const id = `ct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { title, emoji, recurrence, dueDate } = req.body;

    db.prepare(`
      INSERT INTO chore_tasks (id, person_id, title, emoji, completed, recurrence, due_date)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(id, personId, title, emoji || '📌', recurrence || 'once', dueDate || null);

    const task = db.prepare('SELECT * FROM chore_tasks WHERE id = ?').get(id);

    res.status(201).json({
      id: task.id,
      title: task.title,
      emoji: task.emoji,
      completed: false,
      recurrence: task.recurrence,
      dueDate: task.due_date,
    });
  } catch (err) {
    logger.error('Chores add error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/people/:personId/tasks/:taskId — delete a chore task
// ---------------------------------------------------------------------------
router.delete('/people/:personId/tasks/:taskId', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    ensureChoresTables(db);
    const { personId, taskId } = req.params;

    const result = db.prepare('DELETE FROM chore_tasks WHERE id = ? AND person_id = ?').run(taskId, personId);
    if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });

    res.json({ ok: true });
  } catch (err) {
    logger.error('Chores delete error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
