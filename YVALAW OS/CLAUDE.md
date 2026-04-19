# YVA LawOS — Claude Project Context

## Project Location
`C:\Users\cronu\Desktop\LegalWebs\YVALAW OS\`

## Tech Stack
- React 18 + TypeScript + Vite
- React Router v6
- **Supabase** (PostgreSQL + Auth + RLS) — all data persistence
- Plain CSS (no Tailwind) — design system in `src/styles.css`
- No npm UI libraries — all components hand-built
- Deployed on **Netlify** from GitHub repo: https://github.com/YVALaw/YVA-OS.git

---

## Client Portal ✅ (Phases 1–6 complete)

### Architecture
- Single `/login` page routes users to OS or portal based on role after sign-in
- `AppRole = UserRole | 'client'` — clients are a distinct role, never in internal OS routes
- `RoleContext` checks `user_roles` first (internal), then `client_users` (portal clients)
- `must_change_password: true` in Supabase `user_metadata` forces password set on first login
- Old shareable invoice view moved from `/portal` → `/invoice-view`
- Preview Portal: internal user can open any client's portal via `?preview=clientId` — uses `ClientShell` with gold banner; `portalNav()` helper preserves param across all navigate() calls
- DOP never shown on client-facing outputs — always pass `rate: 0` from portal to `buildInvoiceHTML`
- `uploaded_at` in `client_documents` is `timestamptz` — always send as ISO string, not ms integer

### Portal Files
- `src/components/ClientShell.tsx` — portal layout: dark navy sidebar desktop, bottom tab nav mobile; preview mode gold banner + Exit button
- `src/pages/portal/PortalSetPassword.tsx` — first-login forced password change
- `src/pages/portal/PortalDashboard.tsx` — KPIs, team cards (clickable → modal), latest invoice, projects; all hours from `time_entries` table
- `src/pages/portal/PortalBilling.tsx` — invoice list, status badges, filter tabs, PDF download (printInvoice rate:0), pay stub placeholder
- `src/pages/portal/PortalProjects.tsx` — project cards with team avatars, per-project billing summary
- `src/pages/portal/PortalTeam.tsx` — team grid, project filter tabs, employee detail modal, staff request CTA → modal
- `src/pages/portal/PortalDocuments.tsx` — client upload + download; synced with LawOS client profile
- `src/pages/portal/PortalSettings.tsx` — Account info (phone edit), Working Hours per-day schedule, Change Password
- `src/services/portalStorage.ts` — client-scoped data fetching (never use storage.ts in portal pages); includes `loadPortalWorkingHours` / `savePortalWorkingHours`
- `src/utils/invoiceHtml.ts` — shared `buildInvoiceHTML` / `printInvoice`; used by InvoicePage and PortalBilling
- `netlify/functions/invite-client.cjs` — server-side invite: creates auth user + sends email
- `supabase/client-portal.sql` — tables + RLS (run after rls.sql)

### Invite Flow
1. Admin opens a Client profile and chooses one of two invite actions:
   - **Email Invite** calls `/.netlify/functions/invite-client` with `{ clientId, email, mode: 'email' }`, creates the auth user, inserts `client_users`, and lets Supabase send the invite email.
   - **Copy Invite Link** calls the same function with `{ clientId, email, mode: 'link' }`, creates the auth user, inserts `client_users`, and returns a one-time invite link for manual delivery.
4. Client clicks magic link → `must_change_password: true` detected → `/portal/set-password`
5. Sets password → `must_change_password: false` cleared → `/portal/dashboard`

### Env Vars Needed (Netlify)
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (never expose in frontend)

### Portal Routes (all live)
- `/portal/dashboard` — Home ✅
- `/portal/billing` — My Billing ✅
- `/portal/team` — My Team ✅
- `/portal/projects` — My Projects ✅
- `/portal/documents` — Documents ✅ (client + internal upload, shared table)
- `/portal/messages` — Messages / Crisp chat (Phase 7 — pending Crisp account)
- `/portal/settings` — Settings ✅ (account info, working hours, change password)

### Settings Page — SQL Required
Run in Supabase SQL editor before using Settings → Working Hours:
```sql
CREATE TABLE IF NOT EXISTS working_hour_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  monday_start text, monday_end text,
  tuesday_start text, tuesday_end text,
  wednesday_start text, wednesday_end text,
  thursday_start text, thursday_end text,
  friday_start text, friday_end text,
  timezone text, notes text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(client_id)
);
ALTER TABLE working_hour_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_read_prefs"   ON working_hour_prefs FOR SELECT TO authenticated USING (client_id = portal_client_id() OR is_internal());
CREATE POLICY "client_insert_prefs" ON working_hour_prefs FOR INSERT TO authenticated WITH CHECK (client_id = portal_client_id() OR is_internal());
CREATE POLICY "client_update_prefs" ON working_hour_prefs FOR UPDATE TO authenticated USING (client_id = portal_client_id() OR is_internal());
```

### Staff Requests (OS side)
- `/requests` — OS page under CRM nav; shows all client staff requests with status workflow
- Shell sidebar: red badge on Requests nav item showing pending count (refreshes on navigation)
- `staff_requests` table: `client_name`, `hours_per_week`, `start_date` columns added to existing table
- RLS: internal read/update/insert + portal client insert/read-own

### Client Documents
- `client_documents` table: internal team uploads from ClientProfilePage; clients upload from PortalDocuments
- Both sides read the same table — uploads from either appear in both places
- `uploaded_at` is `timestamptz` — convert to/from ISO string in storage functions

### Security
- `client_users` table RLS: client can only read/update own row
- `is_internal()` helper gates all OS data from client users at DB level
- Separate portal-scoped read policies per table (clients, projects, invoices, employees, time_entries, client_documents, staff_requests)
- Invite function validates caller is internal staff before creating accounts
- Service role key lives in Netlify env only — never in frontend

---

## Session Progress — Client Portal

### Completed This Session
- **Phase 6 — Settings** (`/portal/settings`): account info, working hours per-day schedule, change password
- **Stripe Payments**: Pay button live on PortalBilling; PaymentModal with saved cards + Card Element; server functions for PaymentIntent + webhook
- **SQL alignment pass**: `supabase/client-portal.sql` now includes Stripe customer IDs, staff request columns, portal document insert policy, client phone update policy, and scoped `time_entries` RLS.
- **Payment hardening pass**: `create-payment-intent.cjs` now fetches invoice/client server-side, verifies invoice ownership, rejects non-payable statuses, and computes amount due from Supabase instead of trusting browser-supplied cents.
- **Setup docs cleanup**: `.env.example` now lists frontend Vite vars plus Netlify function vars; dashboard payment CTA now routes to Billing; Messages placeholder says Phase 7.
- **Dual invite modes**: Client profile now supports Supabase email invite and manual copy-link invite through `invite-client.cjs`.
- **Production deploy plumbing**: root `netlify.toml` now points Netlify at `YVALAW OS/netlify/functions`, fixing 404s for `/.netlify/functions/invite-client`.
- **Supabase Auth config fixed by user**: invite links now work after setting Supabase auth Site URL / redirect URLs for `https://yvastaffing.agency/os/**`.
- **Stripe Card Element fixes**: card input text is visible on the light modal, and Pay is disabled until Stripe fires the Card Element `ready` event.
- **Stripe modal refactor deployed/tested**: PaymentModal keeps the Stripe Card Element mounted during submission by using `isProcessing` instead of switching `step` to `processing`, fixing `We could not retrieve data from the specified Element...`. It asks for only cardholder name + ZIP/postal code before the Stripe Card Element and sends those as `billing_details` to Stripe.
- **AutoPay deployed/tested**: Client Billing has explicit AutoPay consent while paying, stores only Stripe customer/payment method IDs in `client_users`, and adds scheduled `run-autopay` Netlify function to charge due unpaid invoices for opted-in clients. Tested successfully: saved card, enabled AutoPay, ran AutoPay, Stripe payment succeeded, invoice marked paid.
- **Internal AutoPay visibility deployed**: Client profile header shows `AutoPay On`, `Card Saved`, `AutoPay Off`, or `No Portal`; Client Information includes an AutoPay row. SQL policy `client_users_internal_read` was added and run so internal users can read portal billing status.
- **Supabase Security Advisor cleanup**: RLS was enabled on the timesheet import tables, overly broad `auth_all` / `team_all` policies were replaced with scoped internal/portal policies, helper functions now have fixed `search_path = public`, and the final function diagnostic showed `current_user_role`, `is_internal`, `is_portal_client`, and `portal_client_id` all configured with `["search_path=public"]`.
- **Supabase Performance Advisor cleanup started**: A no-comments SQL cleanup query was copied to the clipboard to fix `auth_rls_initplan` warnings and consolidate duplicate permissive policies. Needs final confirmation by rerunning Supabase Performance Advisor and pasting any remaining rows.
- **Payment attempt history deployed/tested**: `payment_attempts` SQL/RLS was run, portal payment intent logging is live, Stripe webhook success/failure updates are live, and internal Client Profile Billing Activity is working. Manual portal payment produced expected `portal / succeeded` row in Supabase.
- **Payment operations polish deployed/tested**: Portal Billing can show failed latest payment/AutoPay warnings, saved card brand/last4/expiry when available, and setup-only payment attempts are hidden/de-emphasized in the internal Billing Activity table. Stripe PaymentIntents include `receipt_email`; successful webhooks/AutoPay update saved card metadata; payment success/failure events write system entries to the client activity timeline. Manual portal payment test confirmed saved card metadata, Billing Activity, and Communications timeline were all good.
- **Portal security hardening implemented locally**: Portal preview is restricted to CEO/Admin/Accounting, portal phone updates now go through `update-portal-profile.cjs`, AutoPay enable/disable now goes through `update-autopay-settings.cjs` with Stripe payment method ownership verification, direct portal RLS updates on `clients`/`client_users` were removed from `client-portal.sql`, and client document loads/uploads now use signed URLs for `client-docs/{clientId}/...` paths.
- **Latest pushed commits**:
  - `e248901` — Add LawOS client portal payments
  - `b1af500` — Add manual client portal invite links
  - `38ba3de` — Deploy LawOS Netlify functions
  - `8b371f3` — Fix Stripe card input visibility
  - `7fd00cd` — Wait for Stripe card element readiness
  - `14a8dd9` — Fix client portal payment modal
  - `45ebaa4` — Add client portal AutoPay
  - `01354f5` — Show client AutoPay status internally
  - `38b42df` — Add payment attempt tracking
  - `4284a67` — Add payment operations notifications

