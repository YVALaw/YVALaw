-- ============================================================================
-- Stripe — secure payments (2026-11). Safe to run more than once. Run after the step scripts
-- (needs client-portal.sql, migrate-step1-foundation.sql and migrate-step4-weekly-close.sql).
--
--   stripe_events        every webhook event Stripe sent, once (a retry of the same event is ignored;
--                        an event whose processing failed is processed again on Stripe's retry)
--   client_payments      + kind (payment / refund / dispute) and stripe_charge_id. Refunds and lost disputes
--                        are negative rows, so the invoice's amount paid and status follow automatically.
--                        Card / bank payments recorded by Stripe can't be edited or deleted from the app
--                        (deleting one would reopen a paid invoice and AutoPay could charge it again).
--   payment_attempts     read-only from the app (written only by the payment functions), + payment method
--                        type, pay-link source, AutoPay retry count
--   client_users         + saved method type / bank name, AutoPay failure count
--   invoices             once an invoice has recorded payments, its amount paid IS their sum and its status follows
--                        (paid / partial / back to sent) — a status edit or a whole-list save can no longer wipe the
--                        amount paid and make a paid invoice payable (and chargeable by AutoPay) again. Amounts paid
--                        before payments were recorded one by one are kept as one "earlier payments" row.
-- Re-run this script after re-running migrate-step4-weekly-close.sql.
-- ============================================================================

-- ── 1. Webhook events (each processed once) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id           text PRIMARY KEY,               -- evt_…
  type         text NOT NULL,
  livemode     boolean NOT NULL DEFAULT false,
  object_id    text,                           -- pi_… / ch_… / seti_…
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text
);
CREATE INDEX IF NOT EXISTS stripe_events_received ON public.stripe_events (received_at DESC);
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stripe_events_read" ON public.stripe_events;
CREATE POLICY "stripe_events_read" ON public.stripe_events FOR SELECT TO authenticated
  USING (private.has_permission('payments.record'));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.stripe_events FROM authenticated, anon;

-- ── 2. Client payments: refunds and disputes ────────────────────────────────
ALTER TABLE public.client_payments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'payment';
ALTER TABLE public.client_payments ADD COLUMN IF NOT EXISTS stripe_charge_id text;
ALTER TABLE public.client_payments DROP CONSTRAINT IF EXISTS client_payments_kind;
ALTER TABLE public.client_payments ADD CONSTRAINT client_payments_kind CHECK (kind IN ('payment', 'refund', 'dispute'));
ALTER TABLE public.client_payments DROP CONSTRAINT IF EXISTS client_payments_amount;
ALTER TABLE public.client_payments ADD CONSTRAINT client_payments_amount
  CHECK ((kind = 'payment' AND amount > 0) OR (kind <> 'payment' AND amount < 0 AND source = 'stripe'));
CREATE INDEX IF NOT EXISTS client_payments_charge ON public.client_payments (stripe_charge_id) WHERE stripe_charge_id IS NOT NULL;

-- Staff record manual payments; Stripe's rows are written only by the webhook (service role)
DROP POLICY IF EXISTS "client_payments_write"  ON public.client_payments;
DROP POLICY IF EXISTS "client_payments_insert" ON public.client_payments;
DROP POLICY IF EXISTS "client_payments_update" ON public.client_payments;
DROP POLICY IF EXISTS "client_payments_delete" ON public.client_payments;
CREATE POLICY "client_payments_insert" ON public.client_payments FOR INSERT TO authenticated
  WITH CHECK (private.has_permission('payments.record') AND source = 'manual' AND kind = 'payment');
CREATE POLICY "client_payments_update" ON public.client_payments FOR UPDATE TO authenticated
  USING (private.has_permission('payments.record') AND source = 'manual')
  WITH CHECK (private.has_permission('payments.record') AND source = 'manual' AND kind = 'payment');
CREATE POLICY "client_payments_delete" ON public.client_payments FOR DELETE TO authenticated
  USING (private.has_permission('payments.record') AND source = 'manual');

-- The bell message says what actually happened
CREATE OR REPLACE FUNCTION private.client_payment_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  how  text;
  prev numeric;
BEGIN
  -- First payment row of an invoice that already showed an amount paid: keep that amount as an "earlier payments" row
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.client_payments WHERE invoice_id::text = NEW.invoice_id::text AND id <> NEW.id) THEN
    SELECT amount_paid INTO prev FROM public.invoices WHERE id::text = NEW.invoice_id::text;
    IF coalesce(prev, 0) > 0.005 THEN
      INSERT INTO public.client_payments (invoice_id, client_id, amount, method, source, kind, note, created_by, paid_on)
      VALUES (NEW.invoice_id, NEW.client_id, round(prev, 2), 'other', 'manual', 'payment',
              'Earlier payments (recorded before payments were tracked one by one)', NULL, current_date);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.client_payment_adjust(OLD.invoice_id, -OLD.amount);
  ELSIF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    PERFORM private.client_payment_adjust(OLD.invoice_id, -OLD.amount);
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount);
  ELSE
    PERFORM private.client_payment_adjust(NEW.invoice_id, NEW.amount - OLD.amount);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.source = 'stripe' THEN
    how := CASE NEW.method WHEN 'ach' THEN 'by bank (ACH)' ELSE 'by card' END;
    IF NEW.kind = 'payment' THEN
      PERFORM private.notify_permission('payments.record', 'payment_received',
        'Payment received: $' || to_char(NEW.amount, 'FM999,999,990.00'), 'Paid ' || how || ' through Stripe.', '/invoice?open=' || NEW.invoice_id::text);
    ELSIF NEW.kind = 'refund' THEN
      PERFORM private.notify_permission('payments.record', 'payment_refunded',
        'Refund: $' || to_char(-NEW.amount, 'FM999,999,990.00'), 'A Stripe payment was refunded; the invoice balance was updated.', '/invoice?open=' || NEW.invoice_id::text);
    ELSE
      PERFORM private.notify_permission('payments.record', 'payment_disputed',
        'Dispute: $' || to_char(-NEW.amount, 'FM999,999,990.00') || ' taken back', 'The client''s bank took the money back while a dispute is open. Answer it in Stripe.', '/invoice?open=' || NEW.invoice_id::text);
    END IF;
  END IF;
  RETURN NULL;
