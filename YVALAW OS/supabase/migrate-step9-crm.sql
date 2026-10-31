-- ============================================================
-- YVA OS — Step 9: CRM (PLAN.md)
-- ============================================================
-- Run after migrate-step7-workspace.sql. Safe to run more than once.
--
--   leads           captured automatically from the website booking forms (lead-intake function)
--                   or added by hand; pipeline new → contacted → meeting → proposal → won / lost;
--                   an owner per lead (ready for a lead-gen hire). Won = client + project in one click.
--   lead_activities notes, calls, emails, meetings, WhatsApp, and follow-ups with a due date
--                   (the daily crm-followups job reminds the owner).
--   contacts        people at each client firm (role, email, phone, WhatsApp).
--   candidates      + staff_request_id: a client's staff request becomes an opening with its own candidates.
-- Visibility: leads.view_all sees every lead; everyone else sees leads they own. leads.manage
-- assigns, converts and deletes. New website leads notify leads.manage holders.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  email          text,
  phone          text,
  company        text,
  website        text,
  service        text,
  message        text,
  source         text,                      -- page or channel, e.g. "Home page", "Legal Intake landing page", "Referral"
  utm            jsonb NOT NULL DEFAULT '{}'::jsonb,
  sms_consent    boolean NOT NULL DEFAULT false,
  calendly_booked boolean NOT NULL DEFAULT false,
  stage          text NOT NULL DEFAULT 'new',
  owner_id       uuid,
  value_monthly  numeric(12, 2),
  next_follow_up date,
  lost_reason    text,
  client_id      uuid,
  project_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_stage CHECK (stage IN ('new', 'contacted', 'meeting', 'proposal', 'won', 'lost')),
  CONSTRAINT leads_name  CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT leads_lengths CHECK (coalesce(length(message), 0) <= 5000 AND coalesce(length(email), 0) <= 254 AND coalesce(length(phone), 0) <= 50)
);
CREATE INDEX IF NOT EXISTS leads_stage ON public.leads (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_email ON public.leads (lower(email));
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leads_read"   ON public.leads;
DROP POLICY IF EXISTS "leads_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_update" ON public.leads;
DROP POLICY IF EXISTS "leads_delete" ON public.leads;
CREATE POLICY "leads_read" ON public.leads FOR SELECT TO authenticated
  USING (private.is_internal() AND (private.has_permission('leads.view_all') OR owner_id = auth.uid()));
CREATE POLICY "leads_insert" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (private.is_internal() AND (private.has_permission('leads.manage') OR owner_id = auth.uid()));
CREATE POLICY "leads_update" ON public.leads FOR UPDATE TO authenticated
  USING (private.is_internal() AND (private.has_permission('leads.manage') OR owner_id = auth.uid()))
  WITH CHECK (private.is_internal() AND (private.has_permission('leads.manage') OR owner_id = auth.uid()));
CREATE POLICY "leads_delete" ON public.leads FOR DELETE TO authenticated USING (private.has_permission('leads.manage'));

-- Owners can't hand a lead to someone else (only leads.manage assigns)
-- SECURITY DEFINER: the website's lead-intake function (service role) also writes leads
CREATE OR REPLACE FUNCTION private.leads_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id AND auth.uid() IS NOT NULL
     AND NOT private.has_permission('leads.manage') THEN
    RAISE EXCEPTION 'Only people who manage leads can reassign them' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS leads_before_write ON public.leads;
CREATE TRIGGER leads_before_write BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION private.leads_before_write();

CREATE OR REPLACE FUNCTION private.leads_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.notify_permission('leads.manage', 'lead_new',
      'New lead: ' || NEW.name || coalesce(' (' || nullif(NEW.company, '') || ')', ''),
      concat_ws(' · ', nullif(NEW.service, ''), nullif(NEW.source, ''), nullif(NEW.email, ''), nullif(NEW.phone, '')), '/leads');
    IF NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM auth.uid() THEN
      PERFORM private.notify_user(NEW.owner_id, 'lead_new', 'A lead was assigned to you: ' || NEW.name, NEW.service, '/leads');
    END IF;
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM auth.uid() THEN
    PERFORM private.notify_user(NEW.owner_id, 'lead_new', 'A lead was assigned to you: ' || NEW.name, NEW.service, '/leads');
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS leads_notify ON public.leads;
CREATE TRIGGER leads_notify AFTER INSERT OR UPDATE OF owner_id ON public.leads FOR EACH ROW EXECUTE FUNCTION private.leads_notify();

-- ── Activities + follow-ups ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_activities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'note',
  body       text NOT NULL,
  due_on     date,                         -- follow-up date (kind = 'follow_up')
  done_at    timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_activities_kind CHECK (kind IN ('note', 'call', 'email', 'meeting', 'whatsapp', 'follow_up', 'system')),
  CONSTRAINT lead_activities_body CHECK (length(body) BETWEEN 1 AND 4000)
);
CREATE INDEX IF NOT EXISTS lead_activities_lead ON public.lead_activities (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lead_activities_due  ON public.lead_activities (due_on) WHERE done_at IS NULL;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_activities_rw" ON public.lead_activities;
CREATE POLICY "lead_activities_rw" ON public.lead_activities FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id))          -- visible when the lead is (leads RLS applies)
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id));

-- ── Contacts at client firms ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL,
  name       text NOT NULL,
  role       text,
  email      text,
  phone      text,
  whatsapp   text,
  is_billing boolean NOT NULL DEFAULT false,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_name CHECK (length(name) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS contacts_client ON public.contacts (client_id);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contacts_staff" ON public.contacts;
CREATE POLICY "contacts_staff" ON public.contacts FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

-- ── Openings: candidates for a client's staff request ───────────────────────
DO $$
BEGIN
  IF to_regclass('public.candidates') IS NOT NULL THEN
    ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS staff_request_id uuid;
  END IF;
END $$;

-- ── History ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'contacts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_row()', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT c.relname AS item, CASE WHEN c.relrowsecurity THEN 'RLS on' ELSE 'RLS OFF' END AS status
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('leads', 'lead_activities', 'contacts')
ORDER BY 1;
