-- ============================================================
-- YVA LawOS — Role lockdown (2026-10-30)
-- ============================================================
-- Closes a hole where any logged-in account (and sign-ups are open) could
-- insert its own user_roles row with ANY role, including 'ceo', and so
-- read every internal table.
--
-- After this script:
--   • "Internal" = an explicit list of staff roles. 'client', 'pending' and
--     any future role (e.g. a time-tracker 'employee') never count.
--   • A new account can only create its own row as 'pending' (no access).
--     A CEO picks the real role in Settings → Team Access.
--   • Only the user's own row, or staff, can read user_roles
--     (portal clients no longer see staff emails).
--
-- Run in the Supabase SQL Editor. Safe to run more than once.
-- The last query prints the result; 'user_roles_self_insert' must be gone.
-- ============================================================

-- 1. Only staff roles count as internal
CREATE OR REPLACE FUNCTION private.is_internal()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id::text = auth.uid()::text
    AND   role IN ('ceo', 'admin', 'accounting', 'recruiter', 'lead_gen')
  )
$$;

GRANT EXECUTE ON FUNCTION private.is_internal() TO authenticated;

-- 2. New accounts may only add themselves as 'pending'
DROP POLICY IF EXISTS "user_roles_self_insert" ON user_roles;
DROP POLICY IF EXISTS "user_roles_self_insert_pending" ON user_roles;
CREATE POLICY "user_roles_self_insert_pending" ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = (SELECT auth.uid())::text AND role = 'pending');

-- 3. Read your own row; staff can read all (Team Access page)
DROP POLICY IF EXISTS "user_roles_read" ON user_roles;
CREATE POLICY "user_roles_read" ON user_roles
  FOR SELECT TO authenticated
  USING (user_id::text = (SELECT auth.uid())::text OR private.is_internal());

-- (user_roles_ceo_update / user_roles_ceo_delete are unchanged: CEO only)

NOTIFY pgrst, 'reload schema';

-- 4. Result check
SELECT 'policy'   AS item, policyname || ' (' || cmd || ')' AS detail
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles'
UNION ALL
SELECT 'role column', data_type || ' / ' || udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'role'
UNION ALL
SELECT 'constraint', conname || ': ' || pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.user_roles'::regclass AND contype = 'c'
ORDER BY 1, 2;
