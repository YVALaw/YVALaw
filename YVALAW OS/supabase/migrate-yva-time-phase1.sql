-- ============================================================
-- YVA Time — Phase 1: tracker tables, screenshots, desktop sign-in (2026-10-30)
-- ============================================================
-- Run in the Supabase SQL Editor (after migrate-yva-time-phase0.sql).
-- Safe to run more than once.
--
--   tracker_blocks       time in 10-minute blocks, one row per employee + block + target
--                        (target = a client project, or a YVA work type). The desktop app
--                        upserts absolute seconds, so retries after being offline are safe.
--   tracker_screenshots  one row per screen captured (client-placed staff only)
--   storage 'screenshots' private bucket: <employee_id>/<yyyy-mm-dd>/<id>-<monitor>.jpg
--   desktop_link_codes   one-time codes for "Sign in with YVA OS" (server functions only)
--
-- Who can do what (enforced here, not just in the app):
--   employees  write only their own rows, for projects they are assigned to (client team)
--              or YVA work types (YVA team); at most 600 s per 10-minute block in total;
--              blocks no older than 7 days (offline catch-up) and not in the future;
--              may delete their own screenshot within 2 minutes of upload, which marks
--              that 10-minute block 'removed'
--   staff      read/write all blocks (private.is_internal())
--   CEO/Admin  only roles that can see or delete screenshots
--   clients    nothing here (they see hours only, via time_entries)
-- ============================================================

-- ── 1. Helpers ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.current_employee_id()
RETURNS uuid
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT id::uuid FROM public.employees WHERE user_id::text = auth.uid()::text LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.current_employee_is_yva()
RETURNS boolean
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees
    WHERE user_id::text = auth.uid()::text AND works_for = 'yva'
  )
$$;

CREATE OR REPLACE FUNCTION private.employee_on_project(p_project uuid)
RETURNS boolean
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id::text = p_project::text
      AND COALESCE(employee_ids, '[]'::jsonb) ? private.current_employee_id()::text
  )
$$;

CREATE OR REPLACE FUNCTION private.can_view_screenshots()
RETURNS boolean
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(private.current_user_role() IN ('ceo', 'admin'), false)
$$;

GRANT EXECUTE ON FUNCTION private.current_employee_id()      TO authenticated;
GRANT EXECUTE ON FUNCTION private.current_employee_is_yva()  TO authenticated;
GRANT EXECUTE ON FUNCTION private.employee_on_project(uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_screenshots()     TO authenticated;

-- ── 2. tracker_blocks ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tracker_blocks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid        NOT NULL,
  block_start timestamptz NOT NULL,
  target_key  text        NOT NULL,          -- 'project:<uuid>' or 'work:<type>'
  project_id  uuid,
  work_type   text,
  seconds     integer     NOT NULL DEFAULT 0,
  note        text,
  source      text        NOT NULL DEFAULT 'desktop',
  status      text        NOT NULL DEFAULT 'tracked',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracker_blocks_unique_target UNIQUE (employee_id, block_start, target_key),
  CONSTRAINT tracker_blocks_seconds   CHECK (seconds BETWEEN 0 AND 600),
  CONSTRAINT tracker_blocks_aligned   CHECK (extract(epoch FROM block_start)::bigint % 600 = 0),
  CONSTRAINT tracker_blocks_one_target CHECK ((project_id IS NOT NULL) <> (work_type IS NOT NULL)),
  CONSTRAINT tracker_blocks_target_key CHECK (
    target_key = CASE WHEN project_id IS NOT NULL THEN 'project:' || project_id::text
                      ELSE 'work:' || work_type END),
  CONSTRAINT tracker_blocks_source CHECK (source IN ('desktop', 'manual')),
  CONSTRAINT tracker_blocks_status CHECK (status IN ('tracked', 'pending', 'approved', 'rejected', 'removed')),
  CONSTRAINT tracker_blocks_note_len CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS tracker_blocks_employee_time ON public.tracker_blocks (employee_id, block_start);
CREATE INDEX IF NOT EXISTS tracker_blocks_updated      ON public.tracker_blocks (updated_at);

-- Server-side timestamps + at most 600 s per employee per 10-minute block
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

  SELECT COALESCE(SUM(seconds), 0) INTO other_seconds
  FROM   public.tracker_blocks
  WHERE  employee_id = NEW.employee_id
    AND  block_start = NEW.block_start
    AND  target_key <> NEW.target_key
    AND  status <> 'removed';
  IF NEW.status <> 'removed' AND other_seconds + NEW.seconds > 600 THEN
    RAISE EXCEPTION 'A 10-minute block cannot hold more than 600 seconds (has %, adding %)',
      other_seconds, NEW.seconds USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tracker_blocks_before_write ON public.tracker_blocks;
CREATE TRIGGER tracker_blocks_before_write
  BEFORE INSERT OR UPDATE ON public.tracker_blocks
  FOR EACH ROW EXECUTE FUNCTION private.tracker_blocks_before_write();

ALTER TABLE public.tracker_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracker_blocks_staff_all"       ON public.tracker_blocks;
DROP POLICY IF EXISTS "tracker_blocks_employee_read"   ON public.tracker_blocks;
DROP POLICY IF EXISTS "tracker_blocks_employee_insert" ON public.tracker_blocks;
DROP POLICY IF EXISTS "tracker_blocks_employee_update" ON public.tracker_blocks;

CREATE POLICY "tracker_blocks_staff_all" ON public.tracker_blocks
  FOR ALL TO authenticated
  USING (private.is_internal()) WITH CHECK (private.is_internal());

CREATE POLICY "tracker_blocks_employee_read" ON public.tracker_blocks
  FOR SELECT TO authenticated
  USING (employee_id = private.current_employee_id());

CREATE POLICY "tracker_blocks_employee_insert" ON public.tracker_blocks
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = private.current_employee_id()
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
    AND source = 'desktop' AND status = 'tracked'
    AND block_start <= now() + interval '1 minute'
    AND block_start >= now() - interval '7 days'
    AND (
      (project_id IS NOT NULL AND private.employee_on_project(project_id))
      OR (work_type IS NOT NULL AND private.current_employee_is_yva())
    )
  );

