-- ============================================================
-- YVA OS — Step 7: My workspace (PLAN.md)
-- ============================================================
-- Run after migrate-step6-payroll.sql. Safe to run more than once.
--
--   time_off_requests   employees ask for vacation / sick / personal days; people with
--                       timeoff.approve decide (both sides get notified). Approved days are not
--                       flagged as "No time" (Schedule, weekly close).
--   announcements       company news shown in My workspace → Company (all / client team / YVA team);
--                       publishing notifies the employees it's for.
--   holidays            company holidays (My workspace → Company).
--   employee_documents  files for an employee (contract, handbook…) in the private
--                       "employee-documents" bucket; the employee sees only their own.
--   projects            + supervisor_name / supervisor_email / supervisor_phone / employee_instructions
--                       (My workspace → My client; shown to the employees on that project).
-- Permissions: timeoff.approve, announcements.manage, documents.manage.
-- ============================================================

-- ── Time off ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.time_off_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL DEFAULT private.current_employee_id(),
  kind          text NOT NULL DEFAULT 'vacation',
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  half_day      boolean NOT NULL DEFAULT false,
  note          text,
  status        text NOT NULL DEFAULT 'pending',
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_kind   CHECK (kind IN ('vacation', 'sick', 'personal', 'other')),
  CONSTRAINT time_off_status CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  CONSTRAINT time_off_dates  CHECK (end_date >= start_date AND end_date - start_date <= 60),
  CONSTRAINT time_off_note   CHECK (note IS NULL OR length(note) <= 500)
);
CREATE INDEX IF NOT EXISTS time_off_employee ON public.time_off_requests (employee_id, start_date);
ALTER TABLE public.time_off_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_off_own_read"     ON public.time_off_requests;
DROP POLICY IF EXISTS "time_off_own_insert"   ON public.time_off_requests;
DROP POLICY IF EXISTS "time_off_own_cancel"   ON public.time_off_requests;
DROP POLICY IF EXISTS "time_off_staff_read"   ON public.time_off_requests;
DROP POLICY IF EXISTS "time_off_decide"       ON public.time_off_requests;
CREATE POLICY "time_off_own_read" ON public.time_off_requests
  FOR SELECT TO authenticated USING (employee_id = private.current_employee_id());
CREATE POLICY "time_off_own_insert" ON public.time_off_requests
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = private.current_employee_id() AND status = 'pending' AND decided_by IS NULL AND decided_at IS NULL
              AND start_date >= current_date - 30);
CREATE POLICY "time_off_own_cancel" ON public.time_off_requests
  FOR UPDATE TO authenticated
  USING (employee_id = private.current_employee_id() AND status = 'pending')
  WITH CHECK (employee_id = private.current_employee_id() AND status = 'cancelled');
CREATE POLICY "time_off_staff_read" ON public.time_off_requests
  FOR SELECT TO authenticated USING (private.is_internal());
CREATE POLICY "time_off_decide" ON public.time_off_requests
  FOR UPDATE TO authenticated
  USING (private.has_permission('timeoff.approve'))
  WITH CHECK (private.has_permission('timeoff.approve'));

CREATE OR REPLACE FUNCTION private.time_off_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e record;
  span text := to_char(NEW.start_date, 'Mon DD') || CASE WHEN NEW.end_date <> NEW.start_date THEN ' – ' || to_char(NEW.end_date, 'Mon DD') ELSE '' END;
BEGIN
  SELECT name, user_id INTO e FROM public.employees WHERE id = NEW.employee_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.notify_permission('timeoff.approve', 'timeoff_request', coalesce(e.name, 'Someone') || ' asked for time off: ' || span,
      initcap(NEW.kind) || coalesce(' — ' || NEW.note, ''), '/approvals');
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'declined') THEN
    PERFORM private.notify_user(e.user_id, 'timeoff_decision',
      CASE WHEN NEW.status = 'approved' THEN 'Time off approved — Días libres aprobados: ' ELSE 'Time off declined — Días libres rechazados: ' END || span,
      NEW.decision_note, '/me?s=requests');
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS time_off_notify ON public.time_off_requests;
CREATE TRIGGER time_off_notify AFTER INSERT OR UPDATE OF status ON public.time_off_requests
  FOR EACH ROW EXECUTE FUNCTION private.time_off_notify();

-- Decisions record who/when (server time)
CREATE OR REPLACE FUNCTION private.time_off_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'declined') THEN
    NEW.decided_at := now();
    NEW.decided_by := auth.uid();
  ELSIF NOT private.has_permission('timeoff.approve') THEN
    -- the employee cancelling their own request can't write a decision
    NEW.decided_at := OLD.decided_at; NEW.decided_by := OLD.decided_by; NEW.decision_note := OLD.decision_note;
  END IF;
  -- nothing but the status (and a decision note) changes after the request is made
  NEW.employee_id := OLD.employee_id; NEW.kind := OLD.kind; NEW.start_date := OLD.start_date; NEW.end_date := OLD.end_date;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS time_off_before_update ON public.time_off_requests;
