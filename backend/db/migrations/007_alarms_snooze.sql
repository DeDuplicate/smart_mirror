-- Migration 007: Alarm snooze — epoch ms until which a dismissed alarm re-fires
ALTER TABLE alarms ADD COLUMN snooze_until INTEGER;
