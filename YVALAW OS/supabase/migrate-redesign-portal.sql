-- Client portal redesign (2026-11): "Request more staff" now asks How many + Project.
-- Idempotent — safe to run more than once. Until it runs, the portal saves those two
-- answers inside the request's notes instead (see submitStaffRequest in portalStorage.ts).
-- New columns are nullable with a DEFAULT (older app versions save without them).

ALTER TABLE public.staff_requests ADD COLUMN IF NOT EXISTS headcount integer DEFAULT 1;
ALTER TABLE public.staff_requests ADD COLUMN IF NOT EXISTS project_id text;     -- text: old tables' ids may be text
ALTER TABLE public.staff_requests ADD COLUMN IF NOT EXISTS project_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_requests_headcount_check' AND conrelid = 'public.staff_requests'::regclass
  ) THEN
    ALTER TABLE public.staff_requests
      ADD CONSTRAINT staff_requests_headcount_check CHECK (headcount IS NULL OR headcount BETWEEN 1 AND 50);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
