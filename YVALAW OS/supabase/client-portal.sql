-- ============================================================
-- YVA LawOS — Client Portal: Tables + RLS
-- Run this in Supabase SQL Editor AFTER running rls.sql
-- Each block can be run independently if needed.
-- ============================================================


-- ── Step 1: Create client_users table ────────────────────────────────────────
-- Links a Supabase Auth user to a Client record.
-- One auth user per client (unique on auth_id).

CREATE TABLE IF NOT EXISTS client_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id       uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL,  -- references clients.id (no FK — avoids circular RLS issues)
  invited_at    timestamptz DEFAULT now(),
  last_login_at timestamptz,
  created_at    timestamptz DEFAULT now()
);

-- Stripe customer ID is set by netlify/functions/create-payment-intent.cjs.
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS auto_pay_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS default_payment_method_id text;
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS auto_pay_authorized_at timestamptz;
ALTER TABLE client_users ADD COLUMN IF NOT EXISTS auto_pay_disabled_at timestamptz;

ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;

-- Internal staff can read portal billing status for client profiles.
DROP POLICY IF EXISTS "client_users_internal_read" ON client_users;
CREATE POLICY "client_users_internal_read" ON client_users
  FOR SELECT TO authenticated USING (public.is_internal());

-- Clients can only read/update their own row (no delete, no insert — managed by invite function)
DROP POLICY IF EXISTS "client_users_own_read" ON client_users;
CREATE POLICY "client_users_own_read" ON client_users
  FOR SELECT USING (auth_id = auth.uid());

DROP POLICY IF EXISTS "client_users_own_update" ON client_users;
CREATE POLICY "client_users_own_update" ON client_users
  FOR UPDATE USING (auth_id = auth.uid());

-- Service role (Netlify functions) can do anything — no policy needed (bypasses RLS).


-- ── Step 2: Add helper functions ─────────────────────────────────────────────
-- SECURITY DEFINER: runs with elevated privileges so it can always query these tables.

CREATE OR REPLACE FUNCTION public.is_internal()
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

CREATE OR REPLACE FUNCTION public.is_portal_client()
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

CREATE OR REPLACE FUNCTION public.portal_client_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT client_id FROM public.client_users WHERE auth_id = auth.uid() LIMIT 1
$$;


-- ── Step 3: Tighten existing team_all policies ────────────────────────────────
-- The original policies allowed ALL authenticated users full access.
-- Now we scope them to internal staff only, so client portal users
-- cannot read/write OS data.
--
-- NOTE: This drops and recreates the existing team_all policies.
-- If you haven't run rls.sql yet, skip this step and run rls.sql first.

DROP POLICY IF EXISTS "team_all" ON employees;
DROP POLICY IF EXISTS "team_all" ON clients;
DROP POLICY IF EXISTS "team_all" ON projects;
DROP POLICY IF EXISTS "team_all" ON invoices;
DROP POLICY IF EXISTS "team_all" ON expenses;
DROP POLICY IF EXISTS "team_all" ON tasks;
DROP POLICY IF EXISTS "team_all" ON activity_log;
DROP POLICY IF EXISTS "team_all" ON candidates;
DROP POLICY IF EXISTS "team_all" ON invoice_templates;
DROP POLICY IF EXISTS "team_all" ON counters;

DO $$
BEGIN
  IF to_regclass('public.general_expenses') IS NOT NULL THEN
    DROP POLICY IF EXISTS "team_all" ON public.general_expenses;
  END IF;
END $$;

-- Recreate: internal users only
CREATE POLICY "team_all" ON employees         FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON clients           FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON projects          FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON invoices          FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON expenses          FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON tasks              FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON activity_log      FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON candidates        FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON invoice_templates FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
CREATE POLICY "team_all" ON counters          FOR ALL TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());

DO $$
BEGIN
  IF to_regclass('public.general_expenses') IS NOT NULL THEN
    CREATE POLICY "team_all" ON public.general_expenses
      FOR ALL TO authenticated
      USING (public.is_internal())
      WITH CHECK (public.is_internal());
  END IF;
END $$;


-- ── Step 4: Client portal READ policies ──────────────────────────────────────
-- Clients can read their own data only. No writes from the portal.

-- Own client record
DROP POLICY IF EXISTS "portal_own_client" ON clients;
CREATE POLICY "portal_own_client" ON clients
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client()
    AND id = public.portal_client_id()
  );

-- Client portal Settings can update the authenticated client's phone number.
-- The frontend only sends { phone }, but RLS cannot restrict columns by itself.
DROP POLICY IF EXISTS "portal_update_own_client" ON clients;
CREATE POLICY "portal_update_own_client" ON clients
  FOR UPDATE TO authenticated
  USING (
    public.is_portal_client()
    AND id = public.portal_client_id()
  )
  WITH CHECK (
    public.is_portal_client()
    AND id = public.portal_client_id()
  );