END
$$;

-- ── 2b. Amount paid = the sum of the invoice's payments ──────────────────────
-- Manual payment rows can't carry a Stripe reference (a hand-made row with a pi_… id would make the real Stripe
-- payment look like a duplicate and be skipped). NOT VALID: checked for new and changed rows.
ALTER TABLE public.client_payments DROP CONSTRAINT IF EXISTS client_payments_manual_refs;
ALTER TABLE public.client_payments ADD CONSTRAINT client_payments_manual_refs
  CHECK (source = 'stripe' OR (external_ref IS NULL AND stripe_charge_id IS NULL)) NOT VALID;

CREATE OR REPLACE FUNCTION private.invoice_paid_from_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n     integer;
  total numeric;
BEGIN
  SELECT count(*), coalesce(sum(amount), 0) INTO n, total FROM public.client_payments WHERE invoice_id::text = NEW.id::text;
  IF n = 0 THEN RETURN NEW; END IF;   -- no recorded payments: the invoice keeps what staff set
  NEW.amount_paid := greatest(0, round(total, 2));
  IF NEW.amount_paid > 0 AND NEW.amount_paid >= coalesce(NEW.subtotal, 0) - 0.005 THEN NEW.status := 'paid';
  ELSIF NEW.amount_paid > 0 THEN NEW.status := 'partial';
  ELSIF lower(coalesce(NEW.status, '')) IN ('paid', 'partial') THEN NEW.status := 'sent';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status_history IS NOT DISTINCT FROM OLD.status_history THEN
    NEW.status_history := coalesce(OLD.status_history, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('status', NEW.status, 'changedAt', (extract(epoch FROM now()) * 1000)::bigint));
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION private.invoice_paid_from_payments() FROM PUBLIC;
DROP TRIGGER IF EXISTS invoice_paid_from_payments ON public.invoices;
CREATE TRIGGER invoice_paid_from_payments BEFORE UPDATE OF amount_paid, status, subtotal ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.invoice_paid_from_payments();

-- A payment row changed: recompute the invoice (the trigger above does the sum)
CREATE OR REPLACE FUNCTION private.client_payment_adjust(inv_id uuid, delta numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF inv_id IS NULL THEN RETURN; END IF;
  UPDATE public.invoices SET amount_paid = amount_paid WHERE id::text = inv_id::text;
END
$$;
REVOKE ALL ON FUNCTION private.client_payment_adjust(uuid, numeric) FROM PUBLIC;

-- What invoices already show as paid beyond their payment rows (old CRM, the status window, the step-4 trigger that
-- added amounts) becomes one "earlier payments" row, so switching to sums changes no balance
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.id::text AS id, max(i.client_id::text) AS client_id, round(coalesce(max(i.amount_paid), 0) - coalesce(sum(p.amount), 0), 2) AS diff
    FROM public.invoices i JOIN public.client_payments p ON p.invoice_id::text = i.id::text
    WHERE i.id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    GROUP BY i.id
  LOOP
    IF r.diff > 0.005 THEN
      INSERT INTO public.client_payments (invoice_id, client_id, amount, method, source, kind, note, created_by, paid_on)
      VALUES (r.id::uuid, CASE WHEN r.client_id ~* '^[0-9a-f-]{36}$' THEN r.client_id::uuid END, r.diff, 'other', 'manual', 'payment',
              'Earlier payments (recorded before payments were tracked one by one)', NULL, current_date);
    END IF;
  END LOOP;
END $$;

-- ── 3. Payment attempts: written only by the payment functions ──────────────
ALTER TABLE public.payment_attempts ADD COLUMN IF NOT EXISTS payment_method_type text;
ALTER TABLE public.payment_attempts ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;
ALTER TABLE public.payment_attempts ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_source_check;
ALTER TABLE public.payment_attempts ADD CONSTRAINT payment_attempts_source_check CHECK (source IN ('portal', 'autopay', 'pay_link'));
DROP POLICY IF EXISTS "internal_all"  ON public.payment_attempts;
DROP POLICY IF EXISTS "internal_read" ON public.payment_attempts;
CREATE POLICY "internal_read" ON public.payment_attempts FOR SELECT TO authenticated USING (private.is_internal());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payment_attempts FROM authenticated, anon;

-- ── 4. Saved payment method (card or US bank account) ───────────────────────
ALTER TABLE public.client_users ADD COLUMN IF NOT EXISTS default_payment_method_type text;   -- card | us_bank_account
ALTER TABLE public.client_users ADD COLUMN IF NOT EXISTS default_bank_name text;
ALTER TABLE public.client_users ADD COLUMN IF NOT EXISTS autopay_failures integer NOT NULL DEFAULT 0;
ALTER TABLE public.client_users ADD COLUMN IF NOT EXISTS autopay_last_failed_at timestamptz;

NOTIFY pgrst, 'reload schema';
