-- Migration 003: Local kanban tasks (replaces the Google Tasks integration)
CREATE TABLE IF NOT EXISTS kanban_tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'inProgress', 'done')),
  priority    TEXT NOT NULL DEFAULT 'none' CHECK (priority IN ('none', 'low', 'medium', 'high')),
  starred     INTEGER NOT NULL DEFAULT 0,
  due_date    TEXT,
  list_name   TEXT,
  list_color  TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status ON kanban_tasks(status);
