-- ============================================================
-- YVA OS — Notifications open the exact record + emails on a candidate (2026-11)
-- ============================================================
-- Run in the Supabase SQL Editor after migrate-step7-workspace.sql, migrate-step9-crm.sql,
-- migrate-staff-profiles.sql and migrate-stripe-secure.sql. Safe to run more than once.
-- Only replaces three small functions and adds one read-only function — no tables change.
--
--   1. New lead / lead assigned  → the bell opens that lead          (/leads?open=<id>)
--   2. Stripe payment / refund / dispute → that invoice              (/invoice?open=<id>)
--   3. Time-off request          → that request on Approvals         (/approvals?open=<id>)
--   4. public.record_emails('candidates', <id>): emails sent to a candidate from YVA OS
--      (recorded by the app with log_action 'candidate_emailed'), for the candidate's page.
--      Staff only; never returns the message body (the full email is in the mailbox's Sent Items).
--
-- Notifications already in the bell keep their old link; YVA OS still finds the record by name.
-- The same links are written in the original scripts, so re-running those keeps them.
-- ============================================================

-- ── 1. Leads ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.leads_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link text := '/leads?open=' || NEW.id::text;
BEGIN
  -- Bulk import (import_leads) doesn't send one notification per old lead
  IF coalesce(current_setting('yva.importing_leads', true), '') = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.notify_permission('leads.manage', 'lead_new',
      'New lead: ' || NEW.name || coalesce(' (' || nullif(NEW.company, '') || ')', ''),
      concat_ws(' · ', nullif(NEW.service, ''), nullif(NEW.source, ''), nullif(NEW.email, ''), nullif(NEW.phone, '')), link);
    IF NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM auth.uid() THEN
      PERFORM private.notify_user(NEW.owner_id, 'lead_new', 'A lead was assigned to you: ' || NEW.name, NEW.service, link);
    END IF;
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM auth.uid() THEN
    PERFORM private.notify_user(NEW.owner_id, 'lead_new', 'A lead was assigned to you: ' || NEW.name, NEW.service, link);
  END IF;
  RETURN NULL;
END
$$;

-- ── 2. Stripe payments (same function as migrate-stripe-secure.sql, links only) ─
CREATE OR REPLACE FUNCTION private.client_payment_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  how  text;
  prev numeric;
  link text;
BEGIN
  -- First payment row of an invoice that already showed an amount paid: keep that amount as an "earlier payments" row
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.client_payments WHERE invoice_id::text = NEW.invoice_id::text AND id <> NEW.id) THEN
    SELECT amount_paid INTO prev FROM public.invoices WHERE id::text = NEW.invoice_id::text;
    IF coalesce(prev, 0) > 0.005 THEN
      INSERT INTO public.client_payments (invoice_id, client_id, amount, method, source, kind, note, created_by, paid_on)
      VALUES (NEW.invoice_id, NEW.client_id, round(prev, 2), 'other', 'manual', 'payment',
              'Earlier payments (recorded before payments were tracked one by one)', NULL, current_date);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.client_payment_adjust(OLD.invoice_id, -OLD.amount);
  ELSIF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    PERFORM private.client_payment_adjust(OLD.invoice_id, -OLD.amount);
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount);
  ELSE
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount - OLD.amount);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.source = 'stripe' THEN
    how := CASE NEW.method WHEN 'ach' THEN 'by bank (ACH)' ELSE 'by card' END;
    link := '/invoice?open=' || NEW.invoice_id::text;
    IF NEW.kind = 'payment' THEN
      PERFORM private.notify_permission('payments.record', 'payment_received',
        'Payment received: $' || to_char(NEW.amount, 'FM999,999,990.00'), 'Paid ' || how || ' through Stripe.', link);
    ELSIF NEW.kind = 'refund' THEN
      PERFORM private.notify_permission('payments.record', 'payment_refunded',
        'Refund: $' || to_char(-NEW.amount, 'FM999,999,990.00'), 'A Stripe payment was refunded; the invoice balance was updated.', link);
    ELSE
      PERFORM private.notify_permission('payments.record', 'payment_disputed',
        'Dispute: $' || to_char(-NEW.amount, 'FM999,999,990.00') || ' taken back', 'The client''s bank took the money back while a dispute is open. Answer it in Stripe.', link);
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- ── 3. Time off ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.time_off_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e record;
  span text := to_char(NEW.start_date, 'Mon DD') || CASE WHEN NEW.end_date <> NEW.start_date THEN ' – ' || to_char(NEW.end_date, 'Mon DD') ELSE '' END;
BEGIN
  SELECT name, CASE WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN user_id::text::uuid END AS user_id INTO e FROM public.employees WHERE id::text = NEW.employee_id::text;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.notify_permission('timeoff.approve', 'timeoff_request', coalesce(e.name, 'Someone') || ' asked for time off: ' || span,
      initcap(NEW.kind) || coalesce(' — ' || NEW.note, ''), '/approvals?open=' || NEW.id::text);
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'declined') THEN
    PERFORM private.notify_user(e.user_id, 'timeoff_decision',
      CASE WHEN NEW.status = 'approved' THEN 'Time off approved — Días libres aprobados: ' ELSE 'Time off declined — Días libres rechazados: ' END || span,
      NEW.decision_note, '/me?s=requests');
  END IF;
  RETURN NULL;
END
$$;

-- ── 4. Emails sent to a candidate ──────────────────────────────────────────
-- The app records each email it sends to a candidate with log_action('candidate_emailed', …, 'candidates', <id>,
-- {to, cc, subject, via}). Reading audit_log needs "See the change history"; this function lets any staff member
-- who can open candidates see just these rows for one candidate (who, when, to, subject — never the message).
CREATE OR REPLACE FUNCTION public.record_emails(p_table text, p_record text)
RETURNS TABLE (sent_at timestamptz, sent_by text, to_email text, cc jsonb, subject text, via text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_internal() THEN
    RAISE EXCEPTION 'Only YVA staff can read this' USING ERRCODE = '42501';
  END IF;
  IF p_table IS DISTINCT FROM 'candidates' THEN
    RAISE EXCEPTION 'Emails are only listed for candidates' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT a.at, a.actor_email, a.changes ->> 'to',
           CASE WHEN jsonb_typeof(a.changes -> 'cc') = 'array' THEN a.changes -> 'cc' ELSE '[]'::jsonb END,
           a.changes ->> 'subject', a.changes ->> 'via'
    FROM public.audit_log a
    WHERE a.table_name = 'candidates' AND a.record_id = left(p_record, 200) AND a.action = 'event'
      AND a.changes ->> 'kind' = 'candidate_emailed'
    ORDER BY a.at DESC
    LIMIT 50;
END
$$;
REVOKE ALL ON FUNCTION public.record_emails(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_emails(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Check: three links and the new function
SELECT 'leads link'    AS check, prosrc LIKE '%/leads?open=%'    AS ok FROM pg_proc WHERE proname = 'leads_notify'
UNION ALL SELECT 'invoice link', prosrc LIKE '%/invoice?open=%' FROM pg_proc WHERE proname = 'client_payment_apply'
UNION ALL SELECT 'approvals link', prosrc LIKE '%/approvals?open=%' FROM pg_proc WHERE proname = 'time_off_notify'
UNION ALL SELECT 'record_emails', true FROM pg_proc WHERE proname = 'record_emails';
