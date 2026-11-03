-- ============================================================
-- YVA OS — One invoice covering several projects of the same client (2026-11)
-- ============================================================
-- Safe to run more than once. Run after migrate-step4-weekly-close.sql.
--
--   invoices.project_ids   every project the invoice covers, main project first (text[], NULL = only
--                          project_id, which is every older invoice). The main project stays in project_id /
--                          project_name, so lists, numbering and older app versions keep working; each invoice
--                          line also carries its own projectId / projectName inside items.
--
-- Nullable on purpose: older app versions save whole invoice lists and PostgREST writes NULL for keys a row
-- lacks. text[] because project ids are uuid in some databases and text in others.
-- No new table, no new policy: the existing invoice policies, the audit trigger, the change stamps
-- (data_versions) and public.portal_invoices() (to_jsonb of the row) all cover the new column.
-- ============================================================

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS project_ids text[];

COMMENT ON COLUMN public.invoices.project_ids IS
  'Multi-project invoices: every project the invoice bills (main project first). NULL = just project_id.';

NOTIFY pgrst, 'reload schema';
