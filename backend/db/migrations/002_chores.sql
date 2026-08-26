-- Migration 002: Chores (person-based tasks)
CREATE TABLE IF NOT EXISTS chore_people (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT DEFAULT '#6b62e0',
  position INTEGER DEFAULT 0
);

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
);

CREATE INDEX IF NOT EXISTS idx_chore_tasks_person ON chore_tasks(person_id);