---

## ⚠️ PENDING SETUP — Must complete before portal is fully live

### 1. Supabase SQL ✅ Run on 2026-04-14

The full updated script was run successfully in Supabase SQL Editor:

```text
YVALAW OS/supabase/client-portal.sql
```

This supersedes the older three separate SQL blocks. It now includes:
- `client_users.stripe_customer_id`
- `client_users.auto_pay_enabled`, `default_payment_method_id`, `auto_pay_authorized_at`, `auto_pay_disabled_at`
- `client_users_internal_read` policy so internal profiles can read AutoPay/portal billing status
- `working_hour_prefs`
- portal-scoped `time_entries` read policy
- `staff_requests.client_name`, `hours_per_week`, `start_date`
- portal document upload insert policy
- client profile phone update policy

If the script is changed later, run it again and then run:

```sql
NOTIFY pgrst, 'reload schema';
```

---

### 1B. Supabase Security / Performance Advisor Cleanup — 2026-04-16

Security Advisor items handled:
- Critical `rls_disabled_in_public` on these public tables:
  - `timesheet_batch_invoices`
  - `timesheet_import_batches`
  - `timesheet_import_rows`
  - `timesheet_mappings`
- Function Search Path Mutable warnings fixed for:
  - `current_user_role`
  - `is_internal`
  - `is_portal_client`
  - `portal_client_id`
