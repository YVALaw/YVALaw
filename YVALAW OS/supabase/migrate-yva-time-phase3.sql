-- ============================================================
-- YVA Time — Phase 3: activity, schedule, computers, reopen (2026-10-30)
-- ============================================================
-- Run in the Supabase SQL Editor after migrate-yva-time-phase2.sql. Safe to run more than once.
-- YVA Time 0.2.0 can no longer save time after this runs: install 0.3.0 or later.
--
--   tracker_blocks     + active_seconds  seconds with keyboard/mouse use (client team only;
--                                        NULL for the YVA team) → "activity %"
--                      + first_offset / last_offset  first and last counted second inside
--                                        the 10-minute block (0–599) → schedule report
--   tracker_consents   + notice_version  which screenshot notice was accepted
--                                        (2 = screenshots + activity; NULL = 1)
--   desktop_devices    one row per computer sign-in ("Sign in with YVA OS"), created by
--                      the desktop-link-redeem function. Desktop time and screenshots are
--                      only accepted from a signed-in computer that YVA has not
--                      disconnected (checked against the login's session id).
--
--   public.yva_time_reopen(employee, from, to, tz)    undo an approval (CEO/Admin/Accounting)
--   public.yva_time_disconnect_device(device, by)     server functions only (service role)
-- ============================================================

-- ── 1. tracker_blocks: activity and first/last second ───────────────────────

ALTER TABLE public.tracker_blocks
  ADD COLUMN IF NOT EXISTS active_seconds integer,
  ADD COLUMN IF NOT EXISTS first_offset   smallint,
  ADD COLUMN IF NOT EXISTS last_offset    smallint;

ALTER TABLE public.tracker_blocks DROP CONSTRAINT IF EXISTS tracker_blocks_active;
ALTER TABLE public.tracker_blocks ADD CONSTRAINT tracker_blocks_active
  CHECK (active_seconds IS NULL OR active_seconds BETWEEN 0 AND seconds);

ALTER TABLE public.tracker_blocks DROP CONSTRAINT IF EXISTS tracker_blocks_offsets;
ALTER TABLE public.tracker_blocks ADD CONSTRAINT tracker_blocks_offsets CHECK (
  (first_offset IS NULL OR first_offset BETWEEN 0 AND 599)
  AND (last_offset IS NULL OR last_offset BETWEEN 0 AND 599)
  AND (first_offset IS NULL OR last_offset IS NULL OR first_offset <= last_offset));

-- ── 2. tracker_consents: notice version ─────────────────────────────────────

ALTER TABLE public.tracker_consents ADD COLUMN IF NOT EXISTS notice_version smallint;
ALTER TABLE public.tracker_consents DROP CONSTRAINT IF EXISTS tracker_consents_notice_version;
ALTER TABLE public.tracker_consents ADD CONSTRAINT tracker_consents_notice_version
  CHECK (notice_version IS NULL OR notice_version BETWEEN 1 AND 50);

-- ── 3. desktop_devices ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.desktop_devices (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid        NOT NULL,
  user_id       uuid        NOT NULL,
  session_id    uuid        NOT NULL UNIQUE,   -- the app's own login session (JWT claim session_id)
  name          text        NOT NULL,          -- computer name
  platform      text,
  app_version   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  signed_out_at timestamptz,                   -- the person clicked Sign out in the app
  revoked_at    timestamptz,                   -- YVA disconnected this computer
  revoked_by    uuid,
  CONSTRAINT desktop_devices_name_len    CHECK (length(name) BETWEEN 1 AND 100),
  CONSTRAINT desktop_devices_version_len CHECK (app_version IS NULL OR length(app_version) <= 40)
);
CREATE INDEX IF NOT EXISTS desktop_devices_employee ON public.desktop_devices (employee_id, created_at);

-- The app can only touch app_version and signed_out_at (column grants below); the server
-- keeps the timestamps honest.
CREATE OR REPLACE FUNCTION private.desktop_devices_before_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at THEN
    NEW.last_seen_at := now();
  END IF;
  IF OLD.signed_out_at IS NULL AND NEW.signed_out_at IS NOT NULL THEN
    NEW.signed_out_at := now();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS desktop_devices_before_update ON public.desktop_devices;
CREATE TRIGGER desktop_devices_before_update
  BEFORE UPDATE ON public.desktop_devices
  FOR EACH ROW EXECUTE FUNCTION private.desktop_devices_before_update();

ALTER TABLE public.desktop_devices ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.desktop_devices FROM anon, authenticated;
GRANT SELECT ON public.desktop_devices TO authenticated;
GRANT UPDATE (app_version, signed_out_at) ON public.desktop_devices TO authenticated;

-- This request comes from a computer signed in through YVA Time that is still connected
CREATE OR REPLACE FUNCTION private.current_desktop_session_ok()
RETURNS boolean
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.desktop_devices d
    WHERE d.session_id::text = (auth.jwt() ->> 'session_id')
      AND d.user_id::text    = auth.uid()::text
      AND d.revoked_at IS NULL
      AND d.signed_out_at IS NULL
  )
