-- ============================================================
-- YVA OS — Portal invoices lockdown (review fix, 2026-10-31)
-- ============================================================
-- Invoice items store each person's pay rate and pay total (needed for payroll). The
-- "portal_client_invoices" policy let a logged-in portal client read whole invoice rows straight
-- from the API, so they could see what YVA pays each person. The portal now reads invoices
-- through public.portal_invoices() (created by migrate-step4-weekly-close.sql), which removes
-- the pay fields.
--
-- Run in the Supabase SQL Editor AFTER the new app version is live (before that, the old portal
-- still reads invoices directly and would show no invoices). Safe to run more than once.
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.portal_invoices(text)') IS NULL THEN
    RAISE EXCEPTION 'Run migrate-step4-weekly-close.sql first (it creates portal_invoices)';
  END IF;
END $$;

DROP POLICY IF EXISTS "portal_client_invoices" ON public.invoices;

NOTIFY pgrst, 'reload schema';

-- Result check: no portal policy should remain on invoices
SELECT policyname, cmd FROM pg_policies
WHERE  schemaname = 'public' AND tablename = 'invoices'
ORDER  BY policyname;