- Broad authenticated `USING (true)` / `WITH CHECK (true)` policies were replaced with scoped policies for internal staff and portal clients.
- User confirmed the Security Advisor looked good after these changes.

Performance Advisor items addressed by the cleanup SQL copied on 2026-04-16:
- `auth_rls_initplan` warnings by wrapping auth calls as `(select auth.uid())`.
- Duplicate permissive policies on portal/internal tables by consolidating same-role/same-action policy sets.

Validation still needed after running the Performance Advisor cleanup:

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd <> 'SELECT'
  AND (
    qual = 'true'
    OR with_check = 'true'
  )
ORDER BY tablename, policyname;
```

Expected result: `0 rows` for non-SELECT policies with unrestricted `true` checks.

Then rerun Supabase Dashboard → Database → Advisors → Performance and paste any remaining warnings before changing more SQL.

Post-RLS regression checklist:
- Internal LawOS login: dashboard, clients, invoices, projects, employees, tasks, settings.
- Client portal login: invoices, documents, requests, working-hour prefs, team reviews, bonus requests.
- Two-client isolation check: Client A must not see Client B invoices, projects, documents, employees, or requests.
- Payments: create test invoice, pay from portal, confirm Stripe payment and paid invoice status.
- AutoPay: verify saved card / AutoPay status, then run Netlify `run-autopay` against an eligible due invoice.
- Documents: upload/view/download internally and from portal if enabled.
- Internal CRUD: create/edit client, invoice, project/task, and delete a document if internal deletion is needed.

Remaining advisor item that is not SQL:
- Enable Supabase Auth leaked password protection in the Supabase dashboard if it still appears in Security Advisor.

---

### 2. Environment variables ✅ Mostly set on 2026-04-14

**Local dev `.env` currently has:**
```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

**Netlify dashboard vars set during this session:**
```
SUPABASE_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_STRIPE_PUBLISHABLE_KEY   (test mode key)
STRIPE_SECRET_KEY             (test mode key)
STRIPE_WEBHOOK_SECRET         (test mode webhook)
```

`GMAIL_CLIENT_SECRET` was skipped because Gmail is not connected for this project yet. Add it later only when Gmail OAuth is configured.

---

### 3. Stripe Dashboard setup ✅ Test mode

Stripe test-mode webhook destination was created.

Webhook endpoint:
```text
https://yvastaffing.agency/.netlify/functions/stripe-webhook
```

Subscribed event:
```text
payment_intent.succeeded
payment_intent.payment_failed
```

Test-mode webhook signing secret was added to Netlify as `STRIPE_WEBHOOK_SECRET`.

---

### 4. Deploy checklist
- [x] Push repo to GitHub (`git push`)
- [x] Netlify auto-deploys from GitHub — latest tested payment/AutoPay work through commit `01354f5`
- [x] Run `YVALAW OS/supabase/client-portal.sql` in Supabase
- [x] Set Netlify env vars (Supabase + Stripe test mode)
- [x] Set up Stripe webhook + copy signing secret
- [x] Add `VITE_STRIPE_PUBLISHABLE_KEY` to Netlify env (Vite needs it at build time)
- [x] Test manual invite link flow enough to confirm Supabase redirect config works
- [x] Commit/push PaymentModal refactor and retest Stripe payment after deploy
- [ ] Test portal on mobile (bottom nav, upload, PDF, Pay button, AutoPay status)
- [x] Run a test Stripe payment with card `4242 4242 4242 4242` (test mode)
- [x] Run updated `supabase/client-portal.sql` before testing AutoPay
- [x] Verify Netlify `run-autopay` works for an opted-in test client with a due invoice
- [x] Verify internal client profile shows AutoPay status
- [x] Add and run `payment_attempts` SQL/RLS
- [x] Add and run saved-card metadata columns on `client_users`
- [x] Add `payment_intent.payment_failed` to the existing Stripe webhook destination
- [x] Deploy commits `38b42df` and `4284a67`
- [x] Test manual portal payment after deployment: `payment_attempts`, saved card metadata, Client Profile Billing Activity, and Communications system entry all looked good
- [ ] Test AutoPay success/failure after the payment operations deployment

---

### Next Steps

#### Phase 7 — Messages (requires Crisp account)
- `/portal/messages` — embed Crisp live chat widget; identify user by email + clientId on load
- **Blocked:** need Crisp website ID from user before this can be built
- Implementation: ~30 lines — load Crisp script, call `window.$crisp.push(["set", "user:email", [email]])`

#### Phase 8 — Production Payment Operations
Payments and AutoPay are now working in test mode. The next missing operational pieces:
1. **Payment attempt history** — implemented/deployed via `payment_attempts`; manual payment success tested in Supabase and LawOS.
2. **AutoPay failure tracking** — implemented/deployed in `run-autopay`; failed off-session charges should write `payment_attempts.status = 'failed'` with `failure_reason`, client activity log entries, portal Billing warning, and internal Client Profile visibility. Needs actual AutoPay failure test next.
3. **Client profile billing panel** — first pass implemented: AutoPay badge + Saved Card + Last Payment / Last Attempt + Billing Activity table. Later expansion can add last portal login.
4. **Payment receipts** — PaymentIntents now include `receipt_email`; confirm Stripe receipt behavior in test/live mode before relying on it operationally.
5. **AutoPay notifications** — internal timeline notifications are implemented. Email/SMS notification remains optional later.
6. **Mobile portal QA** — test bottom nav, Billing, payment modal, AutoPay status, Documents upload/download, PDF download, Team cards, and Staff Request modal on mobile.
7. **Live-mode readiness** — before real charges, switch Stripe keys/webhook from test to live, create the live webhook endpoint, verify live env vars, and repeat a small live payment test.
8. Gmail integration remains optional/pending until Google OAuth client ID/secret are configured.