-- ── 3. tracker_screenshots ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tracker_screenshots (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid        NOT NULL,
  block_start  timestamptz NOT NULL,
  taken_at     timestamptz NOT NULL,
  monitor      smallint    NOT NULL DEFAULT 0,
  storage_path text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracker_screenshots_aligned CHECK (extract(epoch FROM block_start)::bigint % 600 = 0)
);

CREATE INDEX IF NOT EXISTS tracker_screenshots_employee_time ON public.tracker_screenshots (employee_id, block_start);

CREATE OR REPLACE FUNCTION private.tracker_screenshots_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.created_at := now();   -- the 2-minute delete window counts from upload, on server time
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tracker_screenshots_before_insert ON public.tracker_screenshots;
CREATE TRIGGER tracker_screenshots_before_insert
  BEFORE INSERT ON public.tracker_screenshots
  FOR EACH ROW EXECUTE FUNCTION private.tracker_screenshots_before_insert();

-- When an employee deletes their own screenshot, that 10-minute block is removed
-- from their time. (Staff deleting a screenshot does not change the hours.)
CREATE OR REPLACE FUNCTION private.tracker_screenshots_after_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.employee_id = private.current_employee_id() THEN
    UPDATE public.tracker_blocks
    SET    status = 'removed'
    WHERE  employee_id = OLD.employee_id
      AND  block_start = OLD.block_start
      AND  status = 'tracked';
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS tracker_screenshots_after_delete ON public.tracker_screenshots;
CREATE TRIGGER tracker_screenshots_after_delete
  AFTER DELETE ON public.tracker_screenshots
  FOR EACH ROW EXECUTE FUNCTION private.tracker_screenshots_after_delete();

ALTER TABLE public.tracker_screenshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracker_screenshots_admin_read"      ON public.tracker_screenshots;
DROP POLICY IF EXISTS "tracker_screenshots_admin_delete"    ON public.tracker_screenshots;
DROP POLICY IF EXISTS "tracker_screenshots_employee_read"   ON public.tracker_screenshots;
DROP POLICY IF EXISTS "tracker_screenshots_employee_insert" ON public.tracker_screenshots;
DROP POLICY IF EXISTS "tracker_screenshots_employee_delete" ON public.tracker_screenshots;

CREATE POLICY "tracker_screenshots_admin_read" ON public.tracker_screenshots
  FOR SELECT TO authenticated USING (private.can_view_screenshots());

CREATE POLICY "tracker_screenshots_admin_delete" ON public.tracker_screenshots
  FOR DELETE TO authenticated USING (private.can_view_screenshots());

CREATE POLICY "tracker_screenshots_employee_read" ON public.tracker_screenshots
  FOR SELECT TO authenticated USING (employee_id = private.current_employee_id());

CREATE POLICY "tracker_screenshots_employee_insert" ON public.tracker_screenshots
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = private.current_employee_id()
    AND storage_path LIKE private.current_employee_id()::text || '/%'
    AND taken_at <= now() + interval '1 minute'
    AND taken_at >= now() - interval '7 days'
  );

CREATE POLICY "tracker_screenshots_employee_delete" ON public.tracker_screenshots
  FOR DELETE TO authenticated
  USING (employee_id = private.current_employee_id() AND created_at > now() - interval '2 minutes');

-- ── 4. Private screenshots bucket ────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('screenshots', 'screenshots', false, 3145728, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "screenshots_admin_read"      ON storage.objects;
DROP POLICY IF EXISTS "screenshots_admin_delete"    ON storage.objects;
DROP POLICY IF EXISTS "screenshots_employee_insert" ON storage.objects;
DROP POLICY IF EXISTS "screenshots_employee_read"   ON storage.objects;
DROP POLICY IF EXISTS "screenshots_employee_delete" ON storage.objects;

CREATE POLICY "screenshots_admin_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'screenshots' AND private.can_view_screenshots());

CREATE POLICY "screenshots_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'screenshots' AND private.can_view_screenshots());

CREATE POLICY "screenshots_employee_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = private.current_employee_id()::text);

CREATE POLICY "screenshots_employee_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = private.current_employee_id()::text);

CREATE POLICY "screenshots_employee_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'screenshots'
    AND (storage.foldername(name))[1] = private.current_employee_id()::text
    AND created_at > now() - interval '2 minutes'
  );

-- ── 5. Desktop sign-in codes (server functions only) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.desktop_link_codes (
  code_hash  text        PRIMARY KEY,   -- sha256 of the one-time code
  user_id    uuid        NOT NULL,
  challenge  text        NOT NULL,      -- PKCE: base64url(sha256(verifier)) held by the app
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.desktop_link_codes ENABLE ROW LEVEL SECURITY;   -- no policies: service role only
REVOKE ALL ON public.desktop_link_codes FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Result check ─────────────────────────────────────────────────────────────
SELECT 'table' AS kind, tablename AS name FROM pg_tables
WHERE  schemaname = 'public' AND tablename IN ('tracker_blocks', 'tracker_screenshots', 'desktop_link_codes')
UNION ALL
SELECT 'bucket', id || CASE WHEN public THEN ' (PUBLIC!)' ELSE ' (private)' END FROM storage.buckets WHERE id = 'screenshots'
ORDER  BY 1, 2;
