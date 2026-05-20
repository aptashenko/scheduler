ALTER TABLE IF EXISTS reminder.reminder_users
  ADD COLUMN IF NOT EXISTS first_name varchar(120),
  ADD COLUMN IF NOT EXISTS last_name varchar(120);

CREATE TABLE IF NOT EXISTS reminder.reminder_user_group_members (
  id serial PRIMARY KEY,
  owner_telegram_id bigint NOT NULL,
  member_telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_reminder_user_group_members_owner_member"
    UNIQUE (owner_telegram_id, member_telegram_id)
);

CREATE INDEX IF NOT EXISTS "IDX_reminder_user_group_members_owner"
  ON reminder.reminder_user_group_members (owner_telegram_id);

CREATE INDEX IF NOT EXISTS "IDX_reminder_user_group_members_member"
  ON reminder.reminder_user_group_members (member_telegram_id);
