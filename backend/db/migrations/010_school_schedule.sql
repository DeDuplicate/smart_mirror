CREATE TABLE IF NOT EXISTS school_schedule (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES chore_people(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  subject     TEXT NOT NULL,
  position    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_school_schedule_person_day ON school_schedule(person_id, day_of_week);

CREATE TABLE IF NOT EXISTS school_subject_items (
  id       TEXT PRIMARY KEY,
  subject  TEXT NOT NULL,
  item     TEXT NOT NULL,
  position INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_school_subject_items_subject ON school_subject_items(subject);

-- Only checked rows exist. Dates are local YYYY-MM-DD; absence means unchecked.
CREATE TABLE IF NOT EXISTS school_checklist_checked (
  person_id TEXT NOT NULL REFERENCES chore_people(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  item_key  TEXT NOT NULL,
  PRIMARY KEY (person_id, date, item_key)
);
