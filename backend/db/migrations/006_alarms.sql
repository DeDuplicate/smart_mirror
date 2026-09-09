-- Migration 006: Alarm clock — fires a chosen song/playlist on chosen speakers
CREATE TABLE IF NOT EXISTS alarms (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL DEFAULT '',
  time         TEXT NOT NULL,              -- 'HH:MM' 24h, Pi local time
  days         TEXT NOT NULL DEFAULT '[]', -- JSON array of 0-6 (0=Sunday); empty = every day
  enabled      INTEGER NOT NULL DEFAULT 1,
  speakers     TEXT NOT NULL DEFAULT '[]', -- JSON array of media_player entity ids; 'local' = the mirror itself
  media_type   TEXT NOT NULL DEFAULT 'track', -- 'track' | 'playlist'
  media_id     TEXT NOT NULL,
  media_title  TEXT NOT NULL DEFAULT '',
  media_artist TEXT NOT NULL DEFAULT '',
  media_image  TEXT NOT NULL DEFAULT '',
  volume       INTEGER,                    -- 0-100, NULL = leave each device as-is
  last_fired   TEXT,                       -- ISO minute stamp; prevents double-fire within the minute
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
