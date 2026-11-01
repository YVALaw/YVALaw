-- ============================================================================
-- START FRESH — DELETES ALL BUSINESS DATA. Run only on purpose (2026-11: the owner's test data before
-- importing the old CRM). Settings → Data → Export JSON first if anything might be worth keeping.
--
-- Keeps:   settings (company info, Gmail sender, Crisp, logo…), role_permissions, app_secrets (push keys),
--          every login with the CEO role (+ their notification preferences and phone push subscriptions).
-- Deletes: employees, clients, projects, invoices, candidates, estimates, expenses, tasks, time entries,
--          YVA Time (tracked blocks, screenshots rows, computers, consents, manual requests), weekly closes,
--          payroll (runs, lines — paid ones too —, bonuses, payout methods), leads, contacts, staff requests,
--          client portal data, announcements, holidays, documents rows, notifications, change history,
--          and every login that is NOT a CEO (test employees, test portal clients, pending sign-ups).
-- Resets:  the invoice and employee number counters to 1.
-- Files in Storage (screenshots, documents, attachments) are not touched: Supabase doesn't allow deleting them
-- from SQL. Empty those buckets in Supabase → Storage if you want (optional; nothing points at them anymore).
--
-- Safe to run more than once. Stops without changing anything if there is no CEO login.
-- ============================================================================

DO $$
DECLARE
  t text;
  wipe text[] := ARRAY[
    -- core
    'employees', 'clients', 'projects', 'invoices', 'candidates', 'estimates', 'expenses', 'general_expenses',
    'tasks', 'activity_log', 'invoice_templates', 'recurring_invoices', 'time_entries', 'tags', 'communications',
    'timesheet_import_batches', 'timesheet_import_rows',
    -- client portal
    'client_users', 'client_documents', 'staff_requests', 'working_hour_prefs', 'payment_attempts',
    'team_reviews', 'bonus_requests',
    -- YVA Time
    'tracker_blocks', 'tracker_screenshots', 'tracker_consents', 'desktop_devices', 'desktop_link_codes',
    'manual_time_requests',
    -- money
    'placement_rates', 'week_closes', 'time_adjustments', 'client_payments',
    'payroll_lines', 'payroll_runs', 'payroll_adjustments', 'employee_payout_methods',
    -- workspace / CRM
    'time_off_requests', 'announcements', 'holidays', 'employee_documents', 'employee_instructions',
    'leads', 'lead_activities', 'contacts',
    -- notifications / history
    'notifications', 'audit_log'
  ];
  present text[] := '{}';
  ceo_count int;
BEGIN
  SELECT count(*) INTO ceo_count FROM public.user_roles WHERE role = 'ceo';
  IF ceo_count = 0 THEN
    RAISE EXCEPTION 'No CEO login found in user_roles — nothing was changed (this script keeps only CEO logins).';
  END IF;

  FOREACH t IN ARRAY wipe LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN present := present || t; END IF;
  END LOOP;

  -- Logins: keep CEOs only
  IF to_regclass('public.notification_prefs') IS NOT NULL THEN
    DELETE FROM public.notification_prefs np
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.role = 'ceo' AND r.user_id::text = np.user_id::text);
  END IF;
  IF to_regclass('public.push_subscriptions') IS NOT NULL THEN
    DELETE FROM public.push_subscriptions ps
    WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.role = 'ceo' AND r.user_id::text = ps.user_id::text);
  END IF;
  DELETE FROM auth.users u
  WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.role = 'ceo' AND r.user_id::text = u.id::text);
  DELETE FROM public.user_roles WHERE role <> 'ceo';

  -- Then one TRUNCATE for all of them (after the login clean-up, so its own change-history rows go too): fast, and it skips the row triggers that protect paid payroll lines and
  -- the change history (that's the point here). CASCADE only reaches tables that point at these.
  IF array_length(present, 1) > 0 THEN
    EXECUTE 'TRUNCATE TABLE ' || (SELECT string_agg(format('public.%I', x), ', ') FROM unnest(present) x) || ' CASCADE';
  END IF;

  -- Number counters back to the start (the old-CRM import sets them from the imported data)
  IF to_regclass('public.counters') IS NOT NULL THEN
    UPDATE public.counters SET value = 1 WHERE key IN ('invoice', 'employee');
  END IF;

  RAISE NOTICE 'Start fresh: emptied % tables, kept % CEO login(s), settings and permissions.', array_length(present, 1), ceo_count;
END $$;

NOTIFY pgrst, 'reload schema';
