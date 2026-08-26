'use strict';

const { Router } = require('express');
const router = Router();

// ---------------------------------------------------------------------------
// Local kanban tasks (SQLite — table created by migrations/003_kanban_tasks.sql)
// Field names match the frontend kanban model: id, title, description,
// status ('todo' | 'inProgress' | 'done'), priority, starred, dueDate,
// position. Checklist items live in kanban_subtasks (migrations/005).
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(['todo', 'inProgress', 'done']);
const VALID_PRIORITIES = new Set(['none', 'low', 'medium', 'high']);

/** Broadcast a change so other connected clients refetch immediately. */
function emitTasksUpdated(req) {
  const io = req.app.locals.io;
  if (io) io.emit('tasks:updated');
}

function rowToTask(r, subtasks) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    status: r.status,
    priority: r.priority || 'none',
    starred: r.starred === 1,
    dueDate: r.due_date || null,
    position: r.position,
    updated: r.updated_at,
    subtasks: (subtasks || []).map(rowToSubtask),
  };
}

function rowToSubtask(s) {
  return { id: s.id, title: s.title, done: s.done === 1, position: s.position };
}

function getSubtasks(db, taskId) {
  return db
    .prepare('SELECT * FROM kanban_subtasks WHERE task_id = ? ORDER BY position, rowid')
    .all(taskId);
}

