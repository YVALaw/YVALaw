-- ============================================================
-- YVA Time — Phase 2: approvals, manual time, consent (2026-10-30)
-- ============================================================
-- Run in the Supabase SQL Editor after migrate-yva-time-phase1.sql. Safe to run more than once.
--
--   time_entries          + source ('manual' | 'tracker'), tracker_key (unique), approved_by/at.
--                         Approved tracker time is rolled up here — one row per employee,
--                         day and project/work type — so the client portal (hours only),
--                         the time log, invoices and payslips all read the same numbers.
--   tracker_blocks        unique key now includes source (desktop vs manual rows);
--                         the 600 s cap counts tracked + pending + approved time.
--   manual_time_requests  employees with manual_time_allowed ask for missing time;
--                         CEO/Admin/Accounting approve or reject.
--   tracker_consents      when an employee accepted the screenshot notice.
--
--   public.yva_time_rollup(employee, from, to, tz)            rebuild time_entries from approved blocks
--   public.yva_time_approve(employee, from, to, tz)           approve finished days + rollup
--   public.yva_time_decide_request(request, approve, note, tz)
-- The functions run with the caller's rights (SECURITY INVOKER, so RLS still applies)
-- and refuse anyone but CEO / Admin / Accounting.
-- ============================================================

-- ── 1. time_entries: where approved tracker time lands ──────────────────────

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS source      text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tracker_key text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS time_entries_source_check;
ALTER TABLE public.time_entries ADD CONSTRAINT time_entries_source_check CHECK (source IN ('manual', 'tracker'));
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_tracker_key ON public.time_entries (tracker_key);

-- ── 2. tracker_blocks: desktop and manual rows side by side ─────────────────

ALTER TABLE public.tracker_blocks DROP CONSTRAINT IF EXISTS tracker_blocks_unique_target;
ALTER TABLE public.tracker_blocks
  ADD CONSTRAINT tracker_blocks_unique_target UNIQUE (employee_id, block_start, target_key, source);

CREATE OR REPLACE FUNCTION private.tracker_blocks_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  other_seconds integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSE
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();

  IF NEW.status IN ('tracked', 'pending', 'approved') THEN
    SELECT COALESCE(SUM(seconds), 0) INTO other_seconds
    FROM   public.tracker_blocks
    WHERE  employee_id = NEW.employee_id
      AND  block_start = NEW.block_start
      AND  NOT (target_key = NEW.target_key AND source = NEW.source)
      AND  status IN ('tracked', 'pending', 'approved');
    IF other_seconds + NEW.seconds > 600 THEN
      RAISE EXCEPTION 'A 10-minute block cannot hold more than 600 seconds (has %, adding %)',
        other_seconds, NEW.seconds USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- ── 3. Helpers ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.current_employee_manual_allowed()
RETURNS boolean
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees
    WHERE user_id::text = auth.uid()::text AND manual_time_allowed IS TRUE
  )
$$;
GRANT EXECUTE ON FUNCTION private.current_employee_manual_allowed() TO authenticated;

CREATE OR REPLACE FUNCTION private.created_now()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END
$$;

-- ── 4. manual_time_requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_time_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid        NOT NULL,
  project_id       uuid,
  work_type        text,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  reason           text        NOT NULL,
  status           text        NOT NULL DEFAULT 'pending',
  approved_seconds integer,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_time_one_target CHECK ((project_id IS NOT NULL) <> (work_type IS NOT NULL)),
  CONSTRAINT manual_time_span   CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '12 hours'),
  CONSTRAINT manual_time_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT manual_time_reason CHECK (length(reason) BETWEEN 3 AND 500)
);
CREATE INDEX IF NOT EXISTS manual_time_requests_employee ON public.manual_time_requests (employee_id, starts_at);
CREATE INDEX IF NOT EXISTS manual_time_requests_status   ON public.manual_time_requests (status);

DROP TRIGGER IF EXISTS manual_time_requests_created ON public.manual_time_requests;
CREATE TRIGGER manual_time_requests_created
  BEFORE INSERT ON public.manual_time_requests
  FOR EACH ROW EXECUTE FUNCTION private.created_now();

ALTER TABLE public.manual_time_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "manual_time_staff_all"       ON public.manual_time_requests;
DROP POLICY IF EXISTS "manual_time_employee_read"   ON public.manual_time_requests;
DROP POLICY IF EXISTS "manual_time_employee_insert" ON public.manual_time_requests;
DROP POLICY IF EXISTS "manual_time_employee_cancel" ON public.manual_time_requests;

CREATE POLICY "manual_time_staff_all" ON public.manual_time_requests
  FOR ALL TO authenticated
  USING (private.is_internal()) WITH CHECK (private.is_internal());

