CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.current_user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id::text = auth.uid()::text LIMIT 1
$$;

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
    AND   role   != 'client'
  )
$$;

CREATE OR REPLACE FUNCTION private.is_portal_client()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_users WHERE auth_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION private.portal_client_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT client_id FROM public.client_users WHERE auth_id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION private.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_internal() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_portal_client() TO authenticated;
GRANT EXECUTE ON FUNCTION private.portal_client_id() TO authenticated;

DROP POLICY IF EXISTS "settings_insert_admin" ON settings;
DROP POLICY IF EXISTS "settings_update_admin" ON settings;
DROP POLICY IF EXISTS "settings_delete_admin" ON settings;
DROP POLICY IF EXISTS "settings_write" ON settings;
CREATE POLICY "settings_write" ON settings
  FOR ALL TO authenticated
  USING     (private.current_user_role() IN ('ceo', 'admin'))
  WITH CHECK (private.current_user_role() IN ('ceo', 'admin'));

DROP POLICY IF EXISTS "user_roles_ceo_update" ON user_roles;
CREATE POLICY "user_roles_ceo_update" ON user_roles
  FOR UPDATE TO authenticated
  USING     (private.current_user_role() = 'ceo')
  WITH CHECK (private.current_user_role() = 'ceo');

DROP POLICY IF EXISTS "user_roles_ceo_delete" ON user_roles;
CREATE POLICY "user_roles_ceo_delete" ON user_roles
  FOR DELETE TO authenticated
  USING (private.current_user_role() = 'ceo');

