-- ============================================================
-- YVA OS — Step 6: Payroll (PLAN.md)
-- ============================================================
-- Run after migrate-step4-weekly-close.sql. Safe to run more than once.
--
--   payroll_runs         one per payday (a Friday): exchange rate (USD → DOP) entered when paying,
--                        locked once anyone on it is marked paid.
--   payroll_lines        one per person per project (or YVA team) per pay period on that payday:
--                        hours (regular / night), pay rate, gross, bonuses − deductions, net USD,
--                        net DOP (fixed when marked paid), payout method snapshot, paid date + reference.
--   payroll_adjustments  bonuses / deductions. Each row is used by ONE payroll and then it's done:
--                        pending → attached to a payroll (run_id) → applied when that person is paid.
--                        "Repeat for the next N paydays" creates N rows with the same group_id, and
--                        each payroll takes the next one. Nothing reappears later (the old CRM issue).
--   employee_payout_methods  bank (any DR bank, BHD first) or PayPal, per employee. Readable only with
--                        bank.view, changeable only with bank.manage. Account numbers never go into
--                        the change history.
--   payroll_mark_paid(lines, paid_on, reference) / payroll_unmark_paid(line)
-- Employees read their own PAID lines (payslips, payment history) and get a notification when paid.
-- Permissions: payroll.view (see), payroll.manage (prepare, rate, bonuses, mark paid).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payday        date NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'open',
  exchange_rate numeric(10, 4),
  rate_source   text,
  flags         jsonb NOT NULL DEFAULT '[]'::jsonb,
  prepared_at   timestamptz,
  prepared_by   uuid,
  paid_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_status CHECK (status IN ('open', 'paid')),
  CONSTRAINT payroll_runs_friday CHECK (extract(isodow FROM payday) = 5),
  CONSTRAINT payroll_runs_rate   CHECK (exchange_rate IS NULL OR exchange_rate > 0)
);

CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES public.payroll_runs (id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL,
  project_id      uuid,                                   -- NULL = YVA team work
  label           text NOT NULL,                          -- project name or "YVA team"
  schedule        text NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  payday          date NOT NULL,
  regular_seconds integer NOT NULL DEFAULT 0,
  premium_seconds integer NOT NULL DEFAULT 0,
  pay_rate        numeric(10, 2) NOT NULL DEFAULT 0,      -- the rate used (the latest if it changed in the period)
  rates           jsonb NOT NULL DEFAULT '[]'::jsonb,     -- every rate used in the period
  premium_percent numeric(6, 2) NOT NULL DEFAULT 0,
  gross_usd       numeric(12, 2) NOT NULL DEFAULT 0,
  adjustments_usd numeric(12, 2) NOT NULL DEFAULT 0,
  net_usd         numeric(12, 2) NOT NULL DEFAULT 0,
  net_dop         numeric(14, 2),                         -- fixed when marked paid
  exchange_rate   numeric(10, 4),                         -- the rate it was paid at
  payout          jsonb,                                  -- method snapshot when paid (account masked)
  status          text NOT NULL DEFAULT 'pending',
  paid_on         date,
  paid_at         timestamptz,
  reference       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_lines_status CHECK (status IN ('pending', 'paid')),
  CONSTRAINT payroll_lines_one UNIQUE NULLS NOT DISTINCT (run_id, employee_id, project_id, period_start)
);
CREATE INDEX IF NOT EXISTS payroll_lines_employee ON public.payroll_lines (employee_id, payday DESC);

CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  type        text NOT NULL,
  amount      numeric(12, 2) NOT NULL,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  run_id      uuid REFERENCES public.payroll_runs (id) ON DELETE SET NULL,
  group_id    uuid,
  sequence    integer NOT NULL DEFAULT 1,
  total       integer NOT NULL DEFAULT 1,
  created_by  uuid DEFAULT auth.uid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz,
  CONSTRAINT payroll_adjustments_type   CHECK (type IN ('bonus', 'deduction')),
  CONSTRAINT payroll_adjustments_amount CHECK (amount > 0),
  CONSTRAINT payroll_adjustments_status CHECK (status IN ('pending', 'applied', 'cancelled')),
  CONSTRAINT payroll_adjustments_reason CHECK (length(reason) BETWEEN 2 AND 300),
  CONSTRAINT payroll_adjustments_seq    CHECK (sequence BETWEEN 1 AND total AND total BETWEEN 1 AND 52)
);
CREATE INDEX IF NOT EXISTS payroll_adjustments_employee ON public.payroll_adjustments (employee_id, status);