$$;
GRANT EXECUTE ON FUNCTION private.current_desktop_session_ok() TO authenticated;

DROP POLICY IF EXISTS "desktop_devices_staff_read" ON public.desktop_devices;
DROP POLICY IF EXISTS "desktop_devices_own_read"   ON public.desktop_devices;
DROP POLICY IF EXISTS "desktop_devices_own_update" ON public.desktop_devices;

CREATE POLICY "desktop_devices_staff_read" ON public.desktop_devices
  FOR SELECT TO authenticated USING (private.is_internal());

CREATE POLICY "desktop_devices_own_read" ON public.desktop_devices
  FOR SELECT TO authenticated USING (user_id::text = auth.uid()::text);

-- The app's check-in every minute (and Sign out) — only its own, still-connected row
CREATE POLICY "desktop_devices_own_update" ON public.desktop_devices
  FOR UPDATE TO authenticated
  USING (
    user_id::text = auth.uid()::text
    AND session_id::text = (auth.jwt() ->> 'session_id')
    AND revoked_at IS NULL AND signed_out_at IS NULL
  )
  WITH CHECK (
    user_id::text = auth.uid()::text
    AND session_id::text = (auth.jwt() ->> 'session_id')
    AND revoked_at IS NULL
  );

-- ── 4. Desktop writes need a connected computer ─────────────────────────────

DROP POLICY IF EXISTS "tracker_blocks_employee_insert" ON public.tracker_blocks;
DROP POLICY IF EXISTS "tracker_blocks_employee_update" ON public.tracker_blocks;

CREATE POLICY "tracker_blocks_employee_insert" ON public.tracker_blocks
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = private.current_employee_id()
    AND private.current_desktop_session_ok()
    AND source = 'desktop' AND status = 'tracked'
    AND block_start <= now() + interval '1 minute'
    AND block_start >= now() - interval '7 days'
    AND (
      (project_id IS NOT NULL AND private.employee_on_project(project_id))
      OR (work_type IS NOT NULL AND private.current_employee_is_yva())
    )
  );

CREATE POLICY "tracker_blocks_employee_update" ON public.tracker_blocks
  FOR UPDATE TO authenticated
  USING (employee_id = private.current_employee_id() AND source = 'desktop' AND status = 'tracked')
  WITH CHECK (
    employee_id = private.current_employee_id()
    AND private.current_desktop_session_ok()
    AND source = 'desktop' AND status = 'tracked'
    AND block_start <= now() + interval '1 minute'
    AND block_start >= now() - interval '7 days'
    AND (
      (project_id IS NOT NULL AND private.employee_on_project(project_id))
      OR (work_type IS NOT NULL AND private.current_employee_is_yva())
    )
  );

DROP POLICY IF EXISTS "tracker_screenshots_employee_insert" ON public.tracker_screenshots;
CREATE POLICY "tracker_screenshots_employee_insert" ON public.tracker_screenshots
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = private.current_employee_id()
    AND private.current_desktop_session_ok()
    AND storage_path LIKE private.current_employee_id()::text || '/%'
    AND taken_at <= now() + interval '1 minute'
    AND taken_at >= now() - interval '7 days'
  );

DROP POLICY IF EXISTS "screenshots_employee_insert" ON storage.objects;
CREATE POLICY "screenshots_employee_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'screenshots'
    AND (storage.foldername(name))[1] = private.current_employee_id()::text
    AND private.current_desktop_session_ok()
  );

-- ── 5. Disconnect a computer (called by the desktop-device-revoke function) ──