DROP POLICY IF EXISTS "client_users_internal_read" ON client_users;
CREATE POLICY "client_users_internal_read" ON client_users
  FOR SELECT TO authenticated USING (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON employees;
CREATE POLICY "team_all" ON employees
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON clients;
CREATE POLICY "team_all" ON clients
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON projects;
CREATE POLICY "team_all" ON projects
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON invoices;
CREATE POLICY "team_all" ON invoices
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON expenses;
CREATE POLICY "team_all" ON expenses
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON tasks;
CREATE POLICY "team_all" ON tasks
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON activity_log;
CREATE POLICY "team_all" ON activity_log
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON candidates;
CREATE POLICY "team_all" ON candidates
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON invoice_templates;
CREATE POLICY "team_all" ON invoice_templates
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "team_all" ON counters;
CREATE POLICY "team_all" ON counters
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DO $$
BEGIN
  IF to_regclass('public.general_expenses') IS NOT NULL THEN
    DROP POLICY IF EXISTS "team_all" ON public.general_expenses;
    CREATE POLICY "team_all" ON public.general_expenses
      FOR ALL TO authenticated
      USING (private.is_internal())
      WITH CHECK (private.is_internal());
  END IF;
END $$;

DROP POLICY IF EXISTS "internal_all" ON estimates;
CREATE POLICY "internal_all" ON estimates
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "internal_all" ON recurring_invoices;
CREATE POLICY "internal_all" ON recurring_invoices
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "internal_all" ON tags;
CREATE POLICY "internal_all" ON tags
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_own_client" ON clients;
CREATE POLICY "portal_own_client" ON clients
  FOR SELECT TO authenticated
  USING (
    private.is_portal_client()
    AND id = private.portal_client_id()
  );

DROP POLICY IF EXISTS "portal_client_projects" ON projects;
CREATE POLICY "portal_client_projects" ON projects
  FOR SELECT TO authenticated
  USING (
    private.is_portal_client()
    AND client_id::uuid = private.portal_client_id()
  );

DROP POLICY IF EXISTS "portal_client_invoices" ON invoices;
CREATE POLICY "portal_client_invoices" ON invoices
  FOR SELECT TO authenticated
  USING (
    private.is_portal_client()
    AND client_name = (
      SELECT name FROM public.clients
      WHERE id = private.portal_client_id()
      LIMIT 1
    )
    AND status != 'draft'
  );

DROP POLICY IF EXISTS "portal_client_employees" ON employees;
CREATE POLICY "portal_client_employees" ON employees
  FOR SELECT TO authenticated
  USING (
    private.is_portal_client()
    AND id::text IN (
      SELECT jsonb_array_elements_text(COALESCE(employee_ids, '[]'::jsonb))
      FROM   public.projects
      WHERE  client_id::uuid = private.portal_client_id()
    )
  );

DROP POLICY IF EXISTS "internal_all" ON time_entries;
CREATE POLICY "internal_all" ON time_entries
  FOR ALL TO authenticated
  USING (private.is_internal())
  WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_client_time_entries_read" ON time_entries;
CREATE POLICY "portal_client_time_entries_read" ON time_entries
  FOR SELECT TO authenticated
  USING (
    private.is_portal_client()
    AND project_id IN (
      SELECT id FROM public.projects
      WHERE client_id::uuid = private.portal_client_id()
    )
  );

DROP POLICY IF EXISTS "internal_all" ON staff_requests;
CREATE POLICY "internal_all" ON staff_requests
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_insert" ON staff_requests;
CREATE POLICY "portal_insert" ON staff_requests
  FOR INSERT TO authenticated WITH CHECK (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "portal_read" ON staff_requests;
CREATE POLICY "portal_read" ON staff_requests
  FOR SELECT TO authenticated USING (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "internal_all" ON team_reviews;
CREATE POLICY "internal_all" ON team_reviews
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_insert" ON team_reviews;
CREATE POLICY "portal_insert" ON team_reviews
  FOR INSERT TO authenticated WITH CHECK (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "portal_read" ON team_reviews;
CREATE POLICY "portal_read" ON team_reviews
  FOR SELECT TO authenticated USING (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "internal_all" ON bonus_requests;
CREATE POLICY "internal_all" ON bonus_requests
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_insert" ON bonus_requests;
CREATE POLICY "portal_insert" ON bonus_requests
  FOR INSERT TO authenticated WITH CHECK (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "portal_read" ON bonus_requests;
CREATE POLICY "portal_read" ON bonus_requests
  FOR SELECT TO authenticated USING (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "internal_all" ON client_documents;
CREATE POLICY "internal_all" ON client_documents
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_read" ON client_documents;
CREATE POLICY "portal_read" ON client_documents
  FOR SELECT TO authenticated USING (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "portal_insert" ON client_documents;
CREATE POLICY "portal_insert" ON client_documents
  FOR INSERT TO authenticated WITH CHECK (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "internal_all" ON payment_attempts;
CREATE POLICY "internal_all" ON payment_attempts
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_read" ON payment_attempts;
CREATE POLICY "portal_read" ON payment_attempts
  FOR SELECT TO authenticated USING (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "internal_all" ON working_hour_prefs;
CREATE POLICY "internal_all" ON working_hour_prefs
  FOR ALL TO authenticated USING (private.is_internal()) WITH CHECK (private.is_internal());

DROP POLICY IF EXISTS "portal_read" ON working_hour_prefs;
CREATE POLICY "portal_read" ON working_hour_prefs
  FOR SELECT TO authenticated USING (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "portal_upsert" ON working_hour_prefs;
CREATE POLICY "portal_upsert" ON working_hour_prefs
  FOR INSERT TO authenticated WITH CHECK (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "portal_update" ON working_hour_prefs;
CREATE POLICY "portal_update" ON working_hour_prefs
  FOR UPDATE TO authenticated USING (private.is_portal_client() AND client_id = private.portal_client_id());

DROP POLICY IF EXISTS "attachments_internal_read" ON storage.objects;
CREATE POLICY "attachments_internal_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attachments' AND private.is_internal());

DROP POLICY IF EXISTS "attachments_client_docs_read" ON storage.objects;
CREATE POLICY "attachments_client_docs_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND private.is_portal_client()
    AND name LIKE ('client-docs/' || private.portal_client_id()::text || '/%')
  );

DROP FUNCTION IF EXISTS public.current_user_role() CASCADE;
DROP FUNCTION IF EXISTS public.is_internal() CASCADE;
DROP FUNCTION IF EXISTS public.is_portal_client() CASCADE;
DROP FUNCTION IF EXISTS public.portal_client_id() CASCADE;

NOTIFY pgrst, 'reload schema';