Tomorrow's suggested start:
1. Create a small due unpaid invoice for an AutoPay-enabled test client.
2. Run Netlify `run-autopay`.
3. Verify Supabase `payment_attempts` gets `source = autopay` and `status = succeeded`.
4. Repeat with a failing saved card if practical, expecting `status = failed`, a `failure_reason`, portal Billing warning, internal Payment Failed badge, Billing Activity row, and Communications system entry.
5. If AutoPay testing passes, next build item is either mobile portal QA or Stripe Customer Portal for client-managed saved cards.

Security hardening validation before push/deploy:
1. Run updated `supabase/client-portal.sql` or at least the changed policy/storage section before testing the deployed functions.
2. Confirm portal client can save phone number from Portal Settings.
3. Confirm portal client can enable and disable AutoPay after a payment.
4. Confirm recruiter/lead-gen cannot use `?preview=clientId`; CEO/Admin/Accounting still can.
5. Confirm client Documents upload/download still works. Existing client documents should load through signed URLs when `file_path` is present.
6. Recheck Supabase Security Advisor for public bucket listing warnings after the storage policy cleanup.

#### Optional Enhancements (post-deploy)
- **Notification preferences** — toggle email alerts for new invoices, document shares
- **Portal analytics** — track client logins and portal activity in `activity_log`
- **Stripe Customer Portal** — let clients manage saved cards themselves via Stripe's hosted portal

---

## Current Logic Updates
- Employee schedule and premium-rate logic now live in the app layer: default shift start/end plus premium start time and premium percent are stored on each employee.
- Invoice calculations now use the saved employee schedule when available. Premium time increases both client billing and employee payroll; missing schedule falls back to regular rate.
- Daily-grid invoice entries and simple total-hour entries both use the same payroll split logic.
- Reports payroll CSV now uses premium-aware invoice items instead of raw hours × rate.
- Per-project invoice numbering now recovers from saved invoices if `nextInvoiceSeq` drifts, instead of blindly trusting the cached counter.
- Hour parsing accepts decimal hours, `h:mm`, and legacy minute-style values like `3.08` meaning `3h 08m`.
- Gmail auth now uses a Netlify server function for token exchange and refresh; the Google client secret lives in `GMAIL_CLIENT_SECRET` on Netlify, not in the browser.
- USD→DOP auto-fetch now comes from InfoDolar Banco BHD data via a Netlify function, with manual entry still available.
- Candidate conversion now creates the employee record when moved to hired and removes the candidate card once conversion is complete.

## UI Notes
- Projects cards keep their action buttons inside the card on narrow widths; the footer now wraps instead of overflowing.
- The Projects pipeline uses the same wrapped action layout so buttons stay inside the card at smaller display sizes.
- Team has a project-grouped view that nests employees under each assigned project and keeps an Unassigned lane for staff without a project.

## Data Storage (Supabase tables)
| Table | Contents |
|-------|----------|
| `employees` | Employee[] |
| `projects` | Project[] |
| `clients` | Client[] |
| `invoices` | Invoice[] |
| `candidates` | Candidate[] |
| `expenses` | Expense[] (per-project expenses) |
| `general_expenses` | Expense[] (business-wide expenses) |
| `tasks` | Task[] (per-project kanban tasks) |
| `activity_log` | ActivityLogEntry[] (per-client timeline notes) |
| `invoice_templates` | InvoiceTemplate[] (saved builder templates) |
| `settings` | AppSettings (single row — exchange rate, company info, etc.) |
| `counters` | { key: 'invoice' \| 'employee', value: number } |
| `estimates` | Estimate[] (quotes/proposals with line items) |
| `time_entries` | TimeEntry[] (per-employee hourly logs) |
| `recurring_invoices` | RecurringInvoice[] (auto-billing schedules) |

All data is scoped to the authenticated user via Supabase RLS.

### Storage service (`src/services/storage.ts`)
- All load/save functions go through this module — no direct Supabase calls in pages
- `toSnake` / `toCamel` converters handle JS camelCase ↔ DB snake_case mapping
- `syncAll(table, items)` upserts all items and deletes removed rows
- Strips `created_at` from upserted rows; converts empty strings to `null`

## Authentication
- Supabase Auth (email + password)
- Login page: `src/pages/LoginPage.tsx`
- Sign-up available to anyone with the link (no invite required)
- **Remember me** checkbox (default: on) — if unchecked, signs out on tab/window close via `beforeunload`
- Session handled by Supabase SDK automatically when Remember Me is on

## Pages & Routes
| Route | Page | Notes |
|-------|------|-------|
| `/` | ReportsPage | Dashboard: KPI cards, 6-month bar chart, attention panel, invoice history |
| `/invoice` | InvoicePage | Project-grouped collapsible list + React builder + bulk status update |
| `/clients` | ClientsPage | Kanban + cards + outstanding balance per card + Remind button |
| `/clients/:id` | ClientProfilePage | Full profile: KPIs, inline edit, projects, invoice history, activity log |
| `/employees` | EmployeesPage | Card grid + Statements panel + auto employee number |
| `/employees/:id` | EmployeeProfilePage | Full profile: inline edit, assigned projects, attachments, earnings statements |
| `/candidates` | CandidatesPage | Kanban (Applied/Screening/Interview/Offer/Hired/Rejected) |
| `/candidates/:id` | CandidateProfilePage | Full profile: inline edit, attachments, onboarding checklist (when hired) |
| `/projects` | ProjectsPage | Kanban + cards + employee assignment |
| `/projects/:id` | ProjectProfilePage | Full profile: inline edit, task board, expenses, invoice history, team |
| `/settings` | SettingsPage | Tabbed: Company, Email (templates), Integrations (Gmail), Currency, Notifications, Data (backup/restore/danger) |
| `/estimates` | EstimatesPage | Estimates list + right-side slide panel + line-item builder; status: draft/sent/accepted/declined/expired |
| `/time` | TimeTrackingPage | Time log with KPI cards, filters, slide panel to log hours per employee/project |
| `/portal` | PortalPage | Read-only client-facing invoice view (outside Shell, no nav) |
| `/oauth-callback` | OAuthCallbackPage | Handles Google OAuth2 redirect after Gmail authorization (outside Shell) |
| `/login` | LoginPage | Email/password login + sign-up toggle + Remember Me |

