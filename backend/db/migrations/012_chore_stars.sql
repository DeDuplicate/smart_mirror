-- Migration 012: weekly stars for chores
--
-- One row per child per day on which they finished every chore. The star lives
-- here, not on the chore rows, so it survives the nightly reset un-ticking
-- everything. 'removed' is a parent taking the star back from Settings: the row
-- stays so that day cannot be earned a second time just because the chores are
-- still all ticked.
CREATE TABLE IF NOT EXISTS chore_stars (
  person_id  TEXT NOT NULL REFERENCES chore_people(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'removed')),
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (person_id, day)
);