CREATE TABLE IF NOT EXISTS public.employee_payout_methods (
  employee_id    uuid PRIMARY KEY,
  method         text NOT NULL DEFAULT 'bank',
  bank_name      text,
  account_type   text,
  account_number text,
  holder_name    text,
  holder_id      text,                -- cédula / passport
  paypal_email   text,
  currency       text NOT NULL DEFAULT 'DOP',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid DEFAULT auth.uid(),
  CONSTRAINT payout_method   CHECK (method IN ('bank', 'paypal')),
  CONSTRAINT payout_currency CHECK (currency IN ('DOP', 'USD')),
  CONSTRAINT payout_account_type CHECK (account_type IS NULL OR account_type IN ('savings', 'checking')),
  CONSTRAINT payout_complete CHECK ((method = 'bank' AND bank_name IS NOT NULL AND account_number IS NOT NULL) OR (method = 'paypal' AND paypal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_payout_methods ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_runs', 'payroll_lines', 'payroll_adjustments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_view" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_manage" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "%s_view" ON public.%I FOR SELECT TO authenticated USING (private.has_permission(''payroll.view'') OR private.has_permission(''payroll.manage''))', t, t);
    EXECUTE format('CREATE POLICY "%s_manage" ON public.%I FOR ALL TO authenticated USING (private.has_permission(''payroll.manage'')) WITH CHECK (private.has_permission(''payroll.manage''))', t, t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "payroll_lines_own_paid" ON public.payroll_lines;
CREATE POLICY "payroll_lines_own_paid" ON public.payroll_lines
  FOR SELECT TO authenticated USING (employee_id = private.current_employee_id() AND status = 'paid');
DROP POLICY IF EXISTS "payroll_adjustments_own_applied" ON public.payroll_adjustments;
CREATE POLICY "payroll_adjustments_own_applied" ON public.payroll_adjustments
  FOR SELECT TO authenticated USING (employee_id = private.current_employee_id() AND status = 'applied');

DROP POLICY IF EXISTS "payout_view"   ON public.employee_payout_methods;
DROP POLICY IF EXISTS "payout_manage" ON public.employee_payout_methods;
CREATE POLICY "payout_view" ON public.employee_payout_methods
  FOR SELECT TO authenticated USING (private.has_permission('bank.view') OR private.has_permission('bank.manage'));
CREATE POLICY "payout_manage" ON public.employee_payout_methods
  FOR ALL TO authenticated USING (private.has_permission('bank.manage')) WITH CHECK (private.has_permission('bank.manage'));

-- A paid line can't be edited (except by the unmark function); the run's rate is locked once someone is paid
CREATE OR REPLACE FUNCTION private.payroll_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'paid' THEN RAISE EXCEPTION 'A paid payroll line cannot be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'paid' AND current_setting('yva.payroll_unmark', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'This person is already marked paid — undo "paid" first' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS payroll_lines_guard ON public.payroll_lines;
CREATE TRIGGER payroll_lines_guard BEFORE UPDATE OR DELETE ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION private.payroll_lines_guard();

CREATE OR REPLACE FUNCTION private.payroll_runs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.exchange_rate IS DISTINCT FROM OLD.exchange_rate
     AND EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = OLD.id AND status = 'paid') THEN
    RAISE EXCEPTION 'The exchange rate is locked: people on this payroll are already paid' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS payroll_runs_guard ON public.payroll_runs;
CREATE TRIGGER payroll_runs_guard BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION private.payroll_runs_guard();

-- ── Mark paid / undo ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.payroll_mark_paid(p_lines uuid[], p_paid_on date DEFAULT current_date, p_reference text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l record;
  r record;
  paid integer := 0;
  pm record;
  uid uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.has_permission('payroll.manage') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  FOR l IN SELECT * FROM public.payroll_lines WHERE id = ANY (p_lines) AND status = 'pending' FOR UPDATE LOOP
    SELECT * INTO r FROM public.payroll_runs WHERE id = l.run_id;
    IF r.exchange_rate IS NULL THEN RAISE EXCEPTION 'Enter the exchange rate for % first', to_char(r.payday, 'Mon DD') USING ERRCODE = 'check_violation'; END IF;
    SELECT * INTO pm FROM public.employee_payout_methods WHERE employee_id = l.employee_id;
    UPDATE public.payroll_lines SET
      status = 'paid', paid_on = coalesce(p_paid_on, current_date), paid_at = now(), reference = nullif(trim(p_reference), ''),
      exchange_rate = r.exchange_rate, net_dop = round(l.net_usd * r.exchange_rate, 2),
      payout = CASE WHEN pm IS NULL THEN NULL ELSE jsonb_build_object('method', pm.method, 'bank', pm.bank_name, 'accountType', pm.account_type,
               'account', CASE WHEN pm.account_number IS NULL THEN NULL ELSE '••••' || right(pm.account_number, 4) END, 'paypal', CASE WHEN pm.paypal_email IS NULL THEN NULL ELSE left(pm.paypal_email, 1) || '•••@' || split_part(pm.paypal_email, '@', 2) END, 'currency', pm.currency) END
    WHERE id = l.id;
    -- Bonuses / deductions attached to this payroll for this person are now used up
    UPDATE public.payroll_adjustments SET status = 'applied', applied_at = now()
    WHERE run_id = l.run_id AND employee_id = l.employee_id AND status = 'pending';
    paid := paid + 1;
    SELECT user_id INTO uid FROM public.employees WHERE id = l.employee_id;
    PERFORM private.notify_user(uid, 'payslip_ready',
      'Your pay is ready — Tu pago está listo',
      l.label || ' · ' || to_char(l.period_start, 'Mon DD') || ' – ' || to_char(l.period_end, 'Mon DD') ||
      ' · RD$' || to_char(round(l.net_usd * r.exchange_rate), 'FM999,999,990'), '/me?s=pay');
  END LOOP;
  UPDATE public.payroll_runs pr SET status = 'paid', paid_at = now()
  WHERE pr.id IN (SELECT run_id FROM public.payroll_lines WHERE id = ANY (p_lines))
    AND NOT EXISTS (SELECT 1 FROM public.payroll_lines x WHERE x.run_id = pr.id AND x.status = 'pending');
  RETURN json_build_object('paid', paid);
END
$$;

CREATE OR REPLACE FUNCTION public.payroll_unmark_paid(p_line uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE l record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.has_permission('payroll.manage') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.payroll_lines WHERE id = p_line;
  IF NOT FOUND OR l.status <> 'paid' THEN RETURN; END IF;
  PERFORM set_config('yva.payroll_unmark', 'on', true);
  UPDATE public.payroll_lines SET status = 'pending', paid_on = NULL, paid_at = NULL, reference = NULL, net_dop = NULL, exchange_rate = NULL, payout = NULL WHERE id = p_line;
  PERFORM set_config('yva.payroll_unmark', 'off', true);
  -- give back the bonuses / deductions only if no other line of this person on this payroll is still paid
  IF NOT EXISTS (SELECT 1 FROM public.payroll_lines WHERE run_id = l.run_id AND employee_id = l.employee_id AND status = 'paid') THEN
    UPDATE public.payroll_adjustments SET status = 'pending', applied_at = NULL WHERE run_id = l.run_id AND employee_id = l.employee_id AND status = 'applied';
  END IF;
  UPDATE public.payroll_runs SET status = 'open', paid_at = NULL WHERE id = l.run_id;
END
$$;
REVOKE ALL ON FUNCTION public.payroll_mark_paid(uuid[], date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payroll_unmark_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_mark_paid(uuid[], date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payroll_unmark_paid(uuid) TO authenticated, service_role;

-- ── History ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_runs', 'payroll_lines', 'payroll_adjustments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_row()', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS audit_row ON public.employee_payout_methods;
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.employee_payout_methods
  FOR EACH ROW EXECUTE FUNCTION private.audit_row('account_number', 'holder_id', 'paypal_email');

NOTIFY pgrst, 'reload schema';

SELECT c.relname AS item, CASE WHEN c.relrowsecurity THEN 'RLS on' ELSE 'RLS OFF' END AS status
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('payroll_runs', 'payroll_lines', 'payroll_adjustments', 'employee_payout_methods')
ORDER BY 1;
