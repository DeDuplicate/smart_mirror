-- Migration 005: Checklist sub-items inside kanban tasks
CREATE TABLE IF NOT EXISTS kanban_subtasks (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES kanban_tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_kanban_subtasks_task ON kanban_subtasks(task_id);
