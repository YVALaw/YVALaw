-- Weekly reminder email (2026-11): Settings → Notifications → "Weekly reminder email".
-- Six nullable columns on the one settings row (older app versions save the row without them; NULL = the default):
--   weekly_reminder_enabled     on/off                         (NULL = off)
--   weekly_reminder_day         0 = Sunday … 6 = Saturday      (NULL = Monday)
--   weekly_reminder_hour        0–23, business time zone       (NULL = 8 am; settings.business_timezone, default America/Santo_Domingo)
--   weekly_reminder_recipients  email addresses                (NULL/empty = every CEO login's email)
--   weekly_reminder_include     sections: drafts, unpaid, weekly_close (NULL = all three)
--   weekly_reminder_last_sent   written by the weekly-reminder scheduled function (once per Monday–Sunday week)
-- RLS: unchanged — the settings policies apply (staff read; CEO/Admin write). Changes show in the change history.
-- Idempotent — safe to run more than once.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_reminder_enabled    boolean;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_reminder_day        smallint;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_reminder_hour       smallint;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_reminder_recipients text[];
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_reminder_include    text[];
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS weekly_reminder_last_sent  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_weekly_reminder_day_check' AND conrelid = 'public.settings'::regclass) THEN
    ALTER TABLE public.settings ADD CONSTRAINT settings_weekly_reminder_day_check
      CHECK (weekly_reminder_day IS NULL OR weekly_reminder_day BETWEEN 0 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_weekly_reminder_hour_check' AND conrelid = 'public.settings'::regclass) THEN
    ALTER TABLE public.settings ADD CONSTRAINT settings_weekly_reminder_hour_check
      CHECK (weekly_reminder_hour IS NULL OR weekly_reminder_hour BETWEEN 0 AND 23);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_weekly_reminder_recipients_check' AND conrelid = 'public.settings'::regclass) THEN
    ALTER TABLE public.settings ADD CONSTRAINT settings_weekly_reminder_recipients_check
      CHECK (weekly_reminder_recipients IS NULL OR cardinality(weekly_reminder_recipients) <= 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_weekly_reminder_include_check' AND conrelid = 'public.settings'::regclass) THEN
    ALTER TABLE public.settings ADD CONSTRAINT settings_weekly_reminder_include_check
      CHECK (weekly_reminder_include IS NULL OR weekly_reminder_include <@ ARRAY['drafts', 'unpaid', 'weekly_close']::text[]);
  END IF;
END $$;

COMMENT ON COLUMN public.settings.weekly_reminder_last_sent IS 'When the weekly reminder email last went out (weekly-reminder scheduled function)';

NOTIFY pgrst, 'reload schema';
