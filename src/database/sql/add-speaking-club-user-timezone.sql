ALTER TABLE IF EXISTS speaking_clubs.speaking_club_users
  ADD COLUMN IF NOT EXISTS timezone varchar(80);

UPDATE speaking_clubs.speaking_club_users users
SET timezone = teacher_profiles.timezone
FROM speaking_clubs.speaking_club_teacher_profiles teacher_profiles
WHERE teacher_profiles."userId" = users.id
  AND users.timezone IS NULL
  AND teacher_profiles.timezone IS NOT NULL;

UPDATE speaking_clubs.speaking_club_users users
SET timezone = student_profiles.timezone
FROM speaking_clubs.speaking_club_student_profiles student_profiles
WHERE student_profiles."userId" = users.id
  AND users.timezone IS NULL
  AND student_profiles.timezone IS NOT NULL;
