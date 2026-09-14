-- Migration 009: Escalating snooze — how many times the ringing alarm has been
-- snoozed. Each press buys one more multiple of the configured base, so the
-- count has to survive a backend restart for the same reason snooze_until does:
-- an in-memory counter would silently restart the ladder at 1.
-- Reset when the alarm next fires on its own clock time, not on a snooze re-fire.
ALTER TABLE alarms ADD COLUMN snooze_count INTEGER NOT NULL DEFAULT 0;
