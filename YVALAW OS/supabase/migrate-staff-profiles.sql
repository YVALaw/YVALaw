-- ============================================================
-- YVA OS — Staff profiles + "who did what" trail
-- ============================================================
-- Run in the Supabase SQL Editor after migrate-step1-foundation.sql (and the
-- other step scripts). Safe to run more than once. Re-run it after re-running
-- Step 1 (Step 1 re-creates the history read rule without the lead-notes line).
--
--   1. Change history on the remaining business tables (estimates, tasks,
--      client notes, recurring invoices, staff requests, lead notes, missing
--      time requests, client documents, invoice templates, tags, contracts —
--      only the ones that exist in this database).
--   2. Actions that aren't a saved change (emailed an invoice, exported a
--      file, signed in…): audit_log accepts action = 'event', written only
--      through public.log_action(), which stamps the signed-in staff member
--      and the time on the server. Nobody can write audit_log directly.
--   3. A faster "everything this person did" list (index on actor + time),
--      and the history read rule: same as Step 1 (history.view, plus the
--      rate / payroll / bank / lead permissions for those tables), with lead
--      notes now following the leads rule too.
-- ============================================================

-- ── 1. History on the remaining business tables ─────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estimates', 'tasks', 'activity_log', 'recurring_invoices', 'staff_requests', 'lead_activities',
                           'manual_time_requests', 'client_documents', 'invoice_templates', 'tags', 'contracts'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
      EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_row()', t);
    END IF;
  END LOOP;
END $$;

-- ── 2. Actions ("events") ───────────────────────────────────────────────────

-- Allow action = 'event' (replaces whichever CHECK on audit_log.action exists)
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'public.audit_log'::regclass AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE public.audit_log DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN ('insert', 'update', 'delete', 'event'));
END $$;

-- Record an action by the signed-in staff member. The person and time come from the server, never the browser.
-- changes = details + {kind, label} (kind/label always win over a same-named detail).
CREATE OR REPLACE FUNCTION public.log_action(p_kind text, p_label text, p_table text DEFAULT NULL, p_record text DEFAULT NULL, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_internal() THEN
    RAISE EXCEPTION 'Only YVA staff can record actions' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'Invalid action kind' USING ERRCODE = '22023';
  END IF;
  IF p_table IS NOT NULL AND p_table !~ '^[a-z_]{1,63}$' THEN
    RAISE EXCEPTION 'Invalid table name' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_log (actor_id, actor_email, table_name, record_id, action, changes)
  VALUES (auth.uid(), nullif(auth.jwt() ->> 'email', ''), coalesce(p_table, 'app'), left(p_record, 200), 'event',
          CASE WHEN jsonb_typeof(p_details) = 'object' AND length(p_details::text) <= 4000 THEN p_details ELSE '{}'::jsonb END
          || jsonb_build_object('kind', p_kind, 'label', left(coalesce(p_label, ''), 300)));
END
$$;
REVOKE ALL ON FUNCTION public.log_action(text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_action(text, text, text, text, jsonb) TO authenticated;

-- ── 3. "Everything this person did" + read rule ────────────────────────────

CREATE INDEX IF NOT EXISTS audit_log_actor ON public.audit_log (actor_id, at DESC);

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
      WHEN 'lead_activities'         THEN private.has_permission('leads.view_all')
      ELSE true END);
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;

NOTIFY pgrst, 'reload schema';

-- Check list
SELECT 'history on ' || event_object_table AS item, 'ok' AS status
FROM information_schema.triggers
WHERE trigger_name = 'audit_row' AND event_manipulation = 'INSERT'
  AND event_object_table IN ('estimates', 'tasks', 'activity_log', 'recurring_invoices', 'staff_requests', 'lead_activities',
                             'manual_time_requests', 'client_documents', 'invoice_templates', 'tags', 'contracts')
UNION ALL
SELECT 'log_action()', CASE WHEN to_regprocedure('public.log_action(text, text, text, text, jsonb)') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
ORDER BY 1;
