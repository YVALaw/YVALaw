-- 2026-11: repeating expenses + Stripe fees. Safe to run more than once. Run after migrate-stripe-secure.sql.
--
-- 1. Repeating expenses (Finance → Expenses → "Repeats"):
--    expenses.recurrence          'weekly' | 'monthly' | 'yearly' on the FIRST entry of a series (NULL = not a series)
--    expenses.recurrence_end      last day a copy may fall on (NULL = keeps going; "Stop" sets it to today)
--    expenses.recurrence_through  date of the last copy added (only moves forward — trigger below)
--    expenses.series_id/_period   on each copy: the first entry's id + the period ('YYYY-MM' / 'YYYY' / the date)
--    UNIQUE (series_id, series_period): a copy can never be added twice (two windows, reloads, the daily
--    `expenses-recurring` function all running at once). A BEFORE INSERT trigger skips copies on or before the
--    series' recurrence_through (a deleted copy never comes back), after its end date, or of a series that was
--    deleted / no longer repeats. Copies stay ordinary expense rows: edit or delete each one on its own.
-- 2. Stripe fees: client_payments.stripe_fee + net_amount, filled by the stripe-webhook (balance transaction)
--    and the CEO's "Fill missing fees" (stripe-fees function). Only Stripe rows may carry them.
-- All new columns are nullable. Old tables may have text ids: ids are compared as text.

-- ── 1. Repeating expenses ───────────────────────────────────────────────────
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category           text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recurring          boolean;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recurrence         text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recurrence_end     date;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS recurrence_through date;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS series_id          text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS series_period      text;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_recurrence_kind;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_recurrence_kind
  CHECK (recurrence IS NULL OR recurrence IN ('weekly', 'monthly', 'yearly')) NOT VALID;
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_series_pair;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_series_pair
  CHECK ((series_id IS NULL) = (series_period IS NULL)) NOT VALID;

-- Plain (not partial) unique index so PostgREST's on_conflict=series_id,series_period can use it; NULLs never clash
CREATE UNIQUE INDEX IF NOT EXISTS expenses_series_period ON public.expenses (series_id, series_period);
-- The daily function's one read: series rows only
CREATE INDEX IF NOT EXISTS expenses_series_rows ON public.expenses (id) WHERE recurrence IS NOT NULL;

COMMENT ON COLUMN public.expenses.recurrence IS 'Repeats: weekly / monthly / yearly (first entry of a series). Copies are added by expenses-recurring + the Expenses page.';
COMMENT ON COLUMN public.expenses.recurrence_through IS 'Date of the last copy added; copies on or before it are refused (a deleted copy never comes back).';
COMMENT ON COLUMN public.expenses.series_id IS 'On a copy: id of the series'' first entry (text, works with uuid or text ids).';

CREATE OR REPLACE FUNCTION private.expense_series_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s_rec  text;
  s_end  date;
  s_last date;
  s_date text;
  d      date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- "Last copy added" only moves forward (a stale screen can't send it back and re-add deleted copies)
    IF OLD.recurrence_through IS NOT NULL AND (NEW.recurrence_through IS NULL OR NEW.recurrence_through < OLD.recurrence_through) THEN
      NEW.recurrence_through := OLD.recurrence_through;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.series_id IS NULL THEN RETURN NEW; END IF;
  -- An upsert of a copy that already exists is an update of that copy, not a new copy
  IF EXISTS (SELECT 1 FROM public.expenses WHERE id::text = NEW.id::text) THEN RETURN NEW; END IF;

  SELECT recurrence, recurrence_end, recurrence_through, date::text INTO s_rec, s_end, s_last, s_date
    FROM public.expenses WHERE id::text = NEW.series_id::text;
  IF NOT FOUND OR s_rec IS NULL THEN RETURN NULL; END IF;              -- series deleted or no longer repeats
  IF NEW.date::text !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN NULL; END IF;
  d := left(NEW.date::text, 10)::date;
  IF s_last IS NULL AND s_date ~ '^\d{4}-\d{2}-\d{2}' THEN s_last := left(s_date, 10)::date; END IF;
  IF s_end IS NOT NULL AND d > s_end THEN RETURN NULL; END IF;         -- stopped
  IF s_last IS NOT NULL AND d <= s_last THEN RETURN NULL; END IF;      -- already added (or deleted on purpose)
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION private.expense_series_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS expenses_series_guard_insert ON public.expenses;
CREATE TRIGGER expenses_series_guard_insert BEFORE INSERT ON public.expenses
  FOR EACH ROW WHEN (NEW.series_id IS NOT NULL) EXECUTE FUNCTION private.expense_series_guard();
DROP TRIGGER IF EXISTS expenses_series_guard_update ON public.expenses;
CREATE TRIGGER expenses_series_guard_update BEFORE UPDATE OF recurrence_through ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION private.expense_series_guard();

-- ── 2. Stripe fees on client payments ───────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.client_payments') IS NULL THEN
    RAISE NOTICE 'client_payments does not exist yet (run migrate-step4-weekly-close.sql + migrate-stripe-secure.sql, then this again) — fees skipped';
    RETURN;
  END IF;
  ALTER TABLE public.client_payments ADD COLUMN IF NOT EXISTS stripe_fee numeric(12, 2);
  ALTER TABLE public.client_payments ADD COLUMN IF NOT EXISTS net_amount numeric(12, 2);
  COMMENT ON COLUMN public.client_payments.stripe_fee IS 'What Stripe kept from this payment (card / bank fee, USD). Refunds don''t return it.';
  COMMENT ON COLUMN public.client_payments.net_amount IS 'What reached the Stripe balance (amount - fee), from the balance transaction.';
  ALTER TABLE public.client_payments DROP CONSTRAINT IF EXISTS client_payments_fee_stripe_only;
  ALTER TABLE public.client_payments ADD CONSTRAINT client_payments_fee_stripe_only
    CHECK ((stripe_fee IS NULL AND net_amount IS NULL) OR (source = 'stripe' AND coalesce(stripe_fee, 0) >= 0)) NOT VALID;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_payments' AND column_name = 'kind') THEN
    -- "Fill missing fees" reads only these rows
    CREATE INDEX IF NOT EXISTS client_payments_fee_missing ON public.client_payments (paid_on)
      WHERE source = 'stripe' AND kind = 'payment' AND stripe_fee IS NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