CREATE OR REPLACE FUNCTION public.yva_time_disconnect_device(p_device uuid, p_by uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d       public.desktop_devices;
  ended   integer := 0;
BEGIN
  UPDATE public.desktop_devices
  SET    revoked_at = COALESCE(revoked_at, now()), revoked_by = COALESCE(revoked_by, p_by)
  WHERE  id = p_device
  RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'Computer not found'; END IF;

  -- End that login (its refresh token stops working); the app signs itself out within a minute
  BEGIN
    DELETE FROM auth.sessions WHERE id = d.session_id;
    GET DIAGNOSTICS ended = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    ended := 0;   -- writes are refused anyway (section 4)
  END;
  RETURN json_build_object('revoked', true, 'session_ended', ended > 0);
END
$$;

REVOKE ALL ON FUNCTION public.yva_time_disconnect_device(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.yva_time_disconnect_device(uuid, uuid) TO service_role;

-- ── 6. Reopen approved time (approved by mistake) ───────────────────────────

CREATE OR REPLACE FUNCTION public.yva_time_reopen(p_employee uuid, p_from date, p_to date, p_tz text DEFAULT 'America/Santo_Domingo')
RETURNS json
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  reopened integer;
  removed  integer;
BEGIN
  IF COALESCE(private.current_user_role(), '') NOT IN ('ceo', 'admin', 'accounting') THEN
    RAISE EXCEPTION 'Only CEO, Admin or Accounting can reopen approved time' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.time_entries
    WHERE  employee_id::text = p_employee::text AND source = 'tracker'
      AND  date BETWEEN p_from AND p_to AND invoiced IS TRUE
  ) THEN
    RAISE EXCEPTION 'Some of these hours are already marked as invoiced — fix the invoice first'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.tracker_blocks
  SET    status = 'tracked'
  WHERE  employee_id = p_employee
    AND  status = 'approved'
    AND  (block_start AT TIME ZONE p_tz)::date BETWEEN p_from AND p_to;
  GET DIAGNOSTICS reopened = ROW_COUNT;

  DELETE FROM public.time_entries
  WHERE  employee_id::text = p_employee::text AND source = 'tracker'
    AND  date BETWEEN p_from AND p_to;
  GET DIAGNOSTICS removed = ROW_COUNT;

  RETURN json_build_object('blocks', reopened, 'entries', removed);
END
$$;

GRANT EXECUTE ON FUNCTION public.yva_time_reopen(uuid, date, date, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.yva_time_reopen(uuid, date, date, text) FROM anon;

-- ── 7. Approved manual time records its first/last second (schedule report) ──

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
  f_off integer;
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
    secs  := extract(epoch FROM (LEAST(bs + interval '10 minutes', r.ends_at) - GREATEST(bs, r.starts_at)))::integer;
    f_off := extract(epoch FROM (GREATEST(bs, r.starts_at) - bs))::integer;
    SELECT 600 - COALESCE(SUM(seconds), 0) INTO room
    FROM   public.tracker_blocks
    WHERE  employee_id = r.employee_id AND block_start = bs AND status IN ('tracked', 'pending', 'approved');
    secs := LEAST(secs, room);
    IF secs > 0 THEN
      INSERT INTO public.tracker_blocks (employee_id, block_start, target_key, project_id, work_type, seconds, note, source, status,
                                         first_offset, last_offset)
      VALUES (r.employee_id, bs, tk, r.project_id, r.work_type, secs, LEFT('Manual: ' || r.reason, 500), 'manual', 'approved',
              f_off, LEAST(f_off + secs - 1, 599))
      ON CONFLICT (employee_id, block_start, target_key, source)
        DO UPDATE SET seconds = public.tracker_blocks.seconds + EXCLUDED.seconds, status = 'approved',
                      first_offset = LEAST(public.tracker_blocks.first_offset, EXCLUDED.first_offset),
                      last_offset  = GREATEST(public.tracker_blocks.last_offset, EXCLUDED.last_offset);
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

NOTIFY pgrst, 'reload schema';

-- ── Result check ─────────────────────────────────────────────────────────────
SELECT 'table' AS kind, tablename AS name FROM pg_tables
WHERE  schemaname = 'public' AND tablename = 'desktop_devices'
UNION ALL
SELECT 'function', proname FROM pg_proc
WHERE  proname IN ('yva_time_reopen', 'yva_time_disconnect_device', 'current_desktop_session_ok')
UNION ALL
SELECT 'tracker_blocks column', column_name FROM information_schema.columns
WHERE  table_schema = 'public' AND table_name = 'tracker_blocks' AND column_name IN ('active_seconds', 'first_offset', 'last_offset')
ORDER  BY 1, 2;