// ---------------------------------------------------------------------------
// GET /api/tasks — all kanban tasks with their checklist sub-items
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const db = req.app.locals.db;

  try {
    const rows = db
      .prepare('SELECT * FROM kanban_tasks ORDER BY position, rowid')
      .all();
    const subStmt = db.prepare(
      'SELECT * FROM kanban_subtasks WHERE task_id = ? ORDER BY position, rowid'
    );
    res.json(rows.map((r) => rowToTask(r, subStmt.all(r.id))));
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
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM kanban_tasks WHERE status = ?')
      .get(status).pos;

    db.prepare(
      `INSERT INTO kanban_tasks
         (id, title, description, status, priority, starred, due_date, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      title,
      body.description || '',
      status,
      priority,
      body.starred ? 1 : 0,
      body.dueDate || null,
      pos
    );

    const row = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(id);
    logger.info('Task created: %s', id);
    emitTasksUpdated(req);
    res.status(201).json(rowToTask(row, []));
  } catch (err) {
    logger.error('Task create error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tasks/reorder — persist column + order for many tasks at once
// Body: { tasks: [{ id, status, position }] } — applied in one transaction.
// ---------------------------------------------------------------------------
router.put('/reorder', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const items = Array.isArray(req.body?.tasks) ? req.body.tasks : null;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'tasks array is required' });
    }

    for (const item of items) {
      if (typeof item?.id !== 'string' || !VALID_STATUSES.has(item.status)) {
        return res.status(400).json({ error: 'Each task needs id and a valid status' });
      }
    }

    const stmt = db.prepare(
      "UPDATE kanban_tasks SET status = ?, position = ?, updated_at = datetime('now') WHERE id = ?"
    );
    db.transaction(() => {
      for (const item of items) {
        stmt.run(item.status, Number(item.position) || 0, item.id);
      }
    })();

    emitTasksUpdated(req);
    const rows = db
      .prepare('SELECT * FROM kanban_tasks ORDER BY position, rowid')
      .all();
    const subStmt = db.prepare(
      'SELECT * FROM kanban_subtasks WHERE task_id = ? ORDER BY position, rowid'
    );
    res.json(rows.map((r) => rowToTask(r, subStmt.all(r.id))));
  } catch (err) {
    logger.error('Tasks reorder error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/completed — delete all done tasks in one statement
// ---------------------------------------------------------------------------
router.delete('/completed', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const result = db
      .prepare("DELETE FROM kanban_tasks WHERE status = 'done'")
      .run();
    logger.info('Cleared %d completed tasks', result.changes);
    emitTasksUpdated(req);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    logger.error('Clear completed error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Subtasks — checklist items inside a task
// (table: db/migrations/005_task_subtasks.sql, cascades on task delete)
// ---------------------------------------------------------------------------

// POST /api/tasks/:id/subtasks — add a checklist item
router.post('/:id/subtasks', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const task = db.prepare('SELECT id FROM kanban_tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const id = `st_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pos = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM kanban_subtasks WHERE task_id = ?')
      .get(req.params.id).pos;

    db.prepare('INSERT INTO kanban_subtasks (id, task_id, title, position) VALUES (?, ?, ?, ?)')
      .run(id, req.params.id, title, pos);

    const row = db.prepare('SELECT * FROM kanban_subtasks WHERE id = ?').get(id);
    emitTasksUpdated(req);
    res.status(201).json(rowToSubtask(row));
  } catch (err) {
    logger.error('Subtask create error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id/subtasks/:subId — tick / untick or rename an item
router.patch('/:id/subtasks/:subId', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const existing = db
      .prepare('SELECT * FROM kanban_subtasks WHERE id = ? AND task_id = ?')
      .get(req.params.subId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Subtask not found' });

    const sets = [];
    const values = [];

    if (req.body?.done !== undefined) {
      sets.push('done = ?');
      values.push(req.body.done ? 1 : 0);
    }
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ error: 'Title cannot be empty' });
      sets.push('title = ?');
      values.push(title);
    }

    if (sets.length > 0) {
      values.push(existing.id);
      db.prepare(`UPDATE kanban_subtasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      emitTasksUpdated(req);
    }

    const row = db.prepare('SELECT * FROM kanban_subtasks WHERE id = ?').get(existing.id);
    res.json(rowToSubtask(row));
  } catch (err) {
    logger.error('Subtask update error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id/subtasks/:subId — remove an item
router.delete('/:id/subtasks/:subId', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const result = db
      .prepare('DELETE FROM kanban_subtasks WHERE id = ? AND task_id = ?')
      .run(req.params.subId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Subtask not found' });

    emitTasksUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Subtask delete error: %s', err.message);
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
    if (body.position !== undefined) {
      sets.push('position = ?');
      values.push(Number(body.position) || 0);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(taskId);
      db.prepare(`UPDATE kanban_tasks SET ${sets.join(', ')} WHERE id = ?`).run(
        ...values
      );
    }

    const row = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(taskId);
    if (sets.length > 0) logger.info('Task updated: %s', taskId);
    if (sets.length > 0) emitTasksUpdated(req);
    res.json(rowToTask(row, getSubtasks(db, taskId)));
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
    emitTasksUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Task delete error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// Person-based Chores (SQLite-backed)
// ===========================================================================

// Avatar storage — column added lazily so a DB created before this feature
// still works without a schema_version bump.
let avatarColumnReady = false;
function ensureAvatarColumn(db) {
  if (avatarColumnReady) return;
  const cols = db.prepare('PRAGMA table_info(chore_people)').all();
  if (!cols.some((c) => c.name === 'avatar')) {
    db.prepare('ALTER TABLE chore_people ADD COLUMN avatar TEXT').run();
  }
  avatarColumnReady = true;
}
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

    ensureAvatarColumn(db);
    const people = db.prepare('SELECT * FROM chore_people ORDER BY position, rowid').all();
    const taskStmt = db.prepare('SELECT * FROM chore_tasks WHERE person_id = ? ORDER BY position, created_at');

    const result = people.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      avatar: p.avatar || null,
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
// POST /api/tasks/people — add a person directly (used by Settings → Family)
// ---------------------------------------------------------------------------
router.post('/people', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const id = req.body?.id && typeof req.body.id === 'string'
      ? req.body.id
      : `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const color = req.body?.color || '#6b62e0';
    const pos = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM chore_people')
      .get().pos;

    db.prepare('INSERT INTO chore_people (id, name, color, position) VALUES (?, ?, ?, ?)')
      .run(id, name, color, pos);

    emitTasksUpdated(req);
    res.status(201).json({ id, name, color, tasks: [] });
  } catch (err) {
    logger.error('Person create error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tasks/people/:personId — remove a person and all their chores
// ---------------------------------------------------------------------------
router.delete('/people/:personId', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const { personId } = req.params;
    const existing = db.prepare('SELECT id FROM chore_people WHERE id = ?').get(personId);
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    db.transaction(() => {
      db.prepare('DELETE FROM chore_tasks WHERE person_id = ?').run(personId);
      db.prepare('DELETE FROM chore_people WHERE id = ?').run(personId);
    })();

    logger.info('Person deleted: %s', personId);
    emitTasksUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Person delete error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tasks/people/:personId/avatar — save a photo (base64 data URL)
// ---------------------------------------------------------------------------
router.put('/people/:personId/avatar', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const existing = db.prepare('SELECT id FROM chore_people WHERE id = ?').get(req.params.personId);
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    const avatar = String(req.body?.avatar || '');
    if (!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(avatar)) {
      return res.status(400).json({ error: 'avatar must be an image data URL' });
    }
    if (avatar.length > 1_500_000) {
      return res.status(413).json({ error: 'avatar too large' });
    }

    ensureAvatarColumn(db);
    db.prepare('UPDATE chore_people SET avatar = ? WHERE id = ?').run(avatar, req.params.personId);
    logger.info('Avatar saved for %s (%d bytes)', req.params.personId, avatar.length);
    emitTasksUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Avatar save error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/people/:personId/avatar — remove the photo
router.delete('/people/:personId/avatar', (req, res) => {
  const db = req.app.locals.db;
  const logger = req.app.locals.logger;

  try {
    const existing = db.prepare('SELECT id FROM chore_people WHERE id = ?').get(req.params.personId);
    if (!existing) return res.status(404).json({ error: 'Person not found' });

    ensureAvatarColumn(db);
    db.prepare('UPDATE chore_people SET avatar = NULL WHERE id = ?').run(req.params.personId);
    emitTasksUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Avatar delete error: %s', err.message);
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

    emitTasksUpdated(req);
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

    emitTasksUpdated(req);
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

    emitTasksUpdated(req);
    res.json({ ok: true });
  } catch (err) {
    logger.error('Chores delete error: %s', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
