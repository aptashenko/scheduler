DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'speaking_clubs'
      AND t.typname = 'speaking_club_users_role_enum'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'speaking_clubs'
        AND t.typname = 'speaking_club_users_role_enum'
        AND e.enumlabel = 'STUDENT'
    ) THEN
      ALTER TYPE speaking_clubs.speaking_club_users_role_enum ADD VALUE 'STUDENT';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'speaking_clubs'
        AND t.typname = 'speaking_club_users_role_enum'
        AND e.enumlabel = 'TEACHER'
    ) THEN
      ALTER TYPE speaking_clubs.speaking_club_users_role_enum ADD VALUE 'TEACHER';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'speaking_clubs'
        AND t.typname = 'speaking_club_users_role_enum'
        AND e.enumlabel = 'ADMIN'
    ) THEN
      ALTER TYPE speaking_clubs.speaking_club_users_role_enum ADD VALUE 'ADMIN';
    END IF;
  END IF;
END $$;

ALTER TABLE IF EXISTS speaking_clubs.speaking_club_users
  ALTER COLUMN role DROP DEFAULT;

UPDATE speaking_clubs.speaking_club_users
SET role = 'STUDENT'
WHERE role::text = 'USER';

ALTER TABLE IF EXISTS speaking_clubs.speaking_club_users
  ALTER COLUMN role SET DEFAULT 'STUDENT';

-- Promote teachers manually when needed, for example:
-- UPDATE speaking_clubs.speaking_club_users
-- SET role = 'TEACHER'
-- WHERE "telegramId" = '123456789';
--
-- Promote admins manually when needed. Admins can use both student and teacher
-- bot modes:
-- UPDATE speaking_clubs.speaking_club_users
-- SET role = 'ADMIN'
-- WHERE "telegramId" = '123456789';
