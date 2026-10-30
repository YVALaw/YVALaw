-- ============================================================
-- YVA Time — Phase 0: employee fields (2026-10-30)
-- ============================================================
-- Adds the two settings the YVA Time desktop tracker needs on each employee:
--   works_for            'client' = placed under a client project (screenshots on)
--                        'yva'    = works for YVA directly (screenshots off)
--   manual_time_allowed  may this person add time by hand (needs admin approval)
--
-- Both are nullable with defaults so existing saves keep working; the app
-- treats a missing value as 'client' / false.
--
-- Employees already linked to a staff login (user_roles) are marked 'yva'.
--
-- Run in the Supabase SQL Editor BEFORE deploying the matching app version
-- (the app saves these columns). Safe to run more than once.
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS works_for           text    DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS manual_time_allowed boolean DEFAULT false;

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_works_for_check;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_works_for_check CHECK (works_for IN ('client', 'yva'));

UPDATE public.employees e
SET    works_for = 'yva'
WHERE  e.user_id IS NOT NULL
  AND  EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE  r.user_id::text = e.user_id::text
    AND    r.role IN ('ceo', 'admin', 'accounting', 'recruiter', 'lead_gen')
  );

NOTIFY pgrst, 'reload schema';

-- Result check: how many employees of each kind
SELECT coalesce(works_for, '(empty)') AS works_for, count(*) AS employees
FROM   public.employees
GROUP  BY 1
ORDER  BY 1;
