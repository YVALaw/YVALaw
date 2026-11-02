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
  how text;
BEGIN
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
        'Payment received: $' || to_char(NEW.amount, 'FM999,999,990.00'), 'Paid ' || how || ' through Stripe.', '/invoice');
    ELSIF NEW.kind = 'refund' THEN
      PERFORM private.notify_permission('payments.record', 'payment_refunded',
        'Refund: $' || to_char(-NEW.amount, 'FM999,999,990.00'), 'A Stripe payment was refunded; the invoice balance was updated.', '/invoice');
    ELSE
      PERFORM private.notify_permission('payments.record', 'payment_disputed',
        'Dispute: $' || to_char(-NEW.amount, 'FM999,999,990.00') || ' taken back', 'The client''s bank took the money back while a dispute is open. Answer it in Stripe.', '/invoice');
    END IF;
  END IF;
  RETURN NULL;
END
$$;

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
