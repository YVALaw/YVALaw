-- CC emails (2026-11, same as the old CRM's contact-email-cc.sql):
--   clients.cc_emails          "Invoice CC" — copied on invoice emails, payment reminders and quick invoices
--   employees.cc_emails        "Statement CC" — copied on earnings statement emails
--   invoices.client_cc_emails  who was copied when the invoice was saved (client Invoice CC + contacts marked
--                              "Gets invoices"); emails for an invoice without it use the client's current list
-- Idempotent; nullable columns only (older app versions save whole lists and must keep working).
-- RLS: unchanged — the columns follow the existing policies on each table. Audit triggers record changes as usual.
-- The app works before this runs: the CC fields say this script is needed and saves leave the lists out.

ALTER TABLE public.clients   ADD COLUMN IF NOT EXISTS cc_emails        text[];
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS cc_emails        text[];
ALTER TABLE public.invoices  ADD COLUMN IF NOT EXISTS client_cc_emails text[];

COMMENT ON COLUMN public.clients.cc_emails          IS 'Invoice CC: copied on invoice emails and payment reminders';
COMMENT ON COLUMN public.employees.cc_emails        IS 'Statement CC: copied on earnings statement emails';
COMMENT ON COLUMN public.invoices.client_cc_emails  IS 'Cc list fixed when the invoice was saved (client Invoice CC + billing contacts)';

NOTIFY pgrst, 'reload schema';
