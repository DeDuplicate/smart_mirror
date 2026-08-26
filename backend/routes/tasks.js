'use strict';

const { Router } = require('express');
const router = Router();

// ---------------------------------------------------------------------------
// Local kanban tasks (SQLite — table created by migrations/003_kanban_tasks.sql)
// Field names match the frontend kanban model: id, title, description,
// status ('todo' | 'inProgress' | 'done'), priority, starred, dueDate,
// listName, listColor, position.
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(['todo', 'inProgress', 'done']);
const VALID_PRIORITIES = new Set(['none', 'low', 'medium', 'high']);

function rowToTask(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    status: r.status,
    priority: r.priority || 'none',
    starred: r.starred === 1,
    dueDate: r.due_date || null,
    listName: r.list_name || null,
    listColor: r.list_color || null,
    position: r.position,
    updated: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// GET /api/tasks — all kanban tasks (array, as the frontend expects)
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const db = req.app.locals.db;

  try {
    const rows = db
      .prepare('SELECT * FROM kanban_tasks ORDER BY position, rowid')
      .all();
    res.json(rows.map(rowToTask));
  } catch (err) {
    req.app.locals.logger.error('Tasks fetch error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks — create a new task
// ---------------------------------------------------------------------------
router.post('/', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const id = `kt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const status = VALID_STATUSES.has(body.status) ? body.status : 'todo';
    const priority = VALID_PRIORITIES.has(body.priority) ? body.priority : 'none';
    const pos = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM kanban_tasks')
      .get().pos;

    db.prepare(
      `INSERT INTO kanban_tasks
         (id, title, description, status, priority, starred, due_date, list_name, list_color, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      title,
      body.description || '',
      status,
      priority,
      body.starred ? 1 : 0,
      body.dueDate || null,
      body.listName || null,
      body.listColor || null,
      pos
    );

    const row = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(id);
    logger.info('Task created: %s', id);
    res.status(201).json(rowToTask(row));
  } catch (err) {
    logger.error('Task create error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/tasks/:id — update a task (PUT kept as an alias)
// ---------------------------------------------------------------------------
function updateTaskHandler(req, res) {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const taskId = req.params.id;
    const existing = db
      .prepare('SELECT * FROM kanban_tasks WHERE id = ?')
      .get(taskId);
    if (!existing) return res.status(404).json({ error: 'Task not found' });

    const body = req.body || {};
    const sets = [];
    const values = [];

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return res.status(400).json({ error: 'Title cannot be empty' });
      sets.push('title = ?');
      values.push(title);
    }
    if (body.description !== undefined) {
      sets.push('description = ?');
      values.push(String(body.description));
    }
    if (body.status !== undefined) {
      if (!VALID_STATUSES.has(body.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      sets.push('status = ?');
      values.push(body.status);
    }
    if (body.priority !== undefined) {
      if (!VALID_PRIORITIES.has(body.priority)) {
        return res.status(400).json({ error: 'Invalid priority' });
      }
      sets.push('priority = ?');
      values.push(body.priority);
    }
    if (body.starred !== undefined) {
      sets.push('starred = ?');
      values.push(body.starred ? 1 : 0);
    }
    if (body.dueDate !== undefined) {
      sets.push('due_date = ?');
      values.push(body.dueDate || null);
    }
    if (body.listName !== undefined) {
      sets.push('list_name = ?');
      values.push(body.listName || null);
    }
    if (body.listColor !== undefined) {
      sets.push('list_color = ?');
      values.push(body.listColor || null);
    }
    if (body.position !== undefined) {
      sets.push('position = ?');
      values.push(Number(body.position) || 0);
    }

    if (sets.length === 0) {
      return res.json(rowToTask(existing));
    }

    sets.push("updated_at = datetime('now')");
    values.push(taskId);
    db.prepare(`UPDATE kanban_tasks SET ${sets.join(', ')} WHERE id = ?`).run(
      ...values
    );

    const row = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(taskId);
    logger.info('Task updated: %s', taskId);
    res.json(rowToTask(row));
  } catch (err) {
    logger.error('Task update error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
}
router.patch('/:id', updateTaskHandler);
router.put('/:id', updateTaskHandler);

// ---------------------------------------------------------------------------
// DELETE /api/tasks/:id — delete a task
// ---------------------------------------------------------------------------
router.delete('/:id', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const taskId = req.params.id;
    const result = db.prepare('DELETE FROM kanban_tasks WHERE id = ?').run(taskId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    logger.info('Task deleted: %s', taskId);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Task delete error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// Person-based Chores (SQLite-backed)
// ===========================================================================
// Table creation lives solely in db/migrations/002_chores.sql, applied once
// at boot by runMigrations() in server.js before any route is reachable —
// there is no ensureChoresTables() call here anymore. Keeping a second
// inline CREATE TABLE IF NOT EXISTS in sync with the migration file by hand
// was the actual bug (see TASKS.md): the two could silently drift apart.

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
