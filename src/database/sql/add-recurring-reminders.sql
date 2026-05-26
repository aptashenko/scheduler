DO $$
BEGIN
  CREATE TYPE reminder.reminder_series_frequency_enum AS ENUM ('weekly', 'monthly');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE reminder.reminder_series_status_enum AS ENUM ('active', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS reminder.reminder_series (
  id serial PRIMARY KEY,
  user_id bigint NOT NULL,
  telegram_chat_ids text[] NOT NULL,
  text text NOT NULL,
  frequency reminder.reminder_series_frequency_enum NOT NULL,
  weekday integer,
  day_of_month integer,
  hour integer NOT NULL,
  minute integer NOT NULL,
  timezone varchar(128) NOT NULL,
  remind_before_minutes integer NOT NULL,
  status reminder.reminder_series_status_enum NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "CHK_reminder_series_weekday" CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  CONSTRAINT "CHK_reminder_series_day_of_month" CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
  CONSTRAINT "CHK_reminder_series_hour" CHECK (hour BETWEEN 0 AND 23),
  CONSTRAINT "CHK_reminder_series_minute" CHECK (minute BETWEEN 0 AND 59)
);

CREATE INDEX IF NOT EXISTS "IDX_reminder_series_user_id"
  ON reminder.reminder_series (user_id);

CREATE INDEX IF NOT EXISTS "IDX_reminder_series_status"
  ON reminder.reminder_series (status);

ALTER TABLE IF EXISTS reminder.reminders
  ADD COLUMN IF NOT EXISTS series_id integer;

CREATE INDEX IF NOT EXISTS "IDX_reminders_series_id"
  ON reminder.reminders (series_id);
