-- ============================================================
-- YVA OS — Steps 4 + 5: weekly close, time adjustments, client payments (PLAN.md)
-- ============================================================
-- Run after migrate-step2-rates.sql. Safe to run more than once.
--
--   week_closes        one row per week (Mon–Sun, Dominican time): status preparing → ready →
--                      approved; summary, flags and payroll preview prepared by the
--                      week-close functions (Sunday night, or "Prepare again").
--   invoices           + client_id, week_close_id, auto_generated. One combined draft invoice per
--                      client per week; numbered per client (HAL-0001) by next_client_invoice_number().
--   clients            + invoice_prefix, next_invoice_seq.
--   time_adjustments   time YVA edited (± seconds on a day) or moved to the next week. The employee
--                      sees them ("adjusted by YVA" + note) and gets a notification.
--   client_payments    payments received (manual, or Stripe automatically). Each payment updates
--                      the invoice's amount paid and status (partial / paid).
--   week_close_approve(week_start)  approve all the week's hours and roll them (+ adjustments)
--                      into time_entries, like Time Tracking → Approve does per person.
-- Permissions: weekly_close.manage (weekly close + adjustments), payments.record (payments).
-- ============================================================

-- ── 1. Weekly close ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.week_closes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start      date NOT NULL UNIQUE,
  week_end        date NOT NULL,
  status          text NOT NULL DEFAULT 'ready',
  prepared_at     timestamptz,
  prepared_by     uuid,                         -- NULL = automatic (Sunday night)
  approved_at     timestamptz,
  approved_by     uuid,
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags           jsonb NOT NULL DEFAULT '[]'::jsonb,
  payroll_preview jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT week_closes_status CHECK (status IN ('preparing', 'ready', 'approved')),
  CONSTRAINT week_closes_monday CHECK (extract(isodow FROM week_start) = 1 AND week_end = week_start + 6)
);
ALTER TABLE public.week_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "week_closes_manage" ON public.week_closes;
CREATE POLICY "week_closes_manage" ON public.week_closes
  FOR ALL TO authenticated
  USING (private.has_permission('weekly_close.manage'))
  WITH CHECK (private.has_permission('weekly_close.manage'));

