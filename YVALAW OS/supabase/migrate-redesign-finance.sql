-- Redesign 2026-11 (Finance hub): receipts on general expenses.
-- Idempotent; nullable columns only (older app versions save whole lists and must keep working).
-- RLS: unchanged — the columns follow the existing policies on public.expenses. Files go to the existing
-- `attachments` bucket under expenses/<expense id>/… with the existing authenticated upload/read/delete policies.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS receipt_url  text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS receipt_path text;

COMMENT ON COLUMN public.expenses.receipt_url  IS 'Receipt file URL (attachments bucket), set from Finance → Expenses';
COMMENT ON COLUMN public.expenses.receipt_path IS 'Storage path of the receipt, used to delete or replace it';

NOTIFY pgrst, 'reload schema';
