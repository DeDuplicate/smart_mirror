-- Migration 004: Local editable calendar events (ICS feeds stay read-only)
CREATE TABLE IF NOT EXISTS calendar_events (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  location    TEXT DEFAULT '',
  start       TEXT NOT NULL,
  end         TEXT NOT NULL,
  all_day     INTEGER NOT NULL DEFAULT 0,
  color       TEXT NOT NULL DEFAULT 'mint',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start);
CREATE INDEX IF NOT EXISTS idx_calendar_events_end ON calendar_events(end);
