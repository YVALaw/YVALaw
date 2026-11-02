-- ============================================================================
-- Email from Outlook (2026-11): YVA OS sends every email from one company Microsoft 365 mailbox through the
-- send-email Netlify function (Microsoft Graph). Gmail is gone. Safe to run more than once.
--
--   public.email_log — one row per email YVA OS tried to send: who sent it, to whom (To + Cc), subject,
--     attachment names and sizes, sent / failed and Microsoft's reason. Written only by the server (service
--     role); CEO and Admin can read it. Also the source of the per-person limits (100 an hour, 500 a day).
--   Old Gmail secrets removed: the Google tokens that were stored in the settings row and in each person's
--     login (user metadata) are blanked. Columns are kept (older app versions still name them).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by       uuid,
  sent_by_email text,
  from_address  text,
  to_addresses  text[] NOT NULL DEFAULT '{}',
  cc_addresses  text[] NOT NULL DEFAULT '{}',
  subject       text,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL CHECK (status IN ('sent', 'failed')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_sender_time ON public.email_log (sent_by, created_at DESC);
CREATE INDEX IF NOT EXISTS email_log_time ON public.email_log (created_at DESC);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_log_read" ON public.email_log;
CREATE POLICY "email_log_read" ON public.email_log FOR SELECT TO authenticated
  USING (private.current_user_role() IN ('ceo', 'admin'));
-- Nobody writes it from the browser (no insert/update/delete policy, and no grants for those)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.email_log FROM authenticated, anon;
GRANT SELECT ON public.email_log TO authenticated;
GRANT ALL ON public.email_log TO service_role;

-- ── Remove the old Gmail secrets ────────────────────────────────────────────
DO $$
DECLARE
  cols text[];
  sets text;
BEGIN
  IF to_regclass('public.settings') IS NOT NULL THEN
    SELECT array_agg(format('%I = NULL', column_name)) INTO cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings'
      AND column_name IN ('gmail_access_token', 'gmail_refresh_token', 'gmail_token_expiry', 'gmail_client_secret');
    IF cols IS NOT NULL THEN
      sets := array_to_string(cols, ', ');
      EXECUTE format('UPDATE public.settings SET %s', sets);
    END IF;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data - 'gmailAccessToken' - 'gmailRefreshToken' - 'gmailTokenExpiry' - 'gmailEmail'
    WHERE raw_user_meta_data ?| ARRAY['gmailAccessToken', 'gmailRefreshToken', 'gmailTokenExpiry', 'gmailEmail'];
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
