-- ============================================================
-- YVA OS — Step 1: Foundation (PLAN.md)
-- ============================================================
-- Run in the Supabase SQL Editor after the YVA Time phase 0–3 scripts.
-- Safe to run more than once. The last query prints a check list.
--
--   1. Permissions: role_permissions + private.has_permission(text).
--      The CEO always has every permission; other roles get only what the CEO
--      ticks in Settings → Team Access → Permissions (nothing by default).
--   2. Change history: audit_log, filled by triggers (who, what, when, old → new).
--   3. Draft invoices are never visible to portal clients (re-asserted).
--   4. Notifications: the bell (notifications), per-person choices
--      (notification_prefs), phone/computer push (push_subscriptions) and a
--      server-only key store (app_secrets) for the push keys.
--   5. Settings: which connected Gmail account sends automatic emails.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;
-- server functions (service role) write tables whose triggers live in this schema
GRANT USAGE ON SCHEMA private TO service_role;

-- ── 1. Permissions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role        text NOT NULL,
  permission  text NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid DEFAULT auth.uid(),
  PRIMARY KEY (role, permission),
  CONSTRAINT role_permissions_role CHECK (role IN ('admin', 'accounting', 'recruiter', 'lead_gen')),
  CONSTRAINT role_permissions_name CHECK (permission ~ '^[a-z_]+\.[a-z_]+$')
);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- The CEO has everything; other staff roles have what the CEO granted.
CREATE OR REPLACE FUNCTION private.has_permission(p text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN private.current_user_role() = 'ceo' THEN true
    ELSE EXISTS (SELECT 1 FROM public.role_permissions rp
                 WHERE rp.role = private.current_user_role() AND rp.permission = p)
  END
$$;
GRANT EXECUTE ON FUNCTION private.has_permission(text) TO authenticated;

-- Everyone (staff) holding a permission — used to address notifications
CREATE OR REPLACE FUNCTION private.users_with_permission(p text)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT ur.user_id::uuid FROM public.user_roles ur
  WHERE ur.role = 'ceo'
     OR ur.role IN (SELECT rp.role FROM public.role_permissions rp WHERE rp.permission = p)
$$;
REVOKE ALL ON FUNCTION private.users_with_permission(text) FROM PUBLIC, authenticated;

DROP POLICY IF EXISTS "role_permissions_staff_read" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions_ceo_write"  ON public.role_permissions;
CREATE POLICY "role_permissions_staff_read" ON public.role_permissions
  FOR SELECT TO authenticated USING (private.is_internal());
CREATE POLICY "role_permissions_ceo_write" ON public.role_permissions
  FOR ALL TO authenticated
  USING (private.current_user_role() = 'ceo')
  WITH CHECK (private.current_user_role() = 'ceo');

-- ── 2. Change history ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,                         -- NULL = the system (scheduled jobs, webhooks)
  actor_email text,
  table_name  text NOT NULL,
  record_id   text,
  action      text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb   -- update: {column: [old, new]}; insert/delete: the row
);
CREATE INDEX IF NOT EXISTS audit_log_record ON public.audit_log (table_name, record_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_at     ON public.audit_log (at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_read" ON public.audit_log;
CREATE POLICY "audit_log_read" ON public.audit_log
  FOR SELECT TO authenticated USING (
    private.has_permission('history.view')
    -- history of rates, payroll, bank details and leads also needs the permission that shows them
    AND CASE table_name
      WHEN 'placement_rates'         THEN private.has_permission('rates.manage')
      WHEN 'payroll_runs'            THEN private.has_permission('payroll.view')
      WHEN 'payroll_lines'           THEN private.has_permission('payroll.view')
      WHEN 'payroll_adjustments'     THEN private.has_permission('payroll.view')
      WHEN 'employee_payout_methods' THEN private.has_permission('bank.view')
      WHEN 'leads'                   THEN private.has_permission('leads.view_all')
      ELSE true END);
-- No insert/update/delete policies: rows are written only by the trigger below and never changed.
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;

-- Trigger arguments = columns whose values must never be copied into the history (shown as •••).
-- Very large values (base64 photos, long attachment lists) are summarised.
CREATE OR REPLACE FUNCTION private.audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_j  jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'created_at' - 'updated_at' END;
  new_j  jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'created_at' - 'updated_at' END;
  diff   jsonb := '{}'::jsonb;
  k      text;
  v      jsonb;
  secret text[] := TG_ARGV;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(new_j) LOOP
      IF (old_j -> k) IS DISTINCT FROM (new_j -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_array(old_j -> k, new_j -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;
  ELSE
    diff := coalesce(new_j, old_j);
  END IF;

  FOR k IN SELECT jsonb_object_keys(diff) LOOP
    v := diff -> k;
    IF k = ANY (secret) THEN
      diff := jsonb_set(diff, ARRAY[k], CASE WHEN TG_OP = 'UPDATE' THEN '["•••","•••"]'::jsonb ELSE '"•••"'::jsonb END);
    ELSIF length(v::text) > 20000 THEN
      diff := jsonb_set(diff, ARRAY[k], to_jsonb('(large value, ' || length(v::text) || ' characters)'));
    END IF;
  END LOOP;

  INSERT INTO public.audit_log (actor_id, actor_email, table_name, record_id, action, changes)
  VALUES (auth.uid(), nullif(auth.jwt() ->> 'email', ''), TG_TABLE_NAME,
          coalesce(new_j ->> 'id', old_j ->> 'id', new_j ->> 'key', old_j ->> 'key'),
          lower(TG_OP), diff);
  RETURN NULL;
END
$$;

-- Attach to every table that exists (later steps attach their own tables the same way)
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('invoices',         ARRAY[]::text[]),
      ('clients',          ARRAY[]::text[]),
      ('projects',         ARRAY[]::text[]),
      ('employees',        ARRAY[]::text[]),
      ('expenses',         ARRAY[]::text[]),
      ('candidates',       ARRAY[]::text[]),
      ('time_entries',     ARRAY[]::text[]),
      ('user_roles',       ARRAY[]::text[]),
      ('role_permissions', ARRAY[]::text[]),
      ('client_users',     ARRAY[]::text[]),
      ('settings',         ARRAY['gmail_access_token', 'gmail_refresh_token', 'gmail_client_secret'])
    ) AS x(name, secrets)
  LOOP
    IF to_regclass('public.' || t.name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t.name);
      EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I
                      FOR EACH ROW EXECUTE FUNCTION private.audit_row(%s)',
                     t.name, coalesce((SELECT string_agg(quote_literal(s), ', ') FROM unnest(t.secrets) s), ''));
    END IF;
  END LOOP;
END $$;

-- ── 3. Draft invoices never reach the client portal ─────────────────────────

DO $$
BEGIN
  IF to_regclass('public.client_users') IS NOT NULL AND to_regclass('public.invoices') IS NOT NULL
     -- only replace an existing policy: once migrate-portal-invoices-lockdown.sql removed it, re-running this keeps it removed
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invoices' AND policyname = 'portal_client_invoices') THEN
    DROP POLICY IF EXISTS "portal_client_invoices" ON public.invoices;
    CREATE POLICY "portal_client_invoices" ON public.invoices
      FOR SELECT TO authenticated
      USING (
        private.is_portal_client()
        AND client_name = (SELECT name FROM public.clients WHERE id = private.portal_client_id() LIMIT 1)
        AND coalesce(status, 'draft') <> 'draft'
      );
  END IF;
END $$;

-- ── 4. Notifications ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  kind                text NOT NULL,        -- e.g. week_ready, time_off_request, payroll_due (see src/lib/notifications.ts)
  title               text NOT NULL,
  body                text,
  link                text,                 -- path inside YVA OS, e.g. /weekly-close
  created_at          timestamptz NOT NULL DEFAULT now(),
  read_at             timestamptz,
  dispatch_claimed_at timestamptz,          -- the email/push sender picked it up
  emailed_at          timestamptz,
  pushed_at           timestamptz,
  CONSTRAINT notifications_title_len CHECK (length(title) <= 200),
  CONSTRAINT notifications_body_len  CHECK (body IS NULL OR length(body) <= 2000),
  CONSTRAINT notifications_link      CHECK (link IS NULL OR link ~ '^/')
);
CREATE INDEX IF NOT EXISTS notifications_user    ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_pending ON public.notifications (created_at) WHERE dispatch_claimed_at IS NULL;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_own_read"   ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
CREATE POLICY "notifications_own_read"   ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_own_update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications_own_delete" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());
-- People can only mark their notifications read; everything else is written by the server.
REVOKE INSERT, UPDATE ON public.notifications FROM authenticated, anon;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- Create a notification (database triggers and SECURITY DEFINER functions use these)
CREATE OR REPLACE FUNCTION private.notify_user(p_user uuid, p_kind text, p_title text, p_body text DEFAULT NULL, p_link text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT p_user, p_kind, left(p_title, 200), left(p_body, 2000), p_link WHERE p_user IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION private.notify_permission(p_permission text, p_kind text, p_title text, p_body text DEFAULT NULL, p_link text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT DISTINCT u, p_kind, left(p_title, 200), left(p_body, 2000), p_link FROM private.users_with_permission(p_permission) u
$$;
REVOKE ALL ON FUNCTION private.notify_user(uuid, text, text, text, text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION private.notify_permission(text, text, text, text, text) FROM PUBLIC, authenticated;

-- Per person, per kind: email and/or phone push (no row = both on). The bell always shows everything.
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id    uuid NOT NULL DEFAULT auth.uid(),
  kind       text NOT NULL,                 -- a notification kind, or '*' for "send my emails to"
  email      boolean NOT NULL DEFAULT true,
  push       boolean NOT NULL DEFAULT true,
  email_to   text,                          -- on the '*' row: send my notification emails here instead of my login email
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind),
  CONSTRAINT notification_prefs_email_to CHECK (email_to IS NULL OR email_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_prefs_own" ON public.notification_prefs;
CREATE POLICY "notification_prefs_own" ON public.notification_prefs
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Browsers/phones that allowed notifications (Web Push)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid(),
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  failures    integer NOT NULL DEFAULT 0,
  CONSTRAINT push_subscriptions_endpoint CHECK (endpoint ~ '^https://')
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subscriptions_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Server-only secrets (the Web Push keys are created here automatically on first use).
-- RLS on and no policies: only the service role (Netlify functions) can read or write.
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_secrets FROM authenticated, anon;

-- ── 5. Settings: sender of automatic emails ─────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.settings') IS NOT NULL THEN
    ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS notify_sender_user_id uuid;   -- whose connected Gmail sends automatic emails
    ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS business_timezone text DEFAULT 'America/Santo_Domingo';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Check ───────────────────────────────────────────────────────────────────
SELECT 'table' AS item, c.relname AS detail, CASE WHEN c.relrowsecurity THEN 'RLS on' ELSE 'RLS OFF' END AS status
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('role_permissions', 'audit_log', 'notifications', 'notification_prefs', 'push_subscriptions', 'app_secrets')
UNION ALL
SELECT 'history trigger', event_object_table, 'on' FROM information_schema.triggers
WHERE trigger_name = 'audit_row' AND event_manipulation = 'UPDATE'
UNION ALL
SELECT 'portal drafts hidden', policyname, CASE WHEN qual LIKE '%draft%' THEN 'yes' ELSE 'NO' END
FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'portal_client_invoices'
ORDER BY 1, 2;
