-- ============================================================================
-- YVA OS redesign (2026-11) — People hub: scheduled announcements
-- Run after migrate-step7-workspace.sql. Safe to run more than once.
--
-- Announcements → "Schedule…" saves a post with a future published_at. Employees already only
-- read posts whose published_at has passed (announcements_read policy), but the step 7 trigger
-- sent the bell/email/push notification as soon as the row was saved — before the post was
-- visible. Now:
--   * announcements.notified_at records when the team was notified (once per post);
--   * the trigger notifies only when published_at has passed (Publish now, or an edit that publishes);
--   * public.announcements_publish_due() notifies posts whose scheduled time has come. The Netlify
--     scheduled function `announcements-publish` calls it every 10 minutes (service role only);
--     notifications-dispatch then emails / pushes them as usual.
-- ============================================================================

ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- Posts published before this script were notified by the old trigger
UPDATE public.announcements SET notified_at = coalesce(published_at, now())
WHERE notified_at IS NULL AND published_at IS NOT NULL AND published_at <= now();

CREATE OR REPLACE FUNCTION private.announcement_send(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.announcements%ROWTYPE;
  n integer := 0;
BEGIN
  -- claim the post (only one caller notifies it)
  UPDATE public.announcements SET notified_at = now()
  WHERE id = p_id AND notified_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
  RETURNING * INTO a;
  IF NOT FOUND THEN RETURN 0; END IF;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT e.user_id::uuid, 'announcement', left(a.title, 200), left(a.body, 300), '/me?s=company'
  FROM public.employees e
  WHERE e.user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND coalesce(lower(e.status), '') NOT IN ('inactive', 'terminated')
    AND (a.audience = 'all' OR coalesce(e.works_for, 'client') = a.audience);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION private.announcement_send(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.announcement_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.published_at IS NOT NULL AND NEW.published_at <= now() AND NEW.notified_at IS NULL THEN
    PERFORM private.announcement_send(NEW.id);
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS announcements_notify ON public.announcements;
CREATE TRIGGER announcements_notify AFTER INSERT OR UPDATE OF published_at ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION private.announcement_notify();

-- Scheduled posts whose time has come (called by the announcements-publish Netlify function)
CREATE OR REPLACE FUNCTION public.announcements_publish_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  posts integer := 0;
  people integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.announcements
           WHERE notified_at IS NULL AND published_at IS NOT NULL AND published_at <= now()
           ORDER BY published_at LIMIT 50
  LOOP
    people := people + private.announcement_send(r.id);
    posts := posts + 1;
  END LOOP;
  RETURN jsonb_build_object('posts', posts, 'notifications', people);
END
$$;
REVOKE ALL ON FUNCTION public.announcements_publish_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.announcements_publish_due() TO service_role;

NOTIFY pgrst, 'reload schema';