-- Projects assigned to this client
-- NOTE: client_id is stored as text in some deployments — adjust cast if needed.
DROP POLICY IF EXISTS "portal_client_projects" ON projects;
CREATE POLICY "portal_client_projects" ON projects
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client()
    AND client_id::uuid = public.portal_client_id()
  );

-- Invoices matched by client name (invoices table uses client_name text, not a FK)
DROP POLICY IF EXISTS "portal_client_invoices" ON invoices;
CREATE POLICY "portal_client_invoices" ON invoices
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client()
    AND client_name = (
      SELECT name FROM public.clients
      WHERE id = public.portal_client_id()
      LIMIT 1
    )
    AND status != 'draft'  -- clients never see draft invoices
  );

-- Employees assigned to client's projects
DROP POLICY IF EXISTS "portal_client_employees" ON employees;
CREATE POLICY "portal_client_employees" ON employees
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client()
    AND id::text IN (
      SELECT jsonb_array_elements_text(COALESCE(employee_ids, '[]'::jsonb))
      FROM   public.projects
      WHERE  client_id::uuid = public.portal_client_id()
    )
  );

-- Time entries for the client's projects.
-- migrations.sql originally creates a broad "auth_all" policy; remove it here
-- so portal clients cannot read every time entry once client portal is enabled.
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON time_entries;
DROP POLICY IF EXISTS "internal_all" ON time_entries;
DROP POLICY IF EXISTS "portal_client_time_entries_read" ON time_entries;

CREATE POLICY "internal_all" ON time_entries
  FOR ALL TO authenticated
  USING (public.is_internal())
  WITH CHECK (public.is_internal());

CREATE POLICY "portal_client_time_entries_read" ON time_entries
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client()
    AND project_id IN (
      SELECT id FROM public.projects
      WHERE client_id::uuid = public.portal_client_id()
    )
  );


-- ── Step 5: New portal tables ─────────────────────────────────────────────────

-- Staff requests (replacement or additional staff)
CREATE TABLE IF NOT EXISTS staff_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,
  client_name   text,
  type          text NOT NULL CHECK (type IN ('replacement', 'additional')),
  employee_id   uuid,
  employee_name text,
  role          text,
  hours_per_week numeric,
  start_date    date,
  notes         text,
  status        text DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'fulfilled', 'declined')),
  created_at    timestamptz DEFAULT now()
);

-- Existing deployments may already have staff_requests without these columns.
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS hours_per_week numeric;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS start_date date;

ALTER TABLE staff_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_all" ON staff_requests;
CREATE POLICY "internal_all"   ON staff_requests FOR ALL    TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
DROP POLICY IF EXISTS "portal_insert" ON staff_requests;
CREATE POLICY "portal_insert"  ON staff_requests FOR INSERT TO authenticated WITH CHECK (public.is_portal_client() AND client_id = public.portal_client_id());
DROP POLICY IF EXISTS "portal_read" ON staff_requests;
CREATE POLICY "portal_read"    ON staff_requests FOR SELECT TO authenticated USING (public.is_portal_client() AND client_id = public.portal_client_id());


-- Team reviews (client ratings of employees)
CREATE TABLE IF NOT EXISTS team_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,
  employee_id   uuid NOT NULL,
  employee_name text NOT NULL,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text,
  period        text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE team_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_all" ON team_reviews;
CREATE POLICY "internal_all"  ON team_reviews FOR ALL    TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
DROP POLICY IF EXISTS "portal_insert" ON team_reviews;
CREATE POLICY "portal_insert" ON team_reviews FOR INSERT TO authenticated WITH CHECK (public.is_portal_client() AND client_id = public.portal_client_id());
DROP POLICY IF EXISTS "portal_read" ON team_reviews;
CREATE POLICY "portal_read"   ON team_reviews FOR SELECT TO authenticated USING (public.is_portal_client() AND client_id = public.portal_client_id());


-- Bonus requests (client-initiated performance bonuses)
CREATE TABLE IF NOT EXISTS bonus_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,
  employee_id   uuid NOT NULL,
  employee_name text NOT NULL,
  amount        numeric NOT NULL CHECK (amount > 0),
  note          text,
  status        text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE bonus_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_all" ON bonus_requests;
CREATE POLICY "internal_all"  ON bonus_requests FOR ALL    TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
DROP POLICY IF EXISTS "portal_insert" ON bonus_requests;
CREATE POLICY "portal_insert" ON bonus_requests FOR INSERT TO authenticated WITH CHECK (public.is_portal_client() AND client_id = public.portal_client_id());
DROP POLICY IF EXISTS "portal_read" ON bonus_requests;
CREATE POLICY "portal_read"   ON bonus_requests FOR SELECT TO authenticated USING (public.is_portal_client() AND client_id = public.portal_client_id());


