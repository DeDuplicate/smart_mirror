-- Migration 008: repair chore ordering.
-- syncPeople used to rewrite chore_people.position on every poll from the
-- caller's localStorage array index, which collided with people added straight
-- to the DB (0,0,1,1,2 in the wild) and made the columns reshuffle. The upsert
-- no longer touches position, so renumber the existing rows once, keeping the
-- order the UI currently shows.
--
-- Both statements rank inside a CTE rather than with a correlated COUNT(*):
-- a correlated subquery over the table being written reads rows this same
-- UPDATE has already changed, which leaves fresh collisions behind.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY position, rowid) - 1 AS rn
  FROM chore_people
)
UPDATE chore_people
SET position = (SELECT rn FROM ranked WHERE ranked.id = chore_people.id);

-- chore_tasks.position was never set on insert, so every chore sat at 0 and
-- ties fell back to a second-resolution created_at. Renumber per person.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY position, created_at, rowid) - 1 AS rn
  FROM chore_tasks
)
UPDATE chore_tasks
SET position = (SELECT rn FROM ranked WHERE ranked.id = chore_tasks.id);
