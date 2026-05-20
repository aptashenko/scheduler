CREATE TABLE IF NOT EXISTS speaking_clubs.speaking_club_session_reminders (
  id serial PRIMARY KEY,
  "sessionId" int NOT NULL REFERENCES speaking_clubs.speaking_club_sessions(id) ON DELETE CASCADE,
  "recipientTelegramId" bigint NOT NULL,
  type varchar(80) NOT NULL,
  "sentAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_speaking_club_session_reminders_once"
    UNIQUE ("sessionId", "recipientTelegramId", type)
);

CREATE INDEX IF NOT EXISTS "IDX_speaking_club_session_reminders_session"
  ON speaking_clubs.speaking_club_session_reminders ("sessionId");

CREATE INDEX IF NOT EXISTS "IDX_speaking_club_session_reminders_recipient"
  ON speaking_clubs.speaking_club_session_reminders ("recipientTelegramId");

CREATE INDEX IF NOT EXISTS "IDX_speaking_club_session_reminders_type"
  ON speaking_clubs.speaking_club_session_reminders (type);