-- ── 2. Invoices + per-client numbering ──────────────────────────────────────

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS week_close_id uuid;
-- Nullable on purpose: the previous app version saves all invoices in one batch (NOT NULL would break new invoices)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS auto_generated boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS invoices_week_close ON public.invoices (week_close_id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_client_week ON public.invoices (week_close_id, client_id) WHERE week_close_id IS NOT NULL;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS invoice_prefix text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS next_invoice_seq integer DEFAULT 1;

-- Next number for a client's invoice, e.g. HAL-0001. Locks the client row, so two runs can't
-- hand out the same number. The prefix is the first 3 letters of the client name (made unique).
CREATE OR REPLACE FUNCTION public.next_client_invoice_number(p_client uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        record;
  prefix   text;
  base     text;
  n        integer := 1;
  seq      integer;
  existing integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.has_permission('weekly_close.manage') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.clients WHERE id = p_client FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;

  prefix := upper(nullif(trim(c.invoice_prefix), ''));
  IF prefix IS NULL THEN
    base := upper(left(regexp_replace(coalesce(c.name, 'INV'), '[^A-Za-z0-9]', '', 'g'), 3));
    IF base = '' THEN base := 'INV'; END IF;
    prefix := base;
    WHILE EXISTS (SELECT 1 FROM public.clients WHERE upper(invoice_prefix) = prefix AND id <> p_client) LOOP
      n := n + 1; prefix := base || n;
    END LOOP;
    UPDATE public.clients SET invoice_prefix = prefix WHERE id = p_client;
  END IF;

  -- Never reuse a number already on an invoice (counters can drift)
  SELECT coalesce(max((regexp_match(number, '^' || prefix || '-(\d+)$'))[1]::integer), 0) INTO existing
  FROM public.invoices WHERE number ~ ('^' || prefix || '-\d+$');
  seq := greatest(coalesce(c.next_invoice_seq, 1), existing + 1);
  UPDATE public.clients SET next_invoice_seq = seq + 1 WHERE id = p_client;
  RETURN prefix || '-' || lpad(seq::text, 4, '0');
END
$$;
REVOKE ALL ON FUNCTION public.next_client_invoice_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_client_invoice_number(uuid) TO authenticated, service_role;

-- Portal: a client sees its invoices by client_id (new) or by name (older invoices); never drafts
DO $$
BEGIN
  IF to_regclass('public.client_users') IS NOT NULL
     -- only replace an existing policy: once migrate-portal-invoices-lockdown.sql removed it, re-running this keeps it removed
     AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'invoices' AND policyname = 'portal_client_invoices') THEN
    DROP POLICY IF EXISTS "portal_client_invoices" ON public.invoices;
    CREATE POLICY "portal_client_invoices" ON public.invoices
      FOR SELECT TO authenticated
      USING (
        private.is_portal_client()
        AND (client_id = private.portal_client_id()
             OR client_name = (SELECT name FROM public.clients WHERE id = private.portal_client_id() LIMIT 1))
        AND coalesce(status, 'draft') <> 'draft'
      );
  END IF;
END $$;

-- Portal invoices without staff pay: invoice items carry each person's pay rate / pay total for
-- payroll, and a row policy can't hide parts of a JSON column. The portal reads invoices through
-- this function (pay fields removed); migrate-portal-invoices-lockdown.sql then drops the direct
-- portal policy above once this app version is live. Staff (portal preview) pass the client name.
CREATE OR REPLACE FUNCTION public.portal_invoices(p_client_name text DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (to_jsonb(i) - 'employee_payments')
         || jsonb_build_object('items', CASE WHEN jsonb_typeof(to_jsonb(i) -> 'items') = 'array' THEN
              coalesce((SELECT jsonb_agg(CASE WHEN jsonb_typeof(it) = 'object'
                                              THEN it - 'basePayRate' - 'totalPay' - 'payRate' - 'payAmount'
                                              ELSE it END ORDER BY n)
                        FROM jsonb_array_elements(to_jsonb(i) -> 'items') WITH ORDINALITY AS x(it, n)), '[]'::jsonb)
              ELSE '[]'::jsonb END)
  FROM public.invoices i
  WHERE coalesce(i.status, 'draft') <> 'draft'
    AND (
      (private.is_portal_client()
       AND (i.client_id = private.portal_client_id()
            OR i.client_name = (SELECT c.name FROM public.clients c WHERE c.id = private.portal_client_id() LIMIT 1)))
      OR (private.is_internal() AND p_client_name IS NOT NULL AND i.client_name = p_client_name)
    )
  ORDER BY i.date DESC NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.portal_invoices(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_invoices(text) TO authenticated;

-- ── 3. Time adjustments ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.time_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL,
  project_id    uuid,
  work_type     text,
  day           date NOT NULL,
  seconds_delta integer NOT NULL,
  kind          text NOT NULL DEFAULT 'edit',      -- edit | defer_out | defer_in | late_add
  note          text NOT NULL,
  status        text NOT NULL DEFAULT 'applied',   -- applied | cancelled
  group_id      uuid,                              -- a move to next week = defer_out + defer_in with the same group
  created_by    uuid DEFAULT auth.uid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_adjustments_target CHECK (project_id IS NULL OR work_type IS NULL),
  CONSTRAINT time_adjustments_kind   CHECK (kind IN ('edit', 'defer_out', 'defer_in', 'late_add')),
  CONSTRAINT time_adjustments_status CHECK (status IN ('applied', 'cancelled')),
  CONSTRAINT time_adjustments_delta  CHECK (seconds_delta <> 0 AND abs(seconds_delta) <= 86400),
  CONSTRAINT time_adjustments_note   CHECK (length(note) BETWEEN 2 AND 500)
);
CREATE INDEX IF NOT EXISTS time_adjustments_employee_day ON public.time_adjustments (employee_id, day);
ALTER TABLE public.time_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_adjustments_manage"  ON public.time_adjustments;
DROP POLICY IF EXISTS "time_adjustments_own_read" ON public.time_adjustments;
CREATE POLICY "time_adjustments_manage" ON public.time_adjustments
  FOR ALL TO authenticated
  USING (private.has_permission('weekly_close.manage'))
  WITH CHECK (private.has_permission('weekly_close.manage'));
CREATE POLICY "time_adjustments_own_read" ON public.time_adjustments
  FOR SELECT TO authenticated USING (employee_id = private.current_employee_id());

-- The employee is told when YVA changes their time
CREATE OR REPLACE FUNCTION private.time_adjustment_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  mins integer := round(abs(NEW.seconds_delta) / 60.0);
BEGIN
  IF NEW.kind = 'defer_in' THEN RETURN NULL; END IF;     -- one notification per move
  SELECT user_id INTO uid FROM public.employees WHERE id = NEW.employee_id;
  PERFORM private.notify_user(uid, 'time_adjusted',
    CASE NEW.kind
      WHEN 'defer_out' THEN 'YVA moved ' || (mins / 60) || 'h ' || lpad((mins % 60)::text, 2, '0') || 'm to next week'
      WHEN 'late_add'  THEN 'YVA added late time: ' || (mins / 60) || 'h ' || lpad((mins % 60)::text, 2, '0') || 'm'
      ELSE 'YVA adjusted your time on ' || to_char(NEW.day, 'Mon DD') || ': ' || CASE WHEN NEW.seconds_delta > 0 THEN '+' ELSE '−' END
           || (mins / 60) || 'h ' || lpad((mins % 60)::text, 2, '0') || 'm'
    END,
    NEW.note, '/me?s=time');
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS time_adjustments_notify ON public.time_adjustments;
CREATE TRIGGER time_adjustments_notify AFTER INSERT ON public.time_adjustments
  FOR EACH ROW EXECUTE FUNCTION private.time_adjustment_notify();

-- ── 4. Approve a week ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.week_close_approve(p_week_start date, p_tz text DEFAULT 'America/Santo_Domingo')
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_week_end date := p_week_start + 6;
  approved integer;
  written  integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.has_permission('weekly_close.manage') THEN
    RAISE EXCEPTION 'Not allowed to approve the week' USING ERRCODE = '42501';
  END IF;
  IF extract(isodow FROM p_week_start) <> 1 THEN RAISE EXCEPTION 'A week starts on Monday'; END IF;
  IF p_week_end >= (now() AT TIME ZONE p_tz)::date THEN
    RAISE EXCEPTION 'The week is not over yet' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.tracker_blocks SET status = 'approved'
  WHERE status = 'tracked' AND (block_start AT TIME ZONE p_tz)::date BETWEEN p_week_start AND p_week_end;
  GET DIAGNOSTICS approved = ROW_COUNT;

  -- Roll approved blocks + YVA's adjustments into time_entries (one row per person/day/target)
  WITH src AS (
    SELECT b.employee_id, (b.block_start AT TIME ZONE p_tz)::date AS day, b.target_key, b.project_id, b.work_type, b.seconds AS secs, b.note
    FROM public.tracker_blocks b
    WHERE b.status = 'approved' AND (b.block_start AT TIME ZONE p_tz)::date BETWEEN p_week_start AND p_week_end
    UNION ALL
    SELECT a.employee_id, a.day,
           CASE WHEN a.project_id IS NOT NULL THEN 'project:' || a.project_id ELSE 'work:' || coalesce(a.work_type, 'Other') END,
           a.project_id, CASE WHEN a.project_id IS NULL THEN coalesce(a.work_type, 'Other') END, a.seconds_delta, 'Adjusted by YVA: ' || a.note
    FROM public.time_adjustments a
    WHERE a.status = 'applied' AND a.day BETWEEN p_week_start AND p_week_end
  ), agg AS (
    SELECT employee_id, day, target_key, project_id, work_type, SUM(secs) AS secs, string_agg(DISTINCT note, '; ') AS notes
    FROM src GROUP BY 1, 2, 3, 4, 5
  ), up AS (
    INSERT INTO public.time_entries
      (employee_id, employee_name, project_id, project_name, client_name, date, hours, description,
       billable, invoiced, source, tracker_key, approved_by, approved_at)
    SELECT a.employee_id, e.name, a.project_id, p.name, c.name, a.day, ROUND(greatest(a.secs, 0) / 3600.0, 2),
           LEFT(concat_ws(' — ', a.work_type, a.notes), 500), a.project_id IS NOT NULL, false, 'tracker',
           concat(a.employee_id, '|', a.day, '|', a.target_key), auth.uid(), now()
    FROM agg a
    JOIN public.employees e ON e.id::text = a.employee_id::text
    LEFT JOIN public.projects p ON p.id::text = a.project_id::text
    LEFT JOIN public.clients  c ON c.id::text = p.client_id::text
    ON CONFLICT (tracker_key) DO UPDATE
      SET hours = EXCLUDED.hours, description = EXCLUDED.description, approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at
    RETURNING 1
  )
  SELECT count(*) INTO written FROM up;

  UPDATE public.week_closes SET status = 'approved', approved_at = now(), approved_by = auth.uid() WHERE week_start = p_week_start;
  RETURN json_build_object('blocks', approved, 'entries', written);
END
$$;
REVOKE ALL ON FUNCTION public.week_close_approve(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.week_close_approve(date, text) TO authenticated, service_role;

-- The per-person Approve / manual-time decisions (YVA Time phase 2) rebuild a person's day totals from
-- blocks. Redefined here so they also count YVA's adjustments — before, approving someone after the
-- weekly close silently dropped those adjustments from time_entries (portal hours, time log).
-- SECURITY DEFINER so an approver who can't read time_adjustments directly still counts them.
CREATE OR REPLACE FUNCTION public.yva_time_rollup(p_employee uuid, p_from date, p_to date, p_tz text DEFAULT 'America/Santo_Domingo')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  written integer;
BEGIN
  IF auth.uid() IS NOT NULL AND COALESCE(private.current_user_role(), '') NOT IN ('ceo', 'admin', 'accounting')
     AND NOT private.has_permission('weekly_close.manage') THEN
    RAISE EXCEPTION 'Only CEO, Admin or Accounting can approve time' USING ERRCODE = '42501';
  END IF;

  WITH src AS (
    SELECT (b.block_start AT TIME ZONE p_tz)::date AS day, b.target_key, b.project_id, b.work_type, b.seconds AS secs, b.note
    FROM   public.tracker_blocks b
    WHERE  b.employee_id = p_employee AND b.status = 'approved'
      AND  (b.block_start AT TIME ZONE p_tz)::date BETWEEN p_from AND p_to
    UNION ALL
    SELECT a.day,
           CASE WHEN a.project_id IS NOT NULL THEN 'project:' || a.project_id ELSE 'work:' || coalesce(a.work_type, 'Other') END,
           a.project_id, CASE WHEN a.project_id IS NULL THEN coalesce(a.work_type, 'Other') END, a.seconds_delta, 'Adjusted by YVA: ' || a.note
    FROM   public.time_adjustments a
    WHERE  a.employee_id = p_employee AND a.status = 'applied' AND a.day BETWEEN p_from AND p_to
      -- only days that have approved time (an adjustment alone is rolled up when its week is approved)
      AND  EXISTS (SELECT 1 FROM public.tracker_blocks b2 WHERE b2.employee_id = p_employee AND b2.status = 'approved'
                   AND (b2.block_start AT TIME ZONE p_tz)::date = a.day)
  ), agg AS (
    SELECT day, target_key, project_id, work_type, SUM(secs) AS secs, string_agg(DISTINCT note, '; ') AS notes
    FROM src GROUP BY 1, 2, 3, 4
  ), up AS (
    INSERT INTO public.time_entries
      (employee_id, employee_name, project_id, project_name, client_name, date, hours, description,
       billable, invoiced, source, tracker_key, approved_by, approved_at)
    SELECT p_employee, e.name, a.project_id, p.name, c.name, a.day, ROUND(greatest(a.secs, 0) / 3600.0, 2),
           LEFT(concat_ws(' — ', a.work_type, a.notes), 500),
           a.project_id IS NOT NULL, false, 'tracker',
           concat(p_employee, '|', a.day, '|', a.target_key), auth.uid(), now()
    FROM   agg a
    JOIN   public.employees e ON e.id::text = p_employee::text
    LEFT JOIN public.projects p ON p.id::text = a.project_id::text
    LEFT JOIN public.clients  c ON c.id::text = p.client_id::text
    ON CONFLICT (tracker_key) DO UPDATE
      SET hours = EXCLUDED.hours, description = EXCLUDED.description,
          approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at
    RETURNING 1
  )
  SELECT count(*) INTO written FROM up;
  RETURN written;
END
$$;
REVOKE ALL ON FUNCTION public.yva_time_rollup(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.yva_time_rollup(uuid, date, date, text) TO authenticated;

-- ── 5. Client payments ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL,
  client_id    uuid,
  paid_on      date NOT NULL DEFAULT current_date,
  amount       numeric(12, 2) NOT NULL,
  method       text NOT NULL DEFAULT 'wire',
  reference    text,
  note         text,
  source       text NOT NULL DEFAULT 'manual',     -- manual | stripe
  external_ref text UNIQUE,                         -- Stripe payment intent (no double counting on retries)
  created_by   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_payments_amount CHECK (amount > 0),
  CONSTRAINT client_payments_method CHECK (method IN ('wire', 'ach', 'zelle', 'check', 'card', 'cash', 'paypal', 'other')),
  CONSTRAINT client_payments_source CHECK (source IN ('manual', 'stripe'))
);
CREATE INDEX IF NOT EXISTS client_payments_invoice ON public.client_payments (invoice_id);
CREATE INDEX IF NOT EXISTS client_payments_paid_on ON public.client_payments (paid_on);
ALTER TABLE public.client_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "client_payments_read"  ON public.client_payments;
DROP POLICY IF EXISTS "client_payments_write" ON public.client_payments;
CREATE POLICY "client_payments_read" ON public.client_payments
  FOR SELECT TO authenticated
  USING (private.has_permission('payments.record') OR private.current_user_role() IN ('ceo', 'admin', 'accounting'));
CREATE POLICY "client_payments_write" ON public.client_payments
  FOR ALL TO authenticated
  USING (private.has_permission('payments.record'))
  WITH CHECK (private.has_permission('payments.record'));

-- Keep the invoice's amount paid and status in step with its payments
CREATE OR REPLACE FUNCTION private.client_payment_adjust(inv_id uuid, delta numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv    record;
  paid   numeric;
  new_status text;
BEGIN
  IF inv_id IS NULL OR delta = 0 THEN RETURN; END IF;
  SELECT id, status, subtotal, amount_paid, status_history INTO inv FROM public.invoices WHERE id = inv_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  paid := greatest(0, round(coalesce(inv.amount_paid, 0) + delta, 2));
  new_status := CASE
    WHEN paid >= coalesce(inv.subtotal, 0) - 0.005 AND paid > 0 THEN 'paid'
    WHEN paid > 0 THEN 'partial'
    WHEN inv.status IN ('paid', 'partial') THEN 'sent'
    ELSE inv.status END;
  UPDATE public.invoices
  SET amount_paid = paid,
      status = new_status,
      status_history = CASE WHEN new_status IS DISTINCT FROM inv.status
        THEN coalesce(inv.status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('status', new_status, 'changedAt', (extract(epoch FROM now()) * 1000)::bigint))
        ELSE inv.status_history END
  WHERE id = inv_id;
END
$$;
REVOKE ALL ON FUNCTION private.client_payment_adjust(uuid, numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.client_payment_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.client_payment_adjust(OLD.invoice_id, -OLD.amount);
  ELSIF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    -- moved to another invoice: take the whole old amount off the old one, put the new amount on the new one
    PERFORM private.client_payment_adjust(OLD.invoice_id, -OLD.amount);
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount);
  ELSE
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount - OLD.amount);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.source = 'stripe' THEN
    PERFORM private.notify_permission('payments.record', 'payment_received',
      'Payment received: $' || to_char(NEW.amount, 'FM999,999,990.00'), 'Paid by card in the client portal.', '/invoice');
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS client_payments_apply ON public.client_payments;
CREATE TRIGGER client_payments_apply AFTER INSERT OR UPDATE OF amount, invoice_id OR DELETE ON public.client_payments
  FOR EACH ROW EXECUTE FUNCTION private.client_payment_apply();

-- ── 6. History for the new tables ───────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['week_closes', 'time_adjustments', 'client_payments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_row()', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Check
SELECT c.relname AS item, CASE WHEN c.relrowsecurity THEN 'RLS on' ELSE 'RLS OFF' END AS status
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('week_closes', 'time_adjustments', 'client_payments')
UNION ALL
SELECT 'invoices.client_id', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'client_id') THEN 'yes' ELSE 'MISSING' END
ORDER BY 1;
