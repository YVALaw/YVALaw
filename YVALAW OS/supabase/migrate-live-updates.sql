-- ============================================================================
-- Live updates (2026-11): one small "last changed" number per table, pushed to open windows by Supabase Realtime.
-- The app keeps data in memory and re-reads a table only when its number moves — no timed background refresh.
-- Safe to run more than once. Run after the step scripts and the other redesign scripts.
--
--   public.data_versions(table_name, version, changed_at) — one row per watched table.
--   private.bump_data_version() — STATEMENT-level trigger: one tiny upsert per insert/update/delete/truncate statement
--     (not per row), so a 500-row import bumps once.
--   Readable by every signed-in user (only table names and counters — no data). Nobody writes it directly.
--   Added to the supabase_realtime publication so windows get the change pushed (Database → Publications shows it),
--   together with notifications (the bell gets new ones pushed instead of asking every minute).
-- Not watched on purpose (they change every minute or are never kept in memory): tracker_blocks, tracker_screenshots,
-- desktop_devices, notifications, audit_log, push_subscriptions, app_secrets, desktop_link_codes, counters.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_versions (
  table_name text PRIMARY KEY,
  version    bigint NOT NULL DEFAULT 0,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.data_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "data_versions_read" ON public.data_versions;
CREATE POLICY "data_versions_read" ON public.data_versions FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.data_versions FROM authenticated, anon;
GRANT SELECT ON public.data_versions TO authenticated;

CREATE OR REPLACE FUNCTION private.bump_data_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.data_versions AS d (table_name, version, changed_at)
  VALUES (TG_TABLE_NAME, 1, now())
  ON CONFLICT (table_name) DO UPDATE SET version = d.version + 1, changed_at = now();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.bump_data_version() FROM PUBLIC;

DO $$
DECLARE
  t text;
  watched text[] := ARRAY[
    'employees', 'clients', 'projects', 'invoices', 'candidates', 'estimates', 'expenses', 'tasks', 'activity_log',
    'invoice_templates', 'recurring_invoices', 'time_entries', 'tags', 'settings', 'user_roles', 'role_permissions',
    'client_users', 'contacts', 'leads', 'lead_activities', 'staff_requests', 'client_documents', 'contracts',
    'placement_rates', 'week_closes', 'time_adjustments', 'client_payments', 'payroll_runs', 'payroll_lines',
    'payroll_adjustments', 'employee_payout_methods', 'time_off_requests', 'manual_time_requests', 'announcements',
    'holidays', 'employee_documents', 'tracker_consents', 'working_hour_prefs', 'payment_attempts'
  ];
BEGIN
  FOREACH t IN ARRAY watched LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS bump_data_version ON public.%I', t);
      EXECUTE format('CREATE TRIGGER bump_data_version AFTER INSERT OR UPDATE OR DELETE ON public.%I
                      FOR EACH STATEMENT EXECUTE FUNCTION private.bump_data_version()', t);
      EXECUTE format('DROP TRIGGER IF EXISTS bump_data_version_truncate ON public.%I', t);
      EXECUTE format('CREATE TRIGGER bump_data_version_truncate AFTER TRUNCATE ON public.%I
                      FOR EACH STATEMENT EXECUTE FUNCTION private.bump_data_version()', t);
      -- a row for every watched table, so the app knows which tables it can keep until they change
      INSERT INTO public.data_versions (table_name) VALUES (t) ON CONFLICT (table_name) DO NOTHING;
    END IF;
  END LOOP;

  -- Push changes to open windows (Supabase Realtime): the change numbers, and new notifications (each person only
  -- receives their own — Realtime applies the notifications read rule), so the bell no longer asks every minute.
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['data_versions', 'notifications'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
