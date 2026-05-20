ALTER TABLE IF EXISTS reminder.reminders
  ADD COLUMN IF NOT EXISTS event_at timestamptz,
  ADD COLUMN IF NOT EXISTS remind_before_minutes integer,
  ADD COLUMN IF NOT EXISTS before_bull_job_id varchar(128),
  ADD COLUMN IF NOT EXISTS before_sent_at timestamptz;

UPDATE reminder.reminders
SET event_at = remind_at
WHERE event_at IS NULL;

CREATE INDEX IF NOT EXISTS "IDX_reminders_event_at"
  ON reminder.reminders (event_at);
