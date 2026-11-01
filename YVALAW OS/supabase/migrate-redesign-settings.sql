-- Settings redesign (2026-11): Company → Website, Invoice footer, Change logo; Integrations → Crisp chat.
-- Idempotent — safe to run more than once. Run after the step scripts and the other redesign scripts.
--
-- New settings columns are nullable (older app versions save the settings row without them; NULL = default:
-- the built-in /yva-logo.png, no website line, no footer text, Crisp off).
-- The client portal can't read `settings` (staff only), so it gets the Crisp website ID — and nothing else —
-- from public.portal_chat_config().

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS company_website   text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS invoice_footer    text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS company_logo_url  text;  -- public URL in the `attachments` bucket
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS company_logo_path text;  -- storage path (company/…), to delete the old file
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS crisp_website_id  text;

-- The Crisp website ID is a UUID; it ends up in the client portal's page, so nothing else may be stored there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settings_crisp_website_id_check' AND conrelid = 'public.settings'::regclass
  ) THEN
    ALTER TABLE public.settings
      ADD CONSTRAINT settings_crisp_website_id_check
      CHECK (crisp_website_id IS NULL OR crisp_website_id ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$');
  END IF;
END $$;

-- Live chat settings for the client portal: portal clients and staff only.
CREATE OR REPLACE FUNCTION public.portal_chat_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
BEGIN
  IF NOT (private.is_portal_client() OR private.is_internal()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT nullif(btrim(s.crisp_website_id), '') INTO v_id FROM public.settings s WHERE s.id = 1;
  RETURN jsonb_build_object('crisp_website_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_chat_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_chat_config() TO authenticated;

NOTIFY pgrst, 'reload schema';