CREATE TRIGGER time_off_before_update BEFORE UPDATE ON public.time_off_requests
  FOR EACH ROW EXECUTE FUNCTION private.time_off_before_update();

-- ── Announcements + holidays ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  audience     text NOT NULL DEFAULT 'all',
  pinned       boolean NOT NULL DEFAULT false,
  published_at timestamptz DEFAULT now(),          -- NULL = draft
  created_by   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_audience CHECK (audience IN ('all', 'client', 'yva')),
  CONSTRAINT announcements_title    CHECK (length(title) BETWEEN 2 AND 160),
  CONSTRAINT announcements_body     CHECK (length(body) <= 5000)
);
CREATE TABLE IF NOT EXISTS public.holidays (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day   date NOT NULL UNIQUE,
  name  text NOT NULL,
  paid  boolean NOT NULL DEFAULT true,
  CONSTRAINT holidays_name CHECK (length(name) BETWEEN 2 AND 120)
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.current_employee_works_for()
RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$ SELECT coalesce(works_for, 'client') FROM public.employees WHERE user_id = auth.uid() LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION private.current_employee_works_for() TO authenticated;

DROP POLICY IF EXISTS "announcements_read"   ON public.announcements;
DROP POLICY IF EXISTS "announcements_manage" ON public.announcements;
CREATE POLICY "announcements_read" ON public.announcements
  FOR SELECT TO authenticated
  USING (private.is_internal()
         OR (private.current_employee_id() IS NOT NULL AND published_at <= now()
             AND audience IN ('all', private.current_employee_works_for())));
CREATE POLICY "announcements_manage" ON public.announcements
  FOR ALL TO authenticated USING (private.has_permission('announcements.manage')) WITH CHECK (private.has_permission('announcements.manage'));

DROP POLICY IF EXISTS "holidays_read"   ON public.holidays;
DROP POLICY IF EXISTS "holidays_manage" ON public.holidays;
CREATE POLICY "holidays_read" ON public.holidays
  FOR SELECT TO authenticated USING (private.is_internal() OR private.current_employee_id() IS NOT NULL);
CREATE POLICY "holidays_manage" ON public.holidays
  FOR ALL TO authenticated USING (private.has_permission('announcements.manage')) WITH CHECK (private.has_permission('announcements.manage'));

CREATE OR REPLACE FUNCTION private.announcement_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.published_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL) THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    SELECT e.user_id, 'announcement', left(NEW.title, 200), left(NEW.body, 300), '/me?s=company'
    FROM public.employees e
    WHERE e.user_id IS NOT NULL AND coalesce(lower(e.status), '') NOT IN ('inactive', 'terminated')
      AND (NEW.audience = 'all' OR coalesce(e.works_for, 'client') = NEW.audience);
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS announcements_notify ON public.announcements;
CREATE TRIGGER announcements_notify AFTER INSERT OR UPDATE OF published_at ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION private.announcement_notify();

-- ── Employee documents (private bucket) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL,
  title        text NOT NULL,
  category     text NOT NULL DEFAULT 'other',
  storage_path text NOT NULL UNIQUE,
  size_bytes   bigint,
  mime_type    text,
  uploaded_by  uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_documents_category CHECK (category IN ('contract', 'policy', 'tax', 'id', 'other')),
  CONSTRAINT employee_documents_path CHECK (storage_path LIKE employee_id::text || '/%')
);
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_documents_own"    ON public.employee_documents;
DROP POLICY IF EXISTS "employee_documents_manage" ON public.employee_documents;
CREATE POLICY "employee_documents_own" ON public.employee_documents
  FOR SELECT TO authenticated USING (employee_id = private.current_employee_id());
CREATE POLICY "employee_documents_manage" ON public.employee_documents
  FOR ALL TO authenticated USING (private.has_permission('documents.manage')) WITH CHECK (private.has_permission('documents.manage'));

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('employee-documents', 'employee-documents', false, 20971520)
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

    DROP POLICY IF EXISTS "employee_docs_own_read"     ON storage.objects;
    DROP POLICY IF EXISTS "employee_docs_manage_all"   ON storage.objects;
    CREATE POLICY "employee_docs_own_read" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'employee-documents' AND (storage.foldername(name))[1] = private.current_employee_id()::text);
    CREATE POLICY "employee_docs_manage_all" ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'employee-documents' AND private.has_permission('documents.manage'))
      WITH CHECK (bucket_id = 'employee-documents' AND private.has_permission('documents.manage'));
  END IF;
END $$;

-- ── My client: supervisor + instructions on the project ─────────────────────
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS supervisor_name text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS supervisor_email text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS supervisor_phone text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS employee_instructions text;

-- ── History ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_off_requests', 'announcements', 'holidays', 'employee_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.audit_row()', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT c.relname AS item, CASE WHEN c.relrowsecurity THEN 'RLS on' ELSE 'RLS OFF' END AS status
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('time_off_requests', 'announcements', 'holidays', 'employee_documents')
ORDER BY 1;
