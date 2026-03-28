-- ============================================================
-- YVA LawOS — Supabase Migration Script
-- Run in Supabase SQL Editor when new project is ready
-- Run each block separately, then reload schema at the end
-- ============================================================


-- ─── New Tables ───────────────────────────────────────────────────────────────

-- Time Entries
create table if not exists time_entries (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid,
  employee_name text not null,
  project_id    uuid,
  project_name  text,
  client_name   text,
  date          date not null,
  hours         numeric not null,
  description   text,
  billable      boolean default true,
  invoiced      boolean default false,
  created_at    timestamptz default now()
);

-- Estimates
create table if not exists estimates (
  id           uuid primary key default gen_random_uuid(),
  number       text not null,
  client_id    uuid,
  client_name  text,
  project_id   uuid,
  project_name text,
  date         date not null,
  expiry_date  date,
  items        jsonb default '[]',
  notes        text,
  status       text default 'draft',
  total        numeric default 0,
  created_at   timestamptz default now()
);

-- Recurring Invoices
create table if not exists recurring_invoices (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid,
  client_name         text,
  project_id          uuid,
  project_name        text,
  amount              numeric not null,
  description         text,
  frequency           text not null,
  next_due_date       date not null,
  last_generated_date date,
  active              boolean default true,
  items               jsonb default '[]',
  created_at          timestamptz default now()
);

-- Tags
create table if not exists tags (
  id         uuid primary key default gen_random_uuid(),
  label      text not null unique,
  color      text not null,
  created_at timestamptz default now()
);


-- ─── Add Columns to Existing Tables ──────────────────────────────────────────

-- Activity log: Comms Hub type + auto flag
alter table activity_log add column if not exists type text default 'note';
alter table activity_log add column if not exists auto boolean default false;

-- Clients: tags (string[]), contracts (jsonb), links (jsonb)
alter table clients add column if not exists tags      jsonb default '[]';
alter table clients add column if not exists contracts jsonb default '[]';
alter table clients add column if not exists links     jsonb default '[]';

-- Projects: tags, contracts, links
alter table projects add column if not exists tags      jsonb default '[]';
alter table projects add column if not exists contracts jsonb default '[]';
alter table projects add column if not exists links     jsonb default '[]';

-- Invoices: tags
alter table invoices add column if not exists tags jsonb default '[]';

-- Employees: user_id (auth link), photo_url
alter table employees add column if not exists user_id   text;
alter table employees add column if not exists photo_url text;

-- Tasks: mentions (string[] of employee names)
alter table tasks add column if not exists mentions jsonb default '[]';


-- ─── RLS Policies for New Tables ─────────────────────────────────────────────
-- Run one at a time if needed

alter table time_entries       enable row level security;
alter table estimates          enable row level security;
alter table recurring_invoices enable row level security;
alter table tags               enable row level security;

create policy "auth_all" on time_entries       for all to authenticated using (true) with check (true);
create policy "auth_all" on estimates          for all to authenticated using (true) with check (true);
create policy "auth_all" on recurring_invoices for all to authenticated using (true) with check (true);
create policy "auth_all" on tags               for all to authenticated using (true) with check (true);


-- ─── Reload Schema (run last) ─────────────────────────────────────────────────

notify pgrst, 'reload schema';