CREATE POLICY "manual_time_employee_read" ON public.manual_time_requests
  FOR SELECT TO authenticated
  USING (employee_id = private.current_employee_id());

CREATE POLICY "manual_time_employee_insert" ON public.manual_time_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = private.current_employee_id()
    AND private.current_employee_manual_allowed()
    AND status = 'pending'
    AND approved_seconds IS NULL AND decided_by IS NULL AND decided_at IS NULL AND decision_note IS NULL
    AND starts_at >= now() - interval '14 days'
    AND ends_at   <= now() + interval '5 minutes'
    AND (
      (project_id IS NOT NULL AND private.employee_on_project(project_id))
      OR (work_type IS NOT NULL AND private.current_employee_is_yva())
    )
  );

CREATE POLICY "manual_time_employee_cancel" ON public.manual_time_requests
  FOR UPDATE TO authenticated
  USING (employee_id = private.current_employee_id() AND status = 'pending')
  WITH CHECK (employee_id = private.current_employee_id() AND status = 'cancelled' AND decided_by IS NULL);

-- ── 5. tracker_consents ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tracker_consents (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid        NOT NULL,
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tracker_consents_employee ON public.tracker_consents (employee_id, created_at);

DROP TRIGGER IF EXISTS tracker_consents_created ON public.tracker_consents;
CREATE TRIGGER tracker_consents_created
  BEFORE INSERT ON public.tracker_consents
  FOR EACH ROW EXECUTE FUNCTION private.created_now();

ALTER TABLE public.tracker_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracker_consents_staff_read"      ON public.tracker_consents;
DROP POLICY IF EXISTS "tracker_consents_employee_read"   ON public.tracker_consents;
DROP POLICY IF EXISTS "tracker_consents_employee_insert" ON public.tracker_consents;

CREATE POLICY "tracker_consents_staff_read" ON public.tracker_consents
  FOR SELECT TO authenticated USING (private.is_internal());

CREATE POLICY "tracker_consents_employee_read" ON public.tracker_consents
  FOR SELECT TO authenticated USING (employee_id = private.current_employee_id());

CREATE POLICY "tracker_consents_employee_insert" ON public.tracker_consents
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = private.current_employee_id() AND (app_version IS NULL OR length(app_version) <= 40));

