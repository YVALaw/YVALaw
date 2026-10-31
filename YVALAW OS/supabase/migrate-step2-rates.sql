-- ============================================================
-- YVA OS — Steps 2 + 3: rates per placement, pay schedules (PLAN.md)
-- ============================================================
-- Run after migrate-step1-foundation.sql. Safe to run more than once.
--
--   placement_rates — one row per rate change for one person, from a date:
--     • project_id set  → that person on that project: position, bill rate (client) and/or pay rate (employee)
--     • project_id NULL → the person's own pay rate from that date (e.g. a raise; YVA team)
--     Past weeks keep the rate that applied then. Empty bill/pay = "use the fallback":
--       bill = placement → project rate → client default rate
--       pay  = placement → person's dated pay rate → employee pay rate
--   Only people with the rates.manage permission (CEO by default) can see or change them.
--   Live earnings (employee-earnings function) read them server-side and show employees
--   only their own pay — never bill rates.
--
--   projects.pay_schedule / employees.pay_schedule — weekly, biweekly (pay_anchor = a Monday
--   that starts a two-week period), semimonthly (quincena) or monthly. The employee value
--   (YVA team) wins over the project's. Payday = the Friday after the period ends.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.placement_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL,
  project_id     uuid,
  position       text,
  bill_rate      numeric(10, 2),
  pay_rate       numeric(10, 2),
  effective_from date NOT NULL DEFAULT current_date,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT auth.uid(),
  CONSTRAINT placement_rates_bill CHECK (bill_rate IS NULL OR bill_rate >= 0),
  CONSTRAINT placement_rates_pay  CHECK (pay_rate IS NULL OR pay_rate >= 0),
  CONSTRAINT placement_rates_no_bill_without_project CHECK (project_id IS NOT NULL OR bill_rate IS NULL),
  CONSTRAINT placement_rates_something CHECK (bill_rate IS NOT NULL OR pay_rate IS NOT NULL OR position IS NOT NULL),
  CONSTRAINT placement_rates_note_len CHECK (note IS NULL OR length(note) <= 500),
  -- one change per person/project/day (PostgreSQL 15+: NULL project = the person's own pay rate)
  CONSTRAINT placement_rates_one_per_day UNIQUE NULLS NOT DISTINCT (employee_id, project_id, effective_from)
);
CREATE INDEX IF NOT EXISTS placement_rates_employee ON public.placement_rates (employee_id, effective_from DESC);
ALTER TABLE public.placement_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "placement_rates_manage" ON public.placement_rates;
CREATE POLICY "placement_rates_manage" ON public.placement_rates
  FOR ALL TO authenticated
  USING (private.has_permission('rates.manage'))
  WITH CHECK (private.has_permission('rates.manage'));

DROP TRIGGER IF EXISTS audit_row ON public.placement_rates;
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.placement_rates
  FOR EACH ROW EXECUTE FUNCTION private.audit_row();

-- Pay schedules
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    -- Nullable on purpose (NULL = weekly): the app version before this one saves projects in one batch
    -- and would write NULL into a NOT NULL column for a new project.
    ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS pay_schedule text DEFAULT 'weekly';
    ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS pay_anchor date;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_pay_schedule') THEN
      ALTER TABLE public.projects ADD CONSTRAINT projects_pay_schedule CHECK (pay_schedule IS NULL OR pay_schedule IN ('weekly', 'biweekly', 'semimonthly', 'monthly'));
    END IF;
  END IF;
  IF to_regclass('public.employees') IS NOT NULL THEN
    ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS pay_schedule text;          -- NULL = follow the project
    ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS pay_anchor date;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_pay_schedule') THEN
      ALTER TABLE public.employees ADD CONSTRAINT employees_pay_schedule CHECK (pay_schedule IS NULL OR pay_schedule IN ('weekly', 'biweekly', 'semimonthly', 'monthly'));
    END IF;
  END IF;
END $$;

-- Bill rates + positions for invoicing, for every staff member (no pay rates): the invoice builder
-- needs the client's rate per person, but placement_rates itself is rates.manage only.
CREATE OR REPLACE FUNCTION public.placement_bill_rates()
RETURNS TABLE (employee_id uuid, project_id uuid, "position" text, bill_rate numeric, effective_from date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.employee_id, r.project_id, r.position, r.bill_rate, r.effective_from
  FROM public.placement_rates r
  WHERE private.is_internal() AND r.project_id IS NOT NULL AND (r.bill_rate IS NOT NULL OR r.position IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public.placement_bill_rates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.placement_bill_rates() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Check
SELECT 'placement_rates' AS item, CASE WHEN relrowsecurity THEN 'RLS on' ELSE 'RLS OFF' END AS status
FROM pg_class WHERE oid = 'public.placement_rates'::regclass
UNION ALL
SELECT 'projects.pay_schedule', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'pay_schedule') THEN 'yes' ELSE 'MISSING' END
UNION ALL
SELECT 'employees.pay_schedule', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'pay_schedule') THEN 'yes' ELSE 'MISSING' END;