## Profile Page Architecture
- All entity list pages (Clients, Employees, Projects, Candidates) navigate to profile routes on card click
- Profile pages use inline edit mode (`editing` boolean) — no separate modal
- Pattern: `const entityNN = entity!` after early-return null check, to satisfy TypeScript narrowing
- Action buttons in list cards use `stopPropagation` to prevent card-click navigation
- `GlobalSearch` in Shell topbar searches all entities and navigates to profile routes

## Design System
- Dark theme: `--bg: #020617`, `--surface: #0b1428`, `--surf2: #0e1a35`
- Gold accent: `--gold: #f5b533`, `--goldl: #ffd57e`
- Font: Inter (system fallback)
- Card-heavy layout: `.entity-card`, `.card-grid`, `.avatar`
- All kanban boards use `.kanban-board` + `.kanban-col-{stage}` color classes

## Invoice System
- **"+ New Invoice"** → opens full React `InvoiceBuilder` component in a fullscreen modal
  - Per-employee daily hours grid OR simple total hours mode
  - Auto-generates invoice number: per-project prefix (FNPR0001) or global INV-001
  - Fields: client, project, invoice date, due date, billing period, notes/message
  - Supports h:mm, comma-decimal, and legacy minute-style hour formats (8:30 = 8.5h, 3.08 = 3h08m)
  - Templates: save current form as reusable template, load from list
  - Employee rows can inherit saved shift start/end and premium pay settings from the employee profile
  - Premium math is shared between billing, payroll estimates, and statement reporting
- **"Quick Invoice"** → simple modal for fixed-price invoices — always creates as `sent`, auto-emails client
- When invoice is created via builder or Quick Invoice → status auto-set to `sent` + email auto-sent
- Invoices page is **project-grouped**: collapsible sections per project, table rows per invoice; Unassigned section at bottom
  - **All groups collapsed by default** — uses an `expanded` Set (empty = all closed)
  - Each group header shows **unpaid count** (sent/overdue/partial) in red dot badge
- Each project group has "+ Quick" and "+ Invoice" buttons that pre-fill the project
- Email button: sends via Gmail if connected, otherwise opens mailto: — **invoice HTML attached as `invoice-{number}.html`**
- PDF button: opens print-formatted window with logo, due date, notes — **no DOP on client-facing PDFs**
- Share button: copies base64 portal link to clipboard

## Per-Project Invoice Numbering
- First letter of each word in project name → prefix (max 5 chars, uppercase)
- Project stores `nextInvoiceSeq` but the builder also recovers from the highest saved invoice number for that project
- e.g. "Food Net PR" → `FNPR0001`, `FNPR0002`, ...
- Falls back to global `INV-NNN` when no project selected

## Employee Auto-Numbering
- Format: `YVA{2-digit-year}{3-digit-seq}` → e.g. `YVA26001`
- Counter stored in `counters` table (key: `employee`)
- Assigned on employee creation (not editable)

## Client Portal
- Route `/portal` renders read-only invoice view (no Shell wrapper)
- Invoice data encoded in URL hash as base64: `btoa(encodeURIComponent(JSON.stringify(payload)))`
- Payload: `{ inv: Invoice, dopRate?: number }`
- Share button on invoice cards copies the portal URL to clipboard

## Employee Statements
- Available on both EmployeesPage (panel) and EmployeeProfilePage (inline section)
- Date range filter (From/To) with quick Clear
- Summary: total hours, base rate, premium-adjusted total USD, total DOP (if rate set)
- Per-invoice breakdown with daily hours grid if available
- Premium split is shown when an employee has a saved premium schedule
- "Totals by Project" section
- **PDF Payslip** — opens print-formatted window (includes DOP)
- **Email Statement** — sends via Gmail API with statement attached as `statement-{name}-{period}.html`
  - Button shows "Sending…" while in flight; disabled to prevent double-send
  - Green toast on success, error toast if Gmail fails
  - Shared HTML builder: `src/utils/statementHtml.ts` → `buildStatementHTML()`

## Activity Log (Clients)
- "Activity" button on each client card (both views)
- Opens modal with chronological timeline of free-text notes
- Add note with Enter key or button; delete individual entries
- Stored in `activity_log` table keyed by `clientId`

## Task Board (Projects)
- "Tasks" button on each project card opens 3-column kanban (To Do / In Progress / Done)
- Inline task creation per column: title, assignee, due date
- Drag-and-drop between columns
- Task count shown on project cards

## Invoice History (Dashboard/Reports)
- Full filterable invoice history table at bottom of ReportsPage
- Filters: client text search, project dropdown, status dropdown, date from/to
- Quick buttons: "This Month", "This Year", "Clear"
- Shows running total of filtered results
- **Export CSV** — downloads filtered invoices as CSV
- **Payroll CSV** — downloads per-employee hours/rate/USD/DOP for filtered invoices

## Bulk Invoice Status Update
- Cards view on InvoicePage has checkboxes per invoice
- "Select All" button selects all filtered invoices
- Status dropdown + "Apply to Selected" button updates all checked invoices at once

## Reports / Dashboard KPIs
| Card | Description |
|------|-------------|
| Total Billed | Sum of invoices in date range |
| Total Hours | Hours billed in range (h mm format) |
| Est. Payroll | Hours × employee pay rates |
| Business Expenses | Sum of general expenses in date range (orange) |
| Net Earnings | Billed minus payroll minus business expenses |
| Paid | Count of paid invoices |
| Unpaid | Count of unpaid invoices |
| Top Client | Highest revenue client in range |
| Clients | Total clients in system |
| Team | Total employees |

Also shows: Employee Performance table, Revenue by Client/Project, All-Time Client/Project analytics, Insights.

## Currency Conversion
- Settings page has USD→DOP exchange rate field
- "Auto-fetch" button hits a Netlify function that scrapes InfoDolar Banco BHD sell rate
- Rate stored in `settings` table
- **DOP shown only in employee-facing outputs** (statements, payslips, internal invoice cards)
- **DOP never shown on client-facing outputs** (invoice PDF, invoice preview, invoice email attachment, portal)

