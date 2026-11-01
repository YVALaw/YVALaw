-- ============================================================================
-- YVA OS redesign (2026-11) — People hub extras: employee hire date
-- Run after migrate-redesign-people.sql (any order works — it only adds a column). Safe to run more than once.
--
-- employees.hire_date — the full start date (until now only the hire year was stored, in
-- start_year). Used for the "N-year anniversary · Mon D" pill on the employee profile and the
-- Team table, and for Home's anniversary list. Nullable on purpose: the previous app version
-- saves whole lists and PostgREST writes NULL for keys a row lacks. When a date is set, the app
-- also writes its year into start_year, so everything that reads the year keeps working.
-- ============================================================================

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS hire_date date;

NOTIFY pgrst, 'reload schema';
