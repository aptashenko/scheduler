ALTER TABLE IF EXISTS speaking_clubs.speaking_clubs
  ADD COLUMN IF NOT EXISTS levels speaking_clubs.speaking_clubs_level_enum[];

UPDATE speaking_clubs.speaking_clubs
SET levels = ARRAY[level]::speaking_clubs.speaking_clubs_level_enum[]
WHERE levels IS NULL
  AND level IS NOT NULL;

ALTER TABLE IF EXISTS speaking_clubs.speaking_clubs
  ALTER COLUMN levels SET NOT NULL;

CREATE INDEX IF NOT EXISTS "IDX_speaking_clubs_levels"
  ON speaking_clubs.speaking_clubs USING GIN (levels);

-- Keep the legacy level column for now. TypeORM synchronize may try to drop the
-- shared enum type while levels[] still depends on it if the column disappears.
