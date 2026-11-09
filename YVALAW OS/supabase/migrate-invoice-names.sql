-- ============================================================
-- YVA OS — Weekly-close invoices numbered after the company, not the contact person (2026-11)
-- ============================================================
-- Run in the Supabase SQL Editor after migrate-step4-weekly-close.sql. Safe to run more than once.
--
-- Clients often have a contact person as their name ("Sean Mahbobian-Fard") and the firm in
-- "Company / legal name" ("Top Law Assist"). Invoice numbers were made from the first 3 letters of the
-- name (SEA-0001). Now:
--   1. private.client_billing_name(client) = the company ("Company / legal name"), else the client's name.
--      (The weekly close also writes this name on the invoice.)
--   2. next_client_invoice_number() makes a new client's prefix from that name (TOP-0001).
--   3. One-time fix: a prefix that was made from the contact's name is changed to the new one, but only when
--      no sent / paid invoice uses it yet (numbers on invoices clients have seen never change). Press
--      "Re-prepare" on Weekly close afterwards: drafts get numbers with the new prefix.
-- A prefix you typed yourself (not made from the name) is left alone.
-- 4. Staff previewing a client's portal also see the invoices made out to its company.
-- ============================================================

CREATE OR REPLACE FUNCTION private.client_billing_name(p_client text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id::text = p_client;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- to_jsonb: works even if the company column is missing
  RETURN coalesce(nullif(trim(to_jsonb(c) ->> 'company'), ''), nullif(trim(c.name), ''), 'INV');
END
$$;

/** First 3 letters/digits of a name, upper case; 'INV' when there are none */
CREATE OR REPLACE FUNCTION private.invoice_prefix_base(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT coalesce(nullif(upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'), 3)), ''), 'INV') $$;

/** A prefix from the base that no other client uses (TOP, TOP2, TOP3…) */
CREATE OR REPLACE FUNCTION private.free_invoice_prefix(p_client text, p_base text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text := p_base;
  n      integer := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.clients WHERE upper(invoice_prefix) = prefix AND id::text <> p_client) LOOP
    n := n + 1; prefix := p_base || n;
  END LOOP;
  RETURN prefix;
END
$$;

CREATE OR REPLACE FUNCTION public.next_client_invoice_number(p_client uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        record;
  prefix   text;
  seq      integer;
  existing integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.has_permission('weekly_close.manage') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.clients WHERE id::text = p_client::text FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;

  prefix := upper(nullif(trim(c.invoice_prefix), ''));
  IF prefix IS NULL THEN
    prefix := private.free_invoice_prefix(p_client::text, private.invoice_prefix_base(private.client_billing_name(p_client::text)));
    UPDATE public.clients SET invoice_prefix = prefix WHERE id::text = p_client::text;
  END IF;

  -- Never reuse a number already on an invoice (counters can drift)
  SELECT coalesce(max((regexp_match(number, '^' || prefix || '-(\d+)$'))[1]::integer), 0) INTO existing
  FROM public.invoices WHERE number ~ ('^' || prefix || '-\d+$');
  seq := greatest(coalesce(c.next_invoice_seq, 1), existing + 1);
  UPDATE public.clients SET next_invoice_seq = seq + 1 WHERE id::text = p_client::text;
  RETURN prefix || '-' || lpad(seq::text, 4, '0');
END
$$;
REVOKE ALL ON FUNCTION public.next_client_invoice_number(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_client_invoice_number(uuid) TO authenticated, service_role;

-- Portal preview by staff: invoices were found by the client's name only. Weekly-close invoices now carry the company
-- name, so also match invoices whose client_id is the client with that name. (Same as the step-4 version otherwise;
-- portal clients themselves are matched by client_id and are unaffected.)
CREATE OR REPLACE FUNCTION public.portal_invoices(p_client_name text DEFAULT NULL)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (to_jsonb(i) - 'employee_payments')
         || jsonb_build_object('items', CASE WHEN jsonb_typeof(to_jsonb(i) -> 'items') = 'array' THEN
              coalesce((SELECT jsonb_agg(CASE WHEN jsonb_typeof(it) = 'object'
                                              THEN it - 'basePayRate' - 'totalPay' - 'payRate' - 'payAmount'
                                              ELSE it END ORDER BY n)
                        FROM jsonb_array_elements(to_jsonb(i) -> 'items') WITH ORDINALITY AS x(it, n)), '[]'::jsonb)
              ELSE '[]'::jsonb END)
  FROM public.invoices i
  WHERE coalesce(i.status, 'draft') <> 'draft'
    AND (
      (private.is_portal_client()
       AND (i.client_id::text = private.portal_client_id()::text
            OR i.client_name = (SELECT c.name FROM public.clients c WHERE c.id::text = private.portal_client_id()::text LIMIT 1)))
      OR (private.is_internal() AND p_client_name IS NOT NULL
          AND (i.client_name = p_client_name
               OR i.client_id::text IN (SELECT c.id::text FROM public.clients c WHERE c.name = p_client_name)))
    )
  ORDER BY i.date DESC NULLS LAST
$$;
REVOKE ALL ON FUNCTION public.portal_invoices(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_invoices(text) TO authenticated;

-- ── One-time fix of prefixes made from the contact's name ───────────────────
DO $$
DECLARE
  c        record;
  old_base text;
  new_base text;
  newp     text;
BEGIN
  FOR c IN SELECT id::text AS id, name, invoice_prefix FROM public.clients WHERE nullif(trim(invoice_prefix), '') IS NOT NULL LOOP
    old_base := private.invoice_prefix_base(c.name);
    new_base := private.invoice_prefix_base(private.client_billing_name(c.id));
    CONTINUE WHEN new_base = old_base;                                              -- nothing to change
    CONTINUE WHEN upper(c.invoice_prefix) !~ ('^' || old_base || '[0-9]*$');        -- a prefix someone chose: keep
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.invoices i                           -- already on an invoice a client saw
                          WHERE i.number ~ ('^' || upper(c.invoice_prefix) || '-\d+$') AND coalesce(i.status, 'draft') <> 'draft');
    newp := private.free_invoice_prefix(c.id, new_base);
    UPDATE public.clients SET invoice_prefix = newp, next_invoice_seq = 1 WHERE id::text = c.id;
    RAISE NOTICE 'Client %: invoice prefix % → % (press Prepare again on Weekly close to renumber its drafts)', c.name, c.invoice_prefix, newp;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';

-- Check: each client's invoice name and prefix
SELECT c.name AS client, private.client_billing_name(c.id::text) AS invoices_made_out_to, c.invoice_prefix AS prefix
FROM public.clients c ORDER BY c.name;
