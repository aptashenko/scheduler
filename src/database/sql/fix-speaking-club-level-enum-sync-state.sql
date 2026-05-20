DO $$
BEGIN
  CREATE TYPE speaking_clubs.speaking_clubs_level_enum AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE IF EXISTS speaking_clubs.speaking_clubs
  ALTER COLUMN level TYPE speaking_clubs.speaking_clubs_level_enum
  USING level::text::speaking_clubs.speaking_clubs_level_enum;

ALTER TABLE IF EXISTS speaking_clubs.speaking_clubs
  ALTER COLUMN levels TYPE speaking_clubs.speaking_clubs_level_enum[]
  USING levels::text[]::speaking_clubs.speaking_clubs_level_enum[];

DROP TYPE IF EXISTS speaking_clubs.speaking_clubs_level_enum_old;