## Notifications
- Browser Notification API
- Settings → Enable → requests permission
- "Check Now" sends test notifications for overdue/draft invoices
- Uses `/public/yva-logo.png` as notification icon
- **Weekly reminder scheduler**: Settings → select day-of-week → fires on app open if not yet fired today
  - Stored as `reminderDay` (0=Sun…6=Sat) + `reminderLastFired` (ISO date) in settings
  - Fires from `maybeFireReminder()` in `App.tsx` via `useEffect` on mount

## Invoice Statuses
`draft` | `sent` | `viewed` | `paid` | `overdue` | `partial`
- `partial` (orange badge): invoice partially paid — stores `amountPaid` amount on the record
- Partial payment amount editable in the status-change modal

## Gmail Integration
- Service: `src/services/gmail.ts` — OAuth2 PKCE flow, Netlify-backed token exchange/refresh, `sendGmailMessage()`, `sendEmail()` (universal)
- `sendEmail(to, subject, body, attachment?)` — uses Gmail API if connected, falls back to `mailto:` if not
  - Optional `attachment: { name, content, mimeType }` — builds multipart/mixed MIME when provided
  - Attachment content is base64-encoded and line-wrapped at 76 chars per RFC 2822
  - `mailto:` fallback does not support attachments (browser limitation)
- **Per-user OAuth**: each logged-in user connects their own Gmail account independently
  - `gmailClientId` stored in shared `settings` table (one per org)
  - `GMAIL_CLIENT_SECRET` lives in Netlify environment variables
  - `gmailAccessToken`, `gmailRefreshToken`, `gmailTokenExpiry`, `gmailEmail` stored in **Supabase user metadata** (`supabase.auth.updateUser({ data: {...} })`)
  - Read via `supabase.auth.getUser()` → `user.user_metadata`
- **OAuth flow**: User enters Google OAuth Client ID in Settings → clicks "Connect Gmail" → PKCE redirect to Google → callback at `/oauth-callback` → token exchange/refresh handled by `/.netlify/functions/gmail-oauth` → tokens saved to user metadata
- Token auto-refreshes on expiry using stored refresh token
- Disconnect option in Settings clears all Gmail tokens from user metadata
- **Setup**: Google Cloud Console → enable Gmail API → OAuth 2.0 Client ID (Web application) → add `{origin}/oauth-callback` as Authorized Redirect URI
- All email-sending functions (invoice email, payment reminder, statement email, client reminder) use `sendEmail()` and therefore support Gmail automatically

## Expense Tracking
- Projects have an "Expenses" button → modal to log expenses per project (stored in `expenses` table)
- **General/Business Expenses** stored in `general_expenses` table — org-wide costs not tied to a project
- Expense fields: description, amount, date, category
- Project cards show: budget, billed, expenses totals with % used; red warning at 90%+
- General expenses shown as "Business Expenses" KPI on dashboard, deducted from Net Earnings

## Invoice Duplication
- Duplicate button on invoice cards copies an invoice, resets status to `draft`, assigns new INV-NNN number, sets today's date

## AR Aging / Accounts Receivable
- ReportsPage has an AR Aging section (below KPIs): 0-30 / 31-60 / 61-90 / 90+ day buckets
- Calculates from `dueDate || date`; shows unpaid invoices sorted by age with balance (amount − amountPaid)

## Revenue Forecasting
- ReportsPage: last 3 months totals + average as a forecast card

## Client Retention Watch
- ReportsPage: lists clients with no invoice in 60+ days

## Contract Renewal Alerts
- Client records have `contractEnd?: string` field
- Clients within 60 days of expiry show warning on their card (orange ≤60d, red = expired)
- ReportsPage Needs Attention panel also shows each expiring contract with days remaining

## Employee Capacity View
- EmployeesPage has a "Capacity" toggle above the card grid
- Shows active employees, their assigned projects, hours billed this month, and earnings

## Employee Payslip PDF
- Both EmployeesPage and EmployeeProfilePage: "PDF Payslip" opens print-formatted window
- Includes: logo, period, KPI grid (hours, USD, DOP), per-invoice breakdown, auto-prints
- Uses shared `buildStatementHTML()` from `src/utils/statementHtml.ts`

## Employee Statement Email
- Both EmployeesPage and EmployeeProfilePage: "Email Statement" sends via Gmail API
- Attaches full statement HTML as `statement-{name}-{period}.html`
- Includes sending state + toast confirmation (see Employee Statements section)

## Onboarding Checklist
- CandidatesPage: dragging/moving a candidate to `hired` stage creates the employee record, removes the candidate card, and auto-opens onboarding checklist modal
- 8 standard onboarding tasks with checkboxes, progress counter, "All Done!" button

---