-- ── 6. Approval functions (caller's rights; CEO / Admin / Accounting only) ───

CREATE OR REPLACE FUNCTION public.yva_time_rollup(p_employee uuid, p_from date, p_to date, p_tz text DEFAULT 'America/Santo_Domingo')
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  written integer;
BEGIN
  IF COALESCE(private.current_user_role(), '') NOT IN ('ceo', 'admin', 'accounting') THEN
    RAISE EXCEPTION 'Only CEO, Admin or Accounting can approve time' USING ERRCODE = '42501';
  END IF;

  WITH agg AS (
    SELECT (b.block_start AT TIME ZONE p_tz)::date AS day,
           b.target_key, b.project_id, b.work_type,
           SUM(b.seconds) AS secs,
           string_agg(DISTINCT b.note, '; ') AS notes
    FROM   public.tracker_blocks b
    WHERE  b.employee_id = p_employee
      AND  b.status = 'approved'
      AND  (b.block_start AT TIME ZONE p_tz)::date BETWEEN p_from AND p_to
    GROUP  BY 1, 2, 3, 4
    HAVING SUM(b.seconds) > 0
  ), up AS (
    INSERT INTO public.time_entries
      (employee_id, employee_name, project_id, project_name, client_name, date, hours, description,
       billable, invoiced, source, tracker_key, approved_by, approved_at)
    SELECT p_employee, e.name, a.project_id, p.name, c.name, a.day, ROUND(a.secs / 3600.0, 2),
           LEFT(concat_ws(' — ', a.work_type, a.notes), 500),
           a.project_id IS NOT NULL, false, 'tracker',
           concat(p_employee, '|', a.day, '|', a.target_key), auth.uid(), now()
    FROM   agg a
    JOIN   public.employees e ON e.id::text = p_employee::text
    LEFT JOIN public.projects p ON p.id::text = a.project_id::text
    LEFT JOIN public.clients  c ON c.id::text = p.client_id::text
    ON CONFLICT (tracker_key) DO UPDATE
      SET hours = EXCLUDED.hours, description = EXCLUDED.description,
          approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at
    RETURNING 1
  )
  SELECT count(*) INTO written FROM up;
  RETURN written;
END
$$;

CREATE OR REPLACE FUNCTION public.yva_time_approve(p_employee uuid, p_from date, p_to date, p_tz text DEFAULT 'America/Santo_Domingo')
RETURNS json
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  approved integer;
  written  integer;
BEGIN
  IF COALESCE(private.current_user_role(), '') NOT IN ('ceo', 'admin', 'accounting') THEN
    RAISE EXCEPTION 'Only CEO, Admin or Accounting can approve time' USING ERRCODE = '42501';
  END IF;
  IF p_to >= (now() AT TIME ZONE p_tz)::date THEN
    RAISE EXCEPTION 'Only finished days can be approved (up to yesterday)' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.tracker_blocks
  SET    status = 'approved'
  WHERE  employee_id = p_employee
    AND  status = 'tracked'
    AND  (block_start AT TIME ZONE p_tz)::date BETWEEN p_from AND p_to;
  GET DIAGNOSTICS approved = ROW_COUNT;

  written := public.yva_time_rollup(p_employee, p_from, p_to, p_tz);
  RETURN json_build_object('blocks', approved, 'entries', written);
END
$$;

CREATE OR REPLACE FUNCTION public.yva_time_decide_request(p_request uuid, p_approve boolean, p_note text DEFAULT NULL, p_tz text DEFAULT 'America/Santo_Domingo')
RETURNS json
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  r     public.manual_time_requests;
  bs    timestamptz;
  secs  integer;
  room  integer;
  added integer := 0;
  tk    text;
BEGIN
  IF COALESCE(private.current_user_role(), '') NOT IN ('ceo', 'admin', 'accounting') THEN
    RAISE EXCEPTION 'Only CEO, Admin or Accounting can decide requests' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO r FROM public.manual_time_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request is already %', r.status; END IF;

  IF NOT p_approve THEN
    UPDATE public.manual_time_requests
    SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = LEFT(p_note, 500)
    WHERE id = r.id;
    RETURN json_build_object('status', 'rejected', 'seconds', 0);
  END IF;

  -- Split into 10-minute blocks; never more than the room left in a block (no double counting)
  tk := CASE WHEN r.project_id IS NOT NULL THEN 'project:' || r.project_id::text ELSE 'work:' || r.work_type END;
  bs := to_timestamp(floor(extract(epoch FROM r.starts_at) / 600) * 600);
  WHILE bs < r.ends_at LOOP
    secs := extract(epoch FROM (LEAST(bs + interval '10 minutes', r.ends_at) - GREATEST(bs, r.starts_at)))::integer;
    SELECT 600 - COALESCE(SUM(seconds), 0) INTO room
    FROM   public.tracker_blocks
    WHERE  employee_id = r.employee_id AND block_start = bs AND status IN ('tracked', 'pending', 'approved');
    secs := LEAST(secs, room);
    IF secs > 0 THEN
      INSERT INTO public.tracker_blocks (employee_id, block_start, target_key, project_id, work_type, seconds, note, source, status)
      VALUES (r.employee_id, bs, tk, r.project_id, r.work_type, secs, LEFT('Manual: ' || r.reason, 500), 'manual', 'approved')
      ON CONFLICT (employee_id, block_start, target_key, source)
        DO UPDATE SET seconds = public.tracker_blocks.seconds + EXCLUDED.seconds, status = 'approved';
      added := added + secs;
    END IF;
    bs := bs + interval '10 minutes';
  END LOOP;

  UPDATE public.manual_time_requests
  SET status = 'approved', approved_seconds = added, decided_by = auth.uid(), decided_at = now(), decision_note = LEFT(p_note, 500)
  WHERE id = r.id;

  PERFORM public.yva_time_rollup(r.employee_id, (r.starts_at AT TIME ZONE p_tz)::date, (r.ends_at AT TIME ZONE p_tz)::date, p_tz);
  RETURN json_build_object('status', 'approved', 'seconds', added);
END
$$;

GRANT EXECUTE ON FUNCTION public.yva_time_rollup(uuid, date, date, text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.yva_time_approve(uuid, date, date, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.yva_time_decide_request(uuid, boolean, text, text)       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.yva_time_rollup(uuid, date, date, text)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.yva_time_approve(uuid, date, date, text)                FROM anon;
REVOKE EXECUTE ON FUNCTION public.yva_time_decide_request(uuid, boolean, text, text)      FROM anon;

NOTIFY pgrst, 'reload schema';

-- ── Result check ─────────────────────────────────────────────────────────────
SELECT 'table' AS kind, tablename AS name FROM pg_tables
WHERE  schemaname = 'public' AND tablename IN ('manual_time_requests', 'tracker_consents')
UNION ALL
SELECT 'function', proname FROM pg_proc
WHERE  proname IN ('yva_time_rollup', 'yva_time_approve', 'yva_time_decide_request')
UNION ALL
SELECT 'time_entries column', column_name FROM information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'time_entries' AND column_name IN ('source', 'tracker_key')
ORDER  BY 1, 2;
