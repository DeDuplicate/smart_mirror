-- Migration 001: Initial schema
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS tokens (
  provider TEXT,
  email    TEXT,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    INTEGER,
  PRIMARY KEY (provider, email)
);

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  data       TEXT,
  fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER);

CREATE TABLE IF NOT EXISTS task_columns (
  task_id     TEXT PRIMARY KEY,
  column_name TEXT,
  position    INTEGER
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