## Completed Features
- [x] Full React port — all pages, no legacy iframe
- [x] Card-heavy design system with dark theme
- [x] Kanban pipelines: Invoices, Clients, Projects, Candidates
- [x] Invoice pipeline (Draft/Sent/Viewed/Paid/Overdue)
- [x] Full React invoice builder (daily hours grid, simple mode, templates)
- [x] Per-project invoice numbering (PREFIX + sequence, recovers from saved invoices when the counter drifts)
- [x] Invoice due date field (shown on cards, PDF, portal)
- [x] Invoice notes/message field (shown on cards, PDF, portal)
- [x] Invoice templates (save/load reusable builder state)
- [x] Invoice bulk status update (checkboxes + apply)
- [x] Invoice history table with full filters + CSV export
- [x] Payroll CSV export (per employee, per period)
- [x] Client portal (shareable read-only invoice URL via base64 hash)
- [x] Employee statements panel (date filter, totals by project, PDF)
- [x] Employee auto-numbering (YVA{YY}{NNN})
- [x] Richer employee profiles (role, employment type, location, hire year, status, notes)
- [x] Richer client profiles (company, phone, timezone, default rate, payment terms, tags, notes)
- [x] Activity log per client (timestamped free-text notes timeline)
- [x] Per-project task board (3-column kanban in modal)
- [x] Employee-to-project assignment UI (multi-select checkboxes, shown on cards)
- [x] Document/link storage on Client and Project records
- [x] Employee email invoices (Gmail API with invoice HTML attached; mailto: fallback)
- [x] Invoice PDF export (print window with logo + notes + due date — no DOP on client invoices)
- [x] USD→DOP currency conversion (manual + auto-fetch from InfoDolar Banco BHD)
- [x] Browser notifications (overdue/draft invoice alerts)
- [x] Settings: company info, email signature, exchange rate, backup/restore
- [x] Reports: full KPI dashboard, bar chart, employee performance, all-time analytics
- [x] h:mm hour format parsing (8:30 = 8.5h in daily cells)
- [x] Invoice partial payment status (orange badge, amountPaid field, AR balance tracking)
- [x] Invoice duplication (copy → new number, reset to draft)
- [x] AR aging dashboard (0-30 / 31-60 / 61-90 / 90+ buckets with unpaid invoice table)
- [x] Revenue forecasting (last 3 months average on dashboard)
- [x] Client retention watch (clients with 60+ days since last invoice)
- [x] Contract renewal alerts (client cards + dashboard Needs Attention panel)
- [x] Expense tracking per project (log expenses, budget vs actual, category)
- [x] Employee capacity view (toggle in EmployeesPage — projects + hours this month)
- [x] Employee payslip PDF (print-formatted window; shared `buildStatementHTML` util)
- [x] Employee statement email (Gmail API with HTML attachment; sending state + toast confirmation)
- [x] Candidate hire conversion (creates employee record, removes candidate card, opens onboarding checklist)
- [x] Employee schedule + premium pay rules (saved shift defaults, night premium start/percent)
- [x] Premium-aware invoice/payroll math (billing + statements)
- [x] Legacy minute-style hour parsing (`3.08` = 3h08m)
- [x] Per-project invoice counter recovery from real saved invoices
- [x] Gmail server-side token exchange/refresh via Netlify function
- [x] InfoDolar Banco BHD USD→DOP auto-fetch via Netlify function
- [x] Onboarding checklist (auto-opens when candidate moved to Hired stage)
- [x] Weekly invoice reminder scheduler (day-of-week trigger, fires on app open)
- [x] Full-page profile routes for Employees, Clients, Projects, Candidates (no more modals)
- [x] GlobalSearch in Shell topbar (searches all entities, color-coded, navigates to profiles)
- [x] Monthly revenue goal + progress bar (Settings + Dashboard)
- [x] Email templates in Settings (invoice, statement, reminder) with placeholders
- [x] Employee anniversary alerts in Dashboard Needs Attention panel
- [x] Outstanding balance per client card + Remind button
- [x] Employee Statement Email uses template from Settings
- [x] Profile photo upload on Employee and Client profile pages (base64 dataUrl, camera overlay on hover)
- [x] Invoice page: project-grouped collapsible list view (replaced kanban — sections per project, table rows per invoice)
- [x] Invoice auto-send on creation (status → `sent` + email via `sendEmail()`)
- [x] Gmail OAuth2 PKCE integration (`src/services/gmail.ts`) — actual Gmail API send, Netlify-backed token exchange/refresh, mailto: fallback if not connected
- [x] **Supabase migration** — all data moved from localStorage to Supabase PostgreSQL + Auth
- [x] **Login page** — email/password auth with sign-up toggle and Remember Me checkbox
- [x] **Invoice groups collapsed by default** — all project sections closed on load; unpaid count shown in header
- [x] **Business Expenses KPI on dashboard** — general expenses card + deducted from Net Earnings
- [x] **Per-user Gmail OAuth** — each user's Gmail tokens stored in Supabase user metadata (not shared)
- [x] **Role-based dashboards** — CEO sees full financials; Admin sees team/ops KPIs; Accounting sees invoice/AR KPIs; Recruiter/Lead Gen see their own views
- [x] **CEO-only financials** — revenue charts, invoice history, payroll CSV, AR aging, forecasting all gated by `can.viewOwnerStats(role)`
- [x] **Team Access settings tab** — visible and editable by CEO only
- [x] **Login UX** — persists last email across logout; brute-force lockout (5 fails → 15-min cooldown); password strength meter on signup
- [x] **Security headers** — `public/_headers` sets X-Frame-Options, CSP, HSTS, etc. for Netlify
- [x] **Supabase RLS** — row-level security on all tables; settings/user_roles write-restricted to CEO; script at `supabase/rls.sql`
- [x] **crypto.randomUUID()** — all entity creation uses UUID instead of timestamp-based IDs (required by Supabase UUID columns)
- [x] **UI redesign — YVA LawOS light theme** — Flowlu-style: white surface, light gray bg, dark navy sidebar (#1b1e2b), yellow (#facc15) accent; KPI cards with yellow top border; all entity pages updated
- [x] **Sign-up hidden at /signup** — login page is invite-only; /signup is accessible only via direct link
- [x] **Estimates page** — full estimates pipeline at `/estimates`; line-item builder with qty/unit price; status lifecycle (draft→sent→accepted/declined/expired); right-side slide panel; convert-to-invoice button (accepted estimates); KPI summary cards
- [x] **Time Tracking page** — time log at `/time`; per-employee/project entry; billable toggle; date range + employee + project filters; KPI cards (total/billable/unbillable hours + billable %); right-side slide panel
- [x] **Recurring Invoices tab** — tab in InvoicePage at `/invoice`; create/edit recurring schedules (weekly/biweekly/monthly); active/pause/delete; linked to client + project; right-side slide panel
- [x] **Live Timer (Time Tracking)** — global start/stop punch clock stored in localStorage; runs across all pages in the topbar; auto-creates time entry on stop; pre-fills logged-in employee; `src/hooks/useActiveTimer.ts`
- [x] **Employee auto-link** — on login, matches user email to Employee record → writes `userId` → shows "My Profile" link in sidebar; auto-clears on sign-out
- [x] **Employee profile — Time Log section** — shows time entries for that employee (KPI cards + table), loaded from `time_entries` table
- [x] **Tags/Labels** — `Client.tags: string[]`, `Project.tags: string[]`, `Invoice.tags: string[]`; `TagBadge` + `TagInput` components; `tagStorage.ts`; shown on client/project cards and forms
- [x] **Contract Storage** — `Contract` type with status (draft/active/expired/terminated), dates, value, notes, file upload; contracts section on Client and Project profile pages; Supabase Storage for files
- [x] **@mentions on Tasks** — `MentionInput` component detects `@` and shows employee dropdown; mentions stored in `Task.mentions[]`; `@Name` highlighted yellow in task cards
- [x] **Calendar View** — `/calendar` page; monthly grid (no external lib); shows invoice due dates, project end dates, estimate expiry, task due dates; color-coded event dots; day detail panel; filter by event type
- [x] **Client Comms Hub** — Option A (auto-log of app actions + manual notes); timeline per client (planned, follow Option A architecture)
- [x] **Supabase Storage file uploads** — attachments (images, PDFs, audio, video) upload to `attachments` bucket instead of base64 in DB; max 200 MB
- [x] **Video support in attachments** — Employee and Candidate profiles accept video files; inline player uses fetch→blob to bypass CORS range-request blocking; extension-based MIME detection for Windows compatibility
- [x] **Force-download for attachments** — download button fetches as blob with `application/octet-stream` so PDFs and videos save instead of opening in browser

---

## Architecture Notes

### App.tsx routing
- `/portal` and `/oauth-callback` and `/login` render **outside** Shell (no nav/sidebar)
- All other routes render inside `Shell`, protected by auth check
- Unauthenticated users redirected to `/login`

### Storage service (`src/services/storage.ts`)
Single module exports all load/save functions. No direct Supabase calls in pages (except SettingsPage `doClear` and `exportData` which need direct table access).

### Invoice builder (`src/components/InvoiceBuilder.tsx`)
Standalone component used inside the builder modal in InvoicePage. Handles:
- Employee row management, daily hours grid, simple totals mode
- `parseHours(val)` supports: `"8"`, `"8.5"`, `"8,5"`, `"8:30"`, `"3.08"` → decimal
- Template save/load via `invoice_templates` table
- Per-project invoice number generation with `nextInvoiceSeq` mutation plus fallback recovery from saved invoices

### New Supabase tables needed (run when reconnecting)
When the new Supabase project is set up, create these tables in addition to existing ones:
- `estimates` — columns matching `Estimate` type (id uuid PK, number, client_id, client_name, project_id, project_name, date, expiry_date, items jsonb, notes, status, total, created_at timestamptz default now())
- `time_entries` — (id uuid PK, employee_id, employee_name, project_id, project_name, client_name, date, hours, description, billable bool, invoiced bool, created_at)
- `recurring_invoices` — (id uuid PK, client_id, client_name, project_id, project_name, amount, description, frequency, next_due_date, last_generated_date, active bool, items jsonb, created_at)

### Supabase schema notes
- `name`, `role`, `location`, `timestamp` are PostgreSQL reserved words — wrapped in double quotes in SQL
- `created_at` is a DB-managed `timestamptz` — never included in upserts
- Empty strings converted to `null` before upsert (avoids numeric column errors)
- After schema changes, run: `notify pgrst, 'reload schema'` in Supabase SQL editor
- `toCamel` / `toSnake` only convert **top-level row keys** — JSONB values (like `attachments[]`) are stored and returned as-is in camelCase

### Supabase Storage
- Bucket: `attachments` (public) — stores employee and candidate file attachments
- Path convention: `employees/{id}/{timestamp}-{random}.{ext}` and `candidates/{id}/...`
- Service: `src/services/fileStorage.ts` — `uploadFile(file, folder)` returns `{ storageUrl, storagePath }`; `deleteFile(storagePath)` removes from Storage
- `Attachment` type has `storageUrl?: string` and `storagePath?: string` fields alongside legacy `dataUrl`
- **Video playback**: uses `VideoPlayer` component (fetch→blob→URL.createObjectURL) to bypass CORS range-request blocking on Supabase Storage URLs
- **Storage policies** (run in SQL Editor, one at a time):
  ```sql
  CREATE POLICY "auth_upload" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'attachments');
  CREATE POLICY "auth_read"   ON storage.objects FOR SELECT TO authenticated USING  (bucket_id = 'attachments');
  CREATE POLICY "auth_delete" ON storage.objects FOR DELETE TO authenticated USING  (bucket_id = 'attachments');
  CREATE POLICY "public_read" ON storage.objects FOR SELECT TO anon           USING  (bucket_id = 'attachments');
  ```

### Role system (`src/lib/roles.ts`)
- Roles: `ceo` | `admin` | `accounting` | `recruiter` | `lead_gen`
- `can.viewOwnerStats(role)` → CEO only — gates all revenue/financial data
- `can.manageRoles(role)` → CEO only
- Role stored in `user_roles` table; cached in `sessionStorage` to prevent flicker; cleared on `SIGNED_OUT` auth event

---

## Business Context
- **Company:** YVA Staffing — bilingual virtual staffing (DR/Latin America) for U.S. businesses
- **Billing:** USD (invoiced to clients), paid to employees in DOP
- **Exchange rate source:** InfoDolar Banco BHD → https://www.infodolar.com.do/precio-dolar-entidad-banco-bhd.aspx → sell rate under USD/DOP
- **Invoice model:** Hourly (hours per employee × rate per hour = invoice total)
- **Clients:** Professional services, law firms, startups
- **Team size:** ~100 members

## Key Constraints
- No npm UI libraries — keep CSS self-contained
- Logo at `/public/yva-logo.png`
- Legacy builder at `/public/legacy/` — kept for reference but no longer used in app
- Netlify SPA routing: `public/_redirects` contains `/* /index.html 200`
