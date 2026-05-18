CREATE SCHEMA IF NOT EXISTS reminder;
CREATE SCHEMA IF NOT EXISTS speaking_clubs;

ALTER TABLE IF EXISTS public.reminder_users SET SCHEMA reminder;
ALTER TABLE IF EXISTS public.reminders SET SCHEMA reminder;

ALTER TABLE IF EXISTS public.speaking_club_users SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_club_teacher_profiles SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_club_student_profiles SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_clubs SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_club_sessions SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_club_session_bookings SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_club_payments SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_club_session_attendance SET SCHEMA speaking_clubs;
ALTER TABLE IF EXISTS public.speaking_club_reviews SET SCHEMA speaking_clubs;