-- Client documents (files stored in Supabase Storage, linked to client)
CREATE TABLE IF NOT EXISTS client_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL,
  name          text NOT NULL,
  category      text DEFAULT 'other' CHECK (category IN ('contract', 'nda', 'report', 'invoice', 'other')),
  file_url      text NOT NULL,
  file_path     text NOT NULL,
  file_size     bigint,
  uploaded_at   timestamptz DEFAULT now(),
  uploaded_by   text  -- internal user email who uploaded
);

ALTER TABLE client_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_all" ON client_documents;
CREATE POLICY "internal_all" ON client_documents FOR ALL    TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
DROP POLICY IF EXISTS "portal_read" ON client_documents;
CREATE POLICY "portal_read"  ON client_documents FOR SELECT TO authenticated USING (public.is_portal_client() AND client_id = public.portal_client_id());
DROP POLICY IF EXISTS "portal_insert" ON client_documents;
CREATE POLICY "portal_insert" ON client_documents FOR INSERT TO authenticated WITH CHECK (public.is_portal_client() AND client_id = public.portal_client_id());


-- Payment attempts (portal payments + scheduled AutoPay audit trail)
CREATE TABLE IF NOT EXISTS payment_attempts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id               uuid,
  client_id                uuid NOT NULL,
  client_name              text,
  invoice_number           text,
  stripe_payment_intent_id text,
  stripe_customer_id       text,
  stripe_payment_method_id text,
  amount                   numeric NOT NULL DEFAULT 0,
  currency                 text NOT NULL DEFAULT 'usd',
  source                   text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'autopay')),
  status                   text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'processing', 'succeeded', 'failed', 'requires_action', 'requires_payment_method', 'canceled')),
  failure_reason           text,
  attempted_at             timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  created_at               timestamptz DEFAULT now()
);

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_stripe_payment_intent_id_key
  ON payment_attempts (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_attempts_client_id_attempted_at_idx
  ON payment_attempts (client_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS payment_attempts_invoice_id_idx
  ON payment_attempts (invoice_id);

DROP POLICY IF EXISTS "internal_all" ON payment_attempts;
CREATE POLICY "internal_all" ON payment_attempts
  FOR ALL TO authenticated
  USING (public.is_internal())
  WITH CHECK (public.is_internal());

DROP POLICY IF EXISTS "portal_read" ON payment_attempts;
CREATE POLICY "portal_read" ON payment_attempts
  FOR SELECT TO authenticated
  USING (
    public.is_portal_client()
    AND client_id = public.portal_client_id()
  );


-- Working hour preferences (client can set their preferred schedule)
CREATE TABLE IF NOT EXISTS working_hour_prefs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid UNIQUE NOT NULL,
  monday_start    text, monday_end    text,
  tuesday_start   text, tuesday_end   text,
  wednesday_start text, wednesday_end text,
  thursday_start  text, thursday_end  text,
  friday_start    text, friday_end    text,
  timezone        text,
  notes           text,
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE working_hour_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_all" ON working_hour_prefs;
CREATE POLICY "internal_all"  ON working_hour_prefs FOR ALL    TO authenticated USING (public.is_internal()) WITH CHECK (public.is_internal());
DROP POLICY IF EXISTS "portal_read" ON working_hour_prefs;
CREATE POLICY "portal_read"   ON working_hour_prefs FOR SELECT TO authenticated USING (public.is_portal_client() AND client_id = public.portal_client_id());
DROP POLICY IF EXISTS "portal_upsert" ON working_hour_prefs;
CREATE POLICY "portal_upsert" ON working_hour_prefs FOR INSERT TO authenticated WITH CHECK (public.is_portal_client() AND client_id = public.portal_client_id());
DROP POLICY IF EXISTS "portal_update" ON working_hour_prefs;
CREATE POLICY "portal_update" ON working_hour_prefs FOR UPDATE TO authenticated USING (public.is_portal_client() AND client_id = public.portal_client_id());


-- ── Step 6: Reload PostgREST schema ──────────────────────────────────────────
-- Run this after all tables are created:
-- NOTIFY pgrst, 'reload schema';


-- ── Step 7: Netlify environment variables needed ──────────────────────────────
-- Add these in Netlify Dashboard → Site settings → Environment variables:
--
--   SUPABASE_URL              = https://<your-project>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY = <service role key from Supabase → Settings → API>
--
-- The service role key MUST stay server-side (Netlify functions only).
-- Never expose it in frontend code.


-- ── Step 8: Disable public sign-ups ──────────────────────────────────────────
-- Supabase Dashboard → Authentication → Providers → Email
-- → Turn OFF "Enable sign ups"
-- Clients are invited via the invite-client Netlify function.
-- Internal staff use the hidden /xDdasQwd24zaQ signup page.
