-- Migration 011: Security cameras. Streams are served by the go2rtc sidecar
-- (routes/go2rtc.js); this table is the source of truth it is synced from.
CREATE TABLE IF NOT EXISTS cameras (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,              -- rtsp|hikvision|dahua|dvrip|onvif|frigate|http
  host           TEXT NOT NULL DEFAULT '',
  port           INTEGER,                    -- NULL = the kind's default (554 / 34567 / 80)
  username       TEXT NOT NULL DEFAULT '',
  password       TEXT NOT NULL DEFAULT '',   -- never returned by the API
  channel        INTEGER NOT NULL DEFAULT 1, -- 1-based, as printed on the NVR
  source         TEXT NOT NULL DEFAULT '',   -- full URL, kinds rtsp/http only
  http_port      INTEGER,                    -- native JPEG snapshots; NULL = 80
  frigate_camera TEXT NOT NULL DEFAULT '',   -- Frigate camera name (stream for kind frigate, event mapping for any kind)
  motion_entity  TEXT NOT NULL DEFAULT '',   -- HA binary_sensor that raises motion events
  enabled        INTEGER NOT NULL DEFAULT 1,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
