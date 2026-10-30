-- ============================================================
-- YVA LawOS — Portal employees lockdown (2026-10-30)
-- ============================================================
-- The "portal_client_employees" policy let a logged-in portal client SELECT
-- every column of the employees placed on their projects (pay rate, internal
-- notes, premium settings, attachments) straight from the API — a row policy
-- can't hide columns. The portal now loads its team through the portal-team
-- Netlify function, which returns client-safe fields only.
--
-- Run in the Supabase SQL Editor AFTER the app version with portal-team is
-- deployed (before that, the old portal still reads employees directly and
-- would show an empty team). Safe to run more than once.
-- ============================================================

DROP POLICY IF EXISTS "portal_client_employees" ON employees;

NOTIFY pgrst, 'reload schema';

-- Result check: only staff policies should remain on employees
SELECT policyname, cmd FROM pg_policies
WHERE  schemaname = 'public' AND tablename = 'employees'
ORDER  BY policyname;
