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

module.exports = router;
