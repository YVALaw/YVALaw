# YVA LawOS — Claude Project Context

## Project Location
`C:\Users\cronu\Desktop\LegalWebs\YVALAW OS\`

## Roadmap
**`PLAN.md`** (agreed 2026-10-31, not built yet): automatic weekly close (tracked hours → one combined draft invoice per client), live employee earnings, Friday payroll in DOP, per-person bill/pay rates (from the old CRM YVALaw/YVA-OS), permissions + change history, Gmail sending, notifications (bell + email + phone), installable "YVA OS" phone app, My workspace redesign, CRM. Read it before starting any of that work — it lists every decision Hans made.

## UI redesign (2026-11) — read `REDESIGN.md` before touching any screen
- The whole UI follows the owner's mockup `design_handoff_yva_os_redesign` (Geist/Geist Mono, navy + gold, floating dock). **Design system:** `src/styles/ds.css` (tokens + primitives, BEM-ish `.btn.btn--primary`), `src/components/ui/index.tsx` (PageHeader, Card, KpiStrip, Segmented, Tabs, Chips, Field, Drawer, Modal, Sheet, Menu, Pill/toneFor, Banner, Avatar, Skel, useIsMobile…), icons `<Ic d={P.name} />` in `components/Icon.tsx`, formatters `src/utils/format.ts`. Screen CSS lives per hub in `src/styles/<hub>.css` with a class prefix (`home- fin- crm- ops- ppl- set- por- mw-`). No inline styles except dynamic values. The legacy `styles.css` was cut to the rules still in use (586 lines).
- **Shell** (`components/Shell.tsx`, `styles/shell.css`): breadcrumb header, bell, account menu (My profile, Settings, Preview client portal with a client picker, Open employee workspace, Install app, Sign out), navy dock with hubs Home / CRM / Finance / Operations / People, hub pop-ups (desktop) / bottom sheets (phone) with live status lines (`services/hubStatus.ts`), "/" search palette (pages + records), gold + Create menu, sibling chips above every hub page. IA and visibility rules: `src/lib/nav.ts` (same rules as the old sidebar). Phone (<760px): bottom dock, the header shows the page title, `PageHeader` hides its H1 unless `keepTitleOnPhone`.
- **Deep links:** `?create=` (invoice, payment, lead, client, project, manual time, employee, expense) open each page's create flow; `/invoice?open=<id>`, `/invoice?edit=<id>`, `/invoice?create=invoice&project=<id>`, `/leads?open=<id>`, `/clients/:id?tab=`, `/projects/:id?tab=|?edit=1`, `/settings?tab=`, `/time?tab=`.
- New routes: `/` = `HomePage` (role KPIs, Needs attention, This week, pipeline, tracking now, 6-month chart with goal), `/reports` = Reports (Finance hub; everything the old dashboard had), `/me` for staff with a linked employee (`EmployeeWorkspace staffView`, gold banner).
- Saved views (Clients, Invoices) are per user in `localStorage` (`yva_views_clients`, `yva_views_invoices`).
- New SQL (run after the step scripts): `migrate-redesign-portal.sql` (staff_requests headcount/project), `migrate-redesign-finance.sql` (expense receipts), `migrate-redesign-people.sql` (announcements notify when a scheduled post goes live; with the `announcements-publish` scheduled function). Re-run `migrate-redesign-people.sql` after re-running step 7.
- Redesign extras (SQL `migrate-redesign-settings.sql`, `migrate-redesign-people-extras.sql`): Settings → Company **Website / Invoice footer / logo upload** (`settings.company_website`, `invoice_footer`, `company_logo_url/path`; printed on invoices + statements); **Crisp** chat (`settings.crisp_website_id`, portal reads it only through `public.portal_chat_config()`; Messages loads the widget). **Invoice item lines** (`InvoiceItem.kind = 'item'`, description × qty × price in `rate`, `hoursTotal` 0; `utils/invoiceLines.ts`): estimate → invoice copies the estimate's lines; every hours/payroll/statement sum must skip them (`hourLines` / `isItemLine`). `employee-earnings` returns `pendingAdjustments` (bonuses/deductions waiting for a payday, shown in My pay). `employees.hire_date` drives anniversaries; employee profile shows activity % / on-time %; Time Tracking → Live shows connected computers.
- **Data loading (2026-11) — `src/lib/readCache.ts` + `src/services/liveUpdates.ts`, read their headers before touching loaders.** (1) Every database read goes through `writeAwareFetch` (the Supabase client's fetch): successful GET/HEAD reads are kept in memory and identical reads share one request, so every page/loader is covered automatically. Never kept: `notifications`, `counters`, `desktop_link_codes`, `push_subscriptions`, `data_versions`, and any read asking for "since <a moment in the last ~25 h>" (tracking now, today's live board, recently seen computers). (2) `cachedRead(key, loader)` shares parsed results for a few seconds (and remembers which tables its loader read). (3) **Change stamps** (`supabase/migrate-live-updates.sql`): `public.data_versions` holds one number per watched table, bumped by a statement-level trigger on every insert/update/delete/truncate (any role, server functions included). `liveUpdates.ts` subscribes to it with Supabase Realtime; a push drops only the kept reads whose tables (main + embedded `select=…,clients(…)`) changed. A read of stamped tables is kept until it changes (30 min safety net); unstamped tables, reads made before the first stamp check, and everything before the SQL runs are kept `LIST_MS` (1 min). **No timed background refresh** (the old keep-warm interval is gone: it cost a re-read per window per minute). If the live connection is down, opening a page (`pageChanged`, ≥10 s apart) or returning to the window (≥30 s) does one small `data_versions` read. **When adding a table that pages show, add it to the `watched` list in that script** (otherwise it stays on the 1-minute rule). (4) **Any write clears everything** — through the client (except read-only RPCs in `READ_ONLY_RPC`: add new read-only RPCs there) and POSTs to Netlify functions (`watchFunctionWrites`) — before sending and again when it finishes; stamps arriving within 8 s of your own save are treated as yours. (5) Shell shows "Someone on your team just changed something on this page — Show latest" when a teammate's change touches a table the current page read (`onTeamChange`; Show latest remounts the page via a `key`); ClientShell uses the same hook without the banner. (6) `startKeepWarm` (Shell, 2.5 s after the first page) now only runs `warmUpLists()` once. The bell gets new notifications pushed (Realtime on `notifications`, filtered to the person; poll every 2 min only while not live); Home "working now" and the Live board poll every minute only while visible. `loadInvoiceCounter` / `loadEmployeeCounter` are always live; the InvoiceBuilder clears the cache when it opens. Sign-out → `forgetEverything()`. Screens are `React.lazy` (`lib/lazyPage.ts`, `rarePage` for sign-in screens; `preloadPages()` 4 at a time after sign-in). Dock status lines start 1.5 s after the first page and use count/column queries. Tests: `tests/readCache.test.ts`, scratchpad `live-ui.cjs` (mocked Realtime socket), `live-updates-sql-test.py`, `perf-*.cjs`.
- **Photos/files never inside records:** profile photos are shrunk to 320 px and uploaded (`utils/photo.ts` → `attachments` bucket, `photos/<table>/<id>/…`); add-employee/candidate attachments upload via `uploadFile`. Settings → Data → **Make lists load faster** (CEO, `services/slimRecords.ts`) moves old inline photos/files to Storage (only changed columns written; failures left as they were).
- **Old CRM → YVA OS (2026-11):** `supabase/start-fresh-DELETES-ALL-DATA.sql` (owner runs it once: empties every business table incl. paid payroll lines and history, removes every non-CEO login, keeps settings / permissions / CEO logins, resets counters; refuses if there's no CEO; 30 SQL checks both ID modes). Settings → Data → **Import from old CRM** (CEO): `utils/oldCrm.ts` (pure conversion, `tests/oldCrm.test.ts`) + `services/oldCrmImport.ts` (preview → copy files → upsert on id with original `created_at` → counters → read-back check). Old short ids → deterministic UUIDs (re-import updates, never duplicates); hours per invoice from its own total (old CRM wrote "39.51" = 39 h 51 min from April 2026, decimals before) → decimal `hoursTotal` + `daily` "h:mm"; `billAmount` kept; status lower-cased; `client_id` from the client name; résumés/videos copied from inline data or the old project's storage; columns the database lacks are dropped and reported. Invoice lines now show `billAmount` when present (`lineAmount`), so night-premium lines add up to the total; the builder stores `billAmount`.
- **Payments (Stripe, 2026-11) — `supabase/migrate-stripe-secure.sql`, server rules in `netlify/functions/_lib/payments.cjs` (pure, `tests/payments.test.ts` with `tests/helpers/fakeBackend.ts`), API in `_lib/stripe.cjs` (form-encoded REST, pinned `2024-06-20`, `keyMode`).** (1) **Money moves only through `client_payments`**: one row per Stripe payment (`external_ref` = PaymentIntent id, `kind` payment), refund (`kind` refund, negative, one row per Stripe refund `re_…`, read from `/refunds?charge=`; failed/canceled refunds deleted again) or dispute (`kind` dispute, negative, `dispute:<id>`, deleted again if the dispute is won); **once an invoice has payment rows, `amount_paid` = their sum and the status follows** (BEFORE UPDATE trigger `private.invoice_paid_from_payments`; `client_payment_adjust` only touches the row; an amount paid from before the rows becomes one manual "Earlier payments" row, also backfilled by the script) — so a status edit or whole-list save can never make a paid invoice payable/chargeable again; InvoicePage keeps `amountPaid` on status edits and re-reads the result (`reconcilePaid`). Manual rows can't carry `external_ref`/`stripe_charge_id`. **Re-run the script after re-running step 4.** Stripe rows can't be inserted, edited or deleted from the app (RLS `source = 'manual'`); `payment_attempts` and `stripe_events` are read-only from the app. (2) **`stripe-webhook`**: signature (5 min), other-mode events ignored (`keyMode` vs `event.livemode`), each event claimed once in `stripe_events` (a copy arriving while the first is still running gets 409), 500 on any failure so Stripe retries (every handler is safe to repeat); attempt rows never go back from succeeded/canceled. Events: `payment_intent.succeeded/processing/payment_failed/requires_action/canceled`, `charge.refunded`, `charge.refund.updated` (also handles `refund.*`), `charge.dispute.created/funds_withdrawn/funds_reinstated/closed`, `setup_intent.succeeded`, `payment_method.detached/automatically_updated/updated`. Overpayment and non-USD → bell for `payments.record`. (3) **Portal pay** (`create-payment-intent`): the client's own portal login only (staff preview can't charge — staff send a pay link), ownership by `client_id` (name only for invoices without one), amount from the database, one reusable PaymentIntent per invoice + login (updated if balance or "save" changed; Idempotency-Key per minute), card + `us_bank_account` (Financial Connections, `verification_method: 'instant'` in the portal; Checkout keeps automatic incl. micro-deposits), `setup_future_usage` only when the client ticks the box, refused while a bank payment is `processing`. UI: `PaymentModal` (Payment Element; saved card → `confirmCardPayment`, saved bank → `confirmUsBankAccountPayment`), bank → "on its way" (≈4 business days). (4) **Saved methods/AutoPay**: `setup-payment-method` (SetupIntent) + `AddPaymentMethodModal`, `update-autopay-settings` (method must belong to the login's customer; `saveOnly`), `portal-remove-card` detaches in Stripe first. The webhook only saves a paid-with method if asked and none is saved — AutoPay never switches methods by itself. **`run-autopay.cjs`** (daily 13:00 UTC): latest consent per client, invoices by `client_id` only (never by name), invoices with a refund/dispute skipped, history read fails closed, `autopayDecision`: due date required, nothing in flight (processing / requires_action / recent success), max 3 tries 3 days apart (staff told on the last), Idempotency-Key per invoice/amount/day, never writes invoices; 22 s budget. (5) **Pay links** (`pay-link.cjs`, `/pay` rewrite in root `netlify.toml`): staff (CEO/Admin/Accounting or `invoices.send`) POST → URL with an HMAC token (invoice id + 60-day expiry, key `PAY_LINK_SECRET` or derived from the service-role key); GET re-checks the balance and redirects to Stripe Checkout (card + bank), reusing an open session; paid / clearing / expired → small HTML page. `createPayLink` in `services/payments.ts`; "Copy pay link" in Record payment; invoice and reminder emails get a "Pay online" line automatically while a balance is owed (`payLinkFor` / `withPayLink` in `services/invoiceEmail.ts`, `{payLink}` placeholder to place it; the email still goes if the link can't be made). (6) **Refunds**: `refund-payment.cjs` needs the new permission `payments.refund` and a `requestId` per click (idempotency); amount ≤ payment − earlier refunds/disputes; the refund row arrives via the webhook. (7) Settings → Integrations → Stripe = `StripeStatusCard` from `stripe-status` (key modes must match, account can charge / ACH on, last webhook event, unprocessed events). (8) **Email permission**: `send-email` allows CEO/Admin/Accounting, or `invoices.send` / new `email.send`; the `email_log` row is written first (`sending`, then sent/failed/blocked) so parallel requests count against the limits; attachments must be real PDFs. (9) **Security headers for `/os/*` live in the root `netlify.toml`** (Netlify never served the old `YVALAW OS/public/_headers`; it was removed): CSP allows this project's Supabase host only (`rwgteyixmbpaxfebwznb` — change it there if the project moves), Stripe (`js.stripe.com`, `*.stripe.com`), Crisp, Google Fonts; **no `'unsafe-inline'` scripts** — the print windows' one-line auto-print scripts are allowed by sha256 (`tests/csp.test.ts` fails if one changes without its hash). Tests: scratchpad `stripe-secure-sql-test.py` (53, both ID modes), `redesign-portal-ui.cjs` (fake Payment Element), `csp-ui.cjs` (headers enforced).
- **Old-CRM parity (2026-11):** (1) **CC emails** — SQL `migrate-cc-emails.sql` (`clients.cc_emails`, `employees.cc_emails`, `invoices.client_cc_emails`, text[] nullable). Client "Invoice CC" + billing contacts (Client → Contacts "Gets invoices") are Cc'd on invoice emails, reminders, quick invoices, weekly-close sends, client reminders; each invoice keeps its Cc snapshot; employee "Statement CC" on statements. Rules in `services/emailRecipients.ts`, lists in `utils/emailList.ts`; `sendEmail(to, subject, body, { attachments, cc })` (`utils/mime.ts` builds the send-email request, header-injection safe; mailto gets `cc=`). Works before the SQL runs (fields disabled, CC never sent if the column is missing — `ccColumnExists` in storage.ts). (2) **Real PDFs** — `utils/pdf.ts` (jsPDF + html2canvas, loaded only when a PDF is made) attaches letter-size PDFs to invoice, reminder and statement emails; client invoices never show DOP. (3) **Staff profiles + who-did-what** — SQL `migrate-staff-profiles.sql`: audit trigger on the remaining tables, `audit_log.action` allows `'event'`, `public.log_action()` (staff only, actor stamped server-side; browser helper `services/activityLog.ts`, never throws; in `READ_ONLY_RPC`), index `audit_log_actor`, `lead_activities` history needs `leads.view_all`. **Re-run it after re-running Step 1.** Settings → Team Access: Open / Create / Link profile (`services/staffProfiles.ts`, `StaffProfileModal`); account menu My profile / Create my profile; employee page **Activity** tab (`HistoryList actorId`, history.view); "Created by · Last changed by" (`RecordSignature`, `services/auditTrail.ts`) on client, employee, project pages and the invoice preview; sign-ins, emails, exports/imports logged. (4) Import carries CC lists and turns old per-person project rates (`assignments`) into `placement_rates` (effective from the project's first invoice). (5) People ↔ projects from the people side: `components/people/ProjectAssign.tsx` (employee form, employee page, project Team tab quick add). Team / Invoices open grouped by project; view switches remember the last choice (`lib/stickyView.ts`, localStorage `yva_view_<page>`).
- InvoicePage keeps the builder mounted (only `hidden`) at phone width — a resize/rotation across 760 px used to wipe a half-built invoice.
- **Toasts vs banners (2026-11):** the result of a click (sent, saved, copied, deleted, created, failed…) is a **toast** — small white card top-right under the header (phones: top, full width), coloured left edge, ×, gone after 4 s (success/info) or 6 s (warning/error), paused while hovered, max 3, newest on top. API: `const toast = useToast()` (`src/context/ToastContext.tsx`, provider in `App.tsx`) → `toast.success(msg)`, `toast.error(msg)`, `toast.warning(msg)`, `toast.info(msg)`, optional `{ duration, action: { label, onClick } }` for a button such as "Open invoice" (8 s); `addToast(msg, type, duration)` still works. CSS `.toast*` in `ds.css`. A **`Banner`** stays for situations that remain true: preview/setup/"run this SQL" notices, the portal AutoPay-failed warning, Integrations problems, the live-updates banner, load errors, and errors/validation inside forms, drawers and modals (next to the form). Browser test: scratchpad `toast-ui.cjs`.
- Browser tests per hub: scratchpad `redesign-<hub>-ui.cjs` (the old `step*-ui.cjs` target the old markup and are retired).

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
CREATE POLICY "client_read_prefs"   ON working_hour_prefs FOR SELECT TO authenticated USING (client_id = private.portal_client_id() OR private.is_internal());
CREATE POLICY "client_insert_prefs" ON working_hour_prefs FOR INSERT TO authenticated WITH CHECK (client_id = private.portal_client_id() OR private.is_internal());
CREATE POLICY "client_update_prefs" ON working_hour_prefs FOR UPDATE TO authenticated USING (client_id = private.portal_client_id() OR private.is_internal());
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
- `private.is_internal()` helper gates all OS data from client users at DB level
- Separate portal-scoped read policies per table (clients, projects, invoices, employees, time_entries, client_documents, staff_requests)
- Invite functions validate the caller against an explicit staff-role list (`STAFF_ROLES` / `INVITER_ROLES`), never "anything but client"
- Service role key lives in Netlify env only — never in frontend
- **Portal clients have no direct read on `employees`** (a row policy can't hide columns, so the old `portal_client_employees` policy exposed pay rate, notes and attachments through the API). `loadPortalEmployees(clientId)` calls `netlify/functions/portal-team.cjs`, which picks the client server-side (portal clients always get their own; staff preview may pass `clientId`), takes employee IDs from that client's projects and returns client-safe fields only. Run `supabase/migrate-portal-employees-lockdown.sql` **after** deploying this. Never re-add a client SELECT policy on `employees`.

---

## YVA Time — Phase 0 (employee logins) ✅ built, needs SQL + deploy

Groundwork for the YVA Time Windows desktop tracker (Electron, Phase 1). Plan decisions: Windows only; clients see hours only (never screenshots); screenshots for **client-placed** staff only, about 1 per 10 min at a random moment, employee can delete within 2 min (the 10-min block is removed); YVA team screenshots off; manual time per employee with admin approval; activity % later; the YVA OS web timer is removed (desktop app is the only live tracker).

- **Run `supabase/migrate-yva-time-phase0.sql` before deploying** — adds `employees.works_for` (`'client'` | `'yva'`, default `'client'`) and `employees.manual_time_allowed` (default false); marks employees linked to staff logins as `'yva'`.
- Employee form (EmployeesPage + EmployeeProfilePage): **Works For** (Client project / YVA team) and **Manual Time** (Off / On).
- **Employee logins:** Employee profile → **YVA Time Login** card → Email Invite / Copy Invite Link → `netlify/functions/invite-employee.cjs` (staff in `INVITER_ROLES` only; email taken from the employee record; sets `employees.user_id`; deletes the login if linking fails; user_metadata `{ role: 'employee', employee_id, must_change_password }`).
- `AppRole` `'employee'`: RoleContext uses the metadata hint (routing only) → App routes to `/me/set-password` on first login, then **My workspace** (`src/pages/me/EmployeeWorkspace.tsx`, route `/me`). Employees never reach the internal OS, the portal or the pending queue.
- Employees have **no direct table access** (RLS stays staff-only). Their data comes from `netlify/functions/employee-me.cjs` (GET, finds the employee by `employees.user_id` server-side, returns safe fields + assigned projects with client names — no pay rate, premium, notes or attachments). The desktop app will reuse it.
- `employees.user_id` is written only by `linkEmployeeLogin()` (staff auto-link, only if unlinked) and `invite-employee` — `saveEmployees()` strips `userId` so a stale whole-table save can't unlink a login.
- Web timer removed: `useActiveTimer`, top-bar timer pill and Start/Stop on Time Tracking are gone; "+ Log Manual" stays for admins.
- **Links people open from an email/message always point at the real site:** `APP_URL` (`src/lib/appUrl.ts`, `https://yvastaffing.agency/os/`, override with `VITE_PUBLIC_APP_URL`) — employee and client invites, "Forgot password?" and new sign-in links. Before, they used the admin's current address, so an invite made on a Netlify preview pointed at the preview, Supabase refused it and fell back to its Site URL. **Supabase → Authentication → URL Configuration** must have Site URL `https://yvastaffing.agency/os/` (with `https://`) and Redirect URL `https://yvastaffing.agency/os/**`.
- **Copy new sign-in link** (employee profile, when they already have a login — expired invite, link used wrongly, forgotten password): `invite-employee` `mode: 'reset'` returns a one-time Supabase recovery link (never creates a login) → **`/reset-password`** ("Choose a new password", any role, then home). "Forgot password?" on the login page uses the same page (it used to point at a non-existent `/reset-password` on the marketing site).

## YVA Time — Phase 1 (desktop app) ✅ built, needs SQL + deploy + first installer

- **Run `supabase/migrate-yva-time-phase1.sql`** (after phase0). Adds:
  - `tracker_blocks` — one row per employee + 10-minute block + target (`target_key` = `project:<id>` or `work:<type>`); the app upserts **absolute** seconds (retries are safe). Trigger: server timestamps + **max 600 s per employee per block** across targets.
  - `tracker_screenshots` — one row per screen; `created_at` forced to server time. When the **employee** deletes their own screenshot (allowed **2 minutes after upload**), a trigger marks that block's rows `status = 'removed'`. Staff deletes don't change hours.
  - private bucket **`screenshots`** (`<employee_id>/<yyyy-mm-dd>/<id>-<monitor>.jpg`, JPEG, 3 MB max).
  - `desktop_link_codes` — sign-in codes; RLS on, no policies (service role only).
  - Helpers `private.current_employee_id()`, `current_employee_is_yva()`, `employee_on_project(uuid)`, `can_view_screenshots()` (CEO/Admin).
- **RLS rules:** employees write only their own blocks, for projects they're on (client team) or YVA work types (YVA team), `source='desktop'`, `status='tracked'`, block within the last 7 days and not in the future; they can't approve/remove. Staff (`is_internal`) read/write all blocks. **Screenshots (rows + files): CEO/Admin only**, plus the employee's own. Clients: nothing (hours only — Phase 2 rollup into `time_entries`). Tested on a local Postgres with Supabase stand-ins (35 checks).
- **Sign in with YVA OS** (no password in the app): app makes a PKCE verifier/challenge → opens `/os/connect-app?challenge&state` → person clicks Connect → `desktop-link-create` (logins linked to an employee only) returns a 5-minute one-time code (only its sha256 is stored) → page opens `yvatime://auth?code&state` (or shows the code to paste) → app calls `desktop-link-redeem` with code + verifier → gets a magic-link `token_hash` + Supabase URL/anon key → `verifyOtp` gives the app **its own** session (encrypted with Windows DPAPI). `/connect-app` survives the login screen (`src/lib/connectApp.ts`). Functions need `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_ANON_KEY`) in Netlify env.
- **Desktop app:** `../YVA Time/` (Electron 44 + React; see its README). Client team: projects + screenshots at a random moment in each 10-minute block (all monitors, ≤1600 px JPEG), shown in the app with a 2-minute Delete. YVA team: work types (`WORK_TYPES` in `src/main/config.ts`) + any assigned projects, no screenshots. Idle: every second without input is held aside; input within 5 min counts it, 5+ min asks Keep/Remove. Break, offline queue (saved locally, uploaded every minute), tray icon (green/orange/grey), starts with Windows, closes to tray. First-run notice for the client team (consent stored locally; server record = Phase 2). Verified: 15 engine unit tests + an Electron end-to-end run under Xvfb against a fake backend (27 checks: sign-in incl. wrong-state refusal, screenshot capture/upload/delete, idle, offline, YVA team).
- **Admin:** Time Tracking → **Live** (CEO/Admin/Accounting: who is tracking now — a block updated in the last 3 min — today's hours, current project + note) and **Screenshots** (CEO/Admin: employee + day, hour rows of six 10-minute cells, signed URLs, full-size view, delete).
- **Retention:** `purge-old-screenshots.mjs` runs daily (netlify.toml) and deletes screenshots older than **60 days** (files, then rows; was 90 until Step 0 of PLAN.md). The app's notice promises this.
- **Installer:** `.github/workflows/yva-time-windows.yml` builds `YVA-Time-Setup.exe` on windows-latest (Run workflow → artifact; tag `yva-time-v*` → GitHub Release). Then set Netlify `VITE_YVA_TIME_DOWNLOAD_URL=https://github.com/YVALaw/YVALaw/releases/latest/download/YVA-Time-Setup.exe` to show the Download button in My workspace. Code signing + auto-updates: Phase 3.

## YVA Time — Phase 2 (approvals → money flow) ✅ built, needs SQL + deploy

- **Run `supabase/migrate-yva-time-phase2.sql`** (after phase1). Adds:
  - `time_entries.source` (`manual` | `tracker`), `tracker_key` (unique), `approved_by`, `approved_at`. **Approved tracker time is rolled up into `time_entries`** — one row per employee + day + project/work type (`tracker_key = employee|day|target_key`), `billable = true` for client projects. So the client portal (hours only, via the existing portal policy), the time log, invoices and payslips all read the same numbers.
  - `tracker_blocks` unique key is now `(employee_id, block_start, target_key, source)` (desktop and manual rows side by side; the app upserts with that key and only reads back `source = 'desktop'`). The 600 s cap counts tracked + pending + approved.
  - `manual_time_requests` — employees with `manual_time_allowed` request missing time (last 14 days, ≤ 12 h, their projects or YVA work types); they can cancel while pending.
  - `tracker_consents` — the app records when the screenshot notice was accepted (shown on the employee profile).
  - **Functions (SECURITY INVOKER, CEO/Admin/Accounting only):** `yva_time_approve(employee, from, to, tz)` marks tracked blocks approved (finished days only — not today) and calls `yva_time_rollup` (rebuilds the day totals; idempotent). `yva_time_decide_request(request, approve, note, tz)` splits approved manual time into 10-minute blocks, **clipped to the room left in each block** (never double-counts tracked time), then rolls up. Tested on local Postgres (36 checks).
- **Time Tracking → Approve** (CEO/Admin/Accounting): week grid per employee (hours/day, ● = not approved yet), **Approve** = Monday → yesterday of that week; manual requests with Approve / Reject (reject asks for a reason the employee sees). Days are counted in the admin's browser time zone (`LOCAL_TZ`).
- **Time log:** YVA Time rows are read-only (badge, no edit/delete) and the page saves **one entry at a time** (`upsertTimeEntry` / `deleteTimeEntry`, never the whole-table `syncAll`, which could delete server-written rows). It reloads when you come back from another tab.
- **Invoice builder → "Import YVA Time hours"** (needs a project + billing period): fills the daily grid from approved hours, written as `h:mm` (`hoursToHM`) because the grid reads `7.25` as 7 h 25 min; asks before overwriting typed hours.
- **Payslips:** `trackedPayEntries()` (`src/utils/trackedPay.ts`) adds approved **non-billable** tracker hours (YVA team work types) × pay rate to statements/payslips on both the Team page and the employee profile. Client-project hours stay paid through invoices (no double pay). No premium split for these hours yet.
- **My workspace:** **My hours** (this/last week by day, approved vs not) and **Add missing time** (form + my requests with status / YVA's note / Cancel) when Manual Time is on. Work types: `src/lib/yvaTime.ts` — keep identical to `YVA Time/src/main/config.ts`.
- **Desktop app 0.2.0:** records consent (retried until saved), "Add missing time" menu item (opens `/os/me#manual`, only when allowed), Windows shift reminders from the profile's shift times (start: not tracking 10–60 min after a weekday shift starts; end: still tracking 30 min – 6 h after it ends; once per shift; overnight shifts supported — `src/main/reminders.ts`, unit-tested). App ID set for Windows notifications.
- Phase 3 (below) added activity %, the schedule report, computers/disconnect, reopen and auto-updates.

## YVA Time — Phase 3 (activity, schedule, computers, updates) ✅ built, needs SQL + deploy + installer

- **Run `supabase/migrate-yva-time-phase3.sql`** (after phase2). **YVA Time 0.2.0 can no longer save time after this** — install 0.3.0+. Adds:
  - `tracker_blocks.active_seconds` (seconds with keyboard/mouse use — only *whether* there was input, never what; client team only, `NULL` for the YVA team and manual time), `first_offset` / `last_offset` (first/last counted second inside the block, 0–599). Checks: active ≤ seconds, first ≤ last.
  - `tracker_consents.notice_version` (2 = screenshots + activity; `NULL` = 1). The app shows the notice again to anyone who accepted version 1.
  - `desktop_devices` — one row per computer sign-in, created by `desktop-link-redeem` with the app's login **session id** (JWT claim `session_id`). Employees can only read their own and update `app_version` / `signed_out_at` (column grants + trigger keep `last_seen_at` / `signed_out_at` on server time); staff read all. **`private.current_desktop_session_ok()`** — the request's session belongs to a connected, not-signed-out computer of this login — is now required for employee inserts/updates of `tracker_blocks`, `tracker_screenshots` rows and `screenshots` bucket uploads.
  - `public.yva_time_disconnect_device(device, by)` — **service role only**: sets `revoked_at/by` and deletes that `auth.sessions` row (refresh token dies).
  - `public.yva_time_reopen(employee, from, to, tz)` — CEO/Admin/Accounting: approved blocks → `tracked`, removes the rolled-up `time_entries` (refused if any are `invoiced`). Re-approving works as before.
  - `yva_time_decide_request` now also writes first/last second for approved manual time.
  - Tested on local Postgres with Supabase stand-ins (`auth.jwt()`, `auth.sessions`, service role): 55 checks.
- **Sign-in change:** `desktop-link-redeem` now verifies the magic-link token **server-side** (`POST /auth/v1/verify`), records the computer (name, platform, app version) and returns the session + `deviceId`; the app calls `setSession`. If the computer can't be recorded, that session is ended again. **`desktop-device-revoke`** (CEO/Admin/Accounting) calls the disconnect function. 21 function checks against a fake Supabase.
- **Desktop app 0.3.0:** counts active seconds and first/last second per block (unit-tested, 27 engine tests); every sync starts with a **check-in** (update its `desktop_devices` row) — if YVA disconnected the computer the app signs itself out ("YVA disconnected this computer…", local time kept), if it was signed in by 0.2.0 it asks to sign in again; Sign out marks the computer signed out. Shows the employee their own **Activity %** today (client team). **Automatic updates** (`src/main/updater.ts`, electron-updater from this repo's GitHub Releases: checks 30 s after start and every 4 h, downloads in the background, "Restart to update" banner, otherwise installs on quit; the quit path now ends with `app.quit()` so that works). Electron 44.9.3 (fixes the eMudhra certificate advisory). Installer settings moved to `electron-builder.config.cjs`; **code signing switches on by itself** once Azure Trusted Signing (or a certificate file) secrets/variables exist — see `YVA Time/README.md`. Workflow checks the tag matches `package.json` and publishes `latest.yml` + `.blockmap` with the installer. End-to-end run under Xvfb against a fake backend: 50 checks.
- **Time Tracking:** **Schedule** tab (CEO/Admin/Accounting) — per person per weekday: first–last tracked moment, hours, and On time / Late Xm / Left Xm early / No time / Only outside shift hours / On shift, using the profile's Default shift (Mon–Fri, viewer's time zone, "Allow 0/5/10/15 min" grace; overnight shifts grouped into one work day starting 4 h before the shift; logic in `src/utils/schedule.ts`, 8 tests incl. DST). Weekend columns only when someone worked them. **Activity %** on Live (today), Approve (week, under the hours) and Screenshots (day + each 10-minute cell): green 60%+, amber 30–59%, red under 30%. **Approve → Reopen week** for approved hours.
- **Employee profile → YVA Time Login:** notice version, and **Computers** (name, app version, online now / last seen / signed out / disconnected) with **Disconnect** (CEO/Admin/Accounting, `can.manageDevices`).
- **Release:** bump `YVA Time/package.json` version and merge, then Actions → "YVA Time — Windows installer" → Run workflow with **Publish** ticked (or push tag `yva-time-v<version>`); installed apps update themselves. 0.3.0 was the first published release.

---

## Automation & growth plan — build log (see `PLAN.md`)

### Step 0 — Screenshots ✅ built, not merged
- **Desktop app 0.4.0** (version bumped, **not published**): the latest screenshot is also written full size to `userData/last-screenshot/screen-N.jpg` (replaced by each new screenshot, removed when deleted / another person signs in); clicking the thumbnail opens it (`shell.openPath`, IPC `openLastShot(screen)`), "Open screen 1 2" for several monitors. Upload failures that aren't "offline" are kept as `uploadProblem` in the snapshot → "N screenshots waiting to upload — reason". **Log file** `src/main/logfile.ts`: `console.warn/error` of the main process mirrored to `userData/logs/yva-time.log` (rotates at 1 MB → `yva-time.old.log`); ⋯ menu → **Show log file (for YVA support)** reveals it in Explorer. E2E: 57 checks.
- **YVA OS:** `/time?tab=screens&employee=ID&day=YYYY-MM-DD` opens a person's screenshots (TimeTrackingPage reads the query; `ScreenshotDay` takes `initialEmployee` / `initialDay`). **View screenshots** on the employee profile (YVA Time Login card) and on Live rows (client team, time today) for `can.viewScreenshots`.
- **My workspace → My screenshots:** `ScreenshotDay` with `self={ employeeId, projectNames }` — no picker, no delete, project names from `employee-me`; uses the existing employee read policies on `tracker_screenshots`, `tracker_blocks` and the `screenshots` bucket (no SQL).
- Retention 60 days (`purge-old-screenshots.mjs` `KEEP_DAYS`, app notice, Time Tracking subtitle).

### Step 1 — Foundation ✅ built, not merged — run `supabase/migrate-step1-foundation.sql`
- **Safe saving** (`src/utils/syncPlan.ts`, used by `syncAll` in `services/storage.ts`): pages still pass whole lists, but a save now inserts new rows (null columns omitted so defaults apply), **updates only changed columns** (grouped `UPDATE … WHERE id IN`), and deletes only rows the page itself had: `LoadTracker` tags loaded row objects with their load "generation" (filter/map keep the untouched objects), so rows created elsewhere later (Sunday job, another person) are never deleted by a stale page. `saveGeneralExpenses` is scoped to `project_id IS NULL` — before, it deleted **every project expense**. New loaders must call `remember(table, items[, scope])`. Unit tests: `npm test` (`tests/syncPlan.test.ts`, `tests/schedule.test.ts`).
- **Permissions:** `role_permissions(role, permission)` + `private.has_permission(text)` (CEO always true) + `private.users_with_permission(text)`. List + labels in `src/lib/permissions.ts`; `usePermission()` from `RoleContext` (loads the role's grants). Settings → Team Access → **Permissions** matrix (CEO writes, staff read). Existing `can.*` checks are unchanged; new features use permissions. Nothing granted by default.
- **Change history:** `audit_log` filled by `private.audit_row()` AFTER triggers on invoices, clients, projects, employees, expenses, candidates, time_entries, user_roles, role_permissions, client_users, settings (Gmail token columns shown as •••; values > 20k chars summarised). Updates store `{col: [old, new]}` for changed columns only; `actor_id` NULL = automatic. Readable with `history.view`; nobody can edit it. UI: `components/HistoryList.tsx` (Settings → **History**) and `RecordHistory` on client / employee / project profiles. Later steps attach the same trigger to their tables.
- **Portal drafts:** `portal_client_invoices` re-created with `coalesce(status,'draft') <> 'draft'`.
- **Email:** replaced in 2026-11 by the company Outlook mailbox — see **Email (Outlook)** below. (Step 1 built per-person Gmail; that code, the `gmail-oauth` function and the stored Google tokens are gone.)
- **Email (server):** `_lib/notify.cjs` emails notifications through `_lib/outlook.cjs` (one company mailbox); a setup problem stops that run's emails and is reported as `emailProblem`. `settings.notify_sender_user_id` is no longer used.
- **Notifications:** `notifications` (bell; users may only set `read_at`), `notification_prefs` (per kind email/push; `'*'` row = `email_to`), `push_subscriptions`, `app_secrets` (service-role only). `private.notify_user` / `private.notify_permission` for SQL; `_lib/notify.cjs` (`notify`, `notifyPermission`, `dispatchPending` — claims rows with a conditional PATCH so concurrent runs never double-send). Functions: **`notifications-dispatch`** (scheduled every 5 min), **`notifications-send-now`** (POST, staff/employees; `{test:true}`), **`push-config`** (GET public key). Kinds in `src/lib/notifications.ts`. UI: `NotificationBell` (Shell topbar + My workspace; app icon badge), `NotificationSettings` (Settings → Notifications, My workspace → Notifications).
- **Web Push** without a package (`_lib/webpush.cjs`): VAPID ES256 JWT + RFC 8291 aes128gcm with `node:crypto`; keys from `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` or auto-created in `app_secrets`. 404/410 subscriptions are deleted. Test decrypts as the phone would.
- **Installable app "YVA OS":** `public/manifest.webmanifest` (scope `/os/`, standalone), icons in `public/icons/` (180/192/512, maskable, badge), `public/sw.js` (push + notification click only — **no page caching**), registered in `main.tsx` (production only). `index.html`: manifest, theme-color, apple-mobile-web-app tags, `viewport-fit=cover`; portal bottom bar pads for the iPhone home bar. iPhone push needs iOS 16.4+ and the app opened from the home-screen icon. Sidebar/brand text renamed "YVA OS".
- Tests: 47 SQL checks (local Postgres), 30 server checks (fake Supabase/Google/push), 28 unit tests, 24 browser checks.

### Steps 2 + 3 — Rates per placement, live earnings ✅ built, not merged — run `supabase/migrate-step2-rates.sql`
- **`placement_rates`** (employee_id, project_id NULL = the person's own pay rate, position, bill_rate, pay_rate, effective_from, note): one change per person/project/day (`UNIQUE NULLS NOT DISTINCT`, PG15+), bill rate only with a project, RLS `has_permission('rates.manage')`, audit trigger. `projects.pay_schedule` (weekly default) / `pay_anchor`, `employees.pay_schedule` (NULL = follow project) / `pay_anchor`.
- **Rules live twice** — `netlify/functions/_lib/money.cjs` (server) and `src/utils/moneyRules.ts` (browser) — and `tests/parity.test.ts` runs both on the same cases. Change both together. Bill = placement → project → client default → none; pay = placement → dated own pay → employee pay → none (they never cross). `payPeriod(date, schedule, anchor)` → start/end/payday (Friday after the end). Night premium per 10-minute block from first/last offsets, premium start → midnight in the employee's TZ (default `America/Santo_Domingo`). `blocksMoney` sums pay or bill for blocks (YVA work types are never billed; removed/rejected skipped).
- **UI:** `components/PlacementRates.tsx` (project page, rates.manage), `components/EmployeePayRates.tsx` (employee page), `components/MissingRates.tsx` (Projects page), project edit → Pay schedule. `services/rates.ts` (load/add-upsert/delete + camel→snake adapters).
- **Invoice builder:** default row rate = resolved **bill** rate (it used to fall back to the employee's pay rate — invoicing at cost); position from the placement; payroll uses the resolved pay rate.
- **`employee-earnings`** (GET, employee): today + per-project pay period (project schedule; YVA bucket uses the employee's schedule), amounts from tracker blocks × the pay rate on each day + premium + `time_adjustments` (Step 4), approved vs estimated, paid history from `payroll_lines` (Step 6; missing tables are ignored). Never returns bill rates. UI: `pages/me/MyPay.tsx` (EN/ES strings, refresh every minute).
- Tests: 23 SQL, 18 function, 32 unit (incl. parity), 16 browser checks.

### Steps 4 + 5 — Weekly close, client payments ✅ built, not merged — run `supabase/migrate-step4-weekly-close.sql`
- **SQL:** `week_closes` (week_start Monday UNIQUE, status preparing/ready/approved, summary/flags/payroll_preview JSONB; RLS `weekly_close.manage`); `invoices` + `client_id`, `week_close_id`, `auto_generated` (unique per week+client); `clients` + `invoice_prefix`, `next_invoice_seq`; **`next_client_invoice_number(client)`** (locks the client row, prefix = first 3 letters made unique, never reuses a number on an invoice); portal policy matches `client_id` or name, never drafts. **`time_adjustments`** (± seconds per day/target, kind edit/defer_out/defer_in/late_add, note required, group_id for moves; employees read their own; trigger notifies the employee once per change). **`week_close_approve(week_start)`** (SECURITY DEFINER; permission or service role; approves the week's tracked blocks and rolls blocks + adjustments into `time_entries`, marks the week approved). **`client_payments`** (amount > 0, method, reference, source manual/stripe, `external_ref` unique) + trigger that moves `invoices.amount_paid` by the difference and sets paid / partial / back to sent, appends `status_history`, and notifies `payments.record` holders of card payments. Audit triggers on all three.
- **Engine** `netlify/functions/_lib/weekclose.cjs`: `buildWeek(ctx)` (pure) + `prepareWeek(weekStart, {by})`. Lines per client → employee/project/bill+pay rate; regular and night-premium lines (premium line rate = bill × (1 + %)), `hoursTotal` = exact seconds/3600, `daily` as "h:mm", items keep basePayRate/totalPay. Re-prepare updates drafts in place (same number), never touches sent invoices (flags `invoice_locked`), deletes drafts of clients with no hours left. Flags: missing_rate, project_no_client, client_no_email, invoice_locked, late (blocks created after the first preparation; *Move to next week*), manual_pending, no_time (app users with a shift, Mon–Fri, approved time off excluded), over_50h, low_activity (<30% with ≥1 h measured), outside_shift (≥30 min outside shift ±30 min), missing_screenshots (<50% of expected for ≥2 h).
- **Functions:** `week-close` (POST prepare/approve/preview — `preview` = the week in progress, computed but nothing saved; the page offers it as "This week so far"; approve runs the SQL function with the caller's token), `week-close-scheduled` (cron `5 4 * * 1` = Monday 12:05 am DR; prepares + notifies `weekly_close.manage`). `stripe-webhook` also inserts a `client_payments` row (ignore duplicates).
- **UI:** `pages/WeeklyClosePage.tsx` (route `/weekly-close`, Finance menu, `weekly_close.manage`), `services/weeklyClose.ts`, `services/invoiceEmail.ts` (shared invoice email used by Invoices + Weekly close), `components/RecordPaymentModal.tsx` (+ 💲 button on Invoices for non-drafts), `services/payments.ts`, Dashboard **Collected** KPI (CEO), My workspace → `MyAdjustments`. `invoiceHtml` prints hours as "7h 20m".
- Tests: 40 SQL, 39 engine/function, 19 browser checks.

### Step 6 — Payroll ✅ built, not merged — run `supabase/migrate-step6-payroll.sql`
- **SQL:** `payroll_runs` (payday Friday UNIQUE, status open/paid, exchange_rate locked by trigger once a line is paid, flags), `payroll_lines` (per person × project/YVA × period: regular/premium seconds, pay_rate + rates[], gross, adjustments, net USD, net DOP + rate fixed when paid, masked payout snapshot; UNIQUE NULLS NOT DISTINCT (run, employee, project, period_start); paid lines can't be edited/deleted), `payroll_adjustments` (bonus/deduction, pending → run_id → applied; repeat = N rows with group_id/sequence), `employee_payout_methods` (bank or PayPal; RLS bank.view / bank.manage; account number, cédula and PayPal email redacted in history). **`payroll_mark_paid(lines[], paid_on, reference)`** (needs the run's rate; fixes DOP; applies that person's attached adjustments; notifies `payslip_ready`; run → paid when nobody is left) and **`payroll_unmark_paid(line)`**. RLS payroll.view / payroll.manage; employees read their own PAID lines and applied adjustments.
- **Engine** `netlify/functions/_lib/payroll.cjs` `preparePayroll(payday)`: `periodsForPayday` (periods whose Friday-after = payday), approved blocks + applied adjustments, money via `money.cjs`, unapproved time flagged not paid; one adjustment per repeat group per payday, none to someone fully paid that payday, adjustment-only lines for people without hours; flags unapproved / missing_rate / no_payout / negative / client_unpaid. Paid lines never change; pending ones updated / inserted / removed. Functions: **`payroll`** (POST prepare, payroll.manage), **`payroll-reminder`** (cron `7 13 * * 3` = Wed 9:07 am DR: prepares this Friday + notifies `payroll_due`).
- **UI:** `pages/PayrollPage.tsx` (`/payroll`, Finance menu, payroll.view/manage), `services/payroll.ts`, `utils/payslipHtml.ts` (escaped; EN/ES), `components/EmployeePayoutMethod.tsx` (employee profile), `pages/me/MyPayslips.tsx` (My pay). BHD helper fills BHD's **buy** rate (Settings keeps using sell for its own field).
- Tests: 36 SQL, 21 engine/function, 21 browser checks.

### Steps 7 + 8 — My workspace redesign, phone pass ✅ built, not merged — run `supabase/migrate-step7-workspace.sql`
- **SQL:** `time_off_requests` (employee inserts own pending / cancels pending; staff read; `timeoff.approve` decides; BEFORE trigger stamps decided_by/at and freezes the request fields; AFTER trigger notifies approvers on insert and the employee on a decision, EN/ES title), `announcements` (audience all/client/yva, pinned, `published_at` NULL = draft / future = scheduled; employees read published ones for their team; publishing notifies those employees), `holidays`, `employee_documents` + private bucket `employee-documents` (employee reads own folder; `documents.manage` all), `projects` + `supervisor_name/email/phone`, `employee_instructions`. Helper `private.current_employee_works_for()`.
- **Functions:** `employee-me` also returns each project's `supervisor` + `instructions` (falls back if the columns don't exist yet); `employee-earnings` returns `trackingNow` / `lastActivityAt`.
- **My workspace** (`pages/me/`): `EmployeeWorkspace.tsx` shell (sections via `?s=`, `/me#manual` → Requests; sidebar ≥860 px, bottom tabs + More sheet below), `MeSections.tsx` (Home, Requests, My client, Documents, Company, Profile), `i18n.ts` (EN/ES dictionary + `useMeLang`, saved in `localStorage yva_me_lang`, first visit follows `navigator.language`). MyHours / ManualTime / MyPay / MyPayslips / MyAdjustments / NotificationSettings / NotificationBell / ScreenshotDay take `lang`. Styles: `.me-*` in styles.css.
- **YVA OS:** `pages/ApprovalsPage.tsx` (`/approvals`; time off needs `timeoff.approve`, missing time uses `yva_time_decide_request`), `pages/AnnouncementsPage.tsx` (`/announcements`, `announcements.manage`), `components/EmployeeDocuments.tsx` (employee profile), project edit → supervisor + instructions, `ScheduleReport` shows approved time off / holidays as days off. `services/workspace.ts`.
- **Phones (Step 8):** `.staff-tabs` bottom bar in `Shell` (≤768 px), safe-area padding, wrapping headers, invoice group headers; `InvoicePage` blocks the builder on phones with an explanation.
- Tests: 35 SQL, 24 + 8 browser checks (16 staff pages at 390 px).

### Step 9 — CRM ✅ built, not merged — run `supabase/migrate-step9-crm.sql`
- **SQL:** `leads` (stage new/contacted/meeting/proposal/won/lost, owner_id, value_monthly, next_follow_up, utm, calendly_booked, client_id/project_id once won; RLS: staff with `leads.view_all` see all, others only their own; insert/update for `leads.manage` or the owner; only `leads.manage` deletes/reassigns — enforced by a SECURITY DEFINER BEFORE trigger; AFTER trigger notifies `leads.manage` of new leads and the owner when assigned), `lead_activities` (note/call/email/meeting/whatsapp/follow_up/system; visible with the lead), `contacts` (staff), `candidates.staff_request_id` (openings). Step 1 now also grants `USAGE ON SCHEMA private TO service_role` (server functions write tables with private triggers).
- **Functions:** **`lead-intake`** (public POST from `assets/js/lead-send.js`: origin allow-list incl. deploy previews, honeypot `hp`, 6/10 min per IP, clipped fields, utm allow-list, same email within 30 min updates instead of duplicating; returns `{id, token}` — HMAC token lets the page report the Calendly booking `{kind:'calendly', id, token}`), **`application-intake`** (public POST from careers.html → `candidates` stage applied / source "Careers page", dedupe per day, falls back if optional columns are missing, notifies CEO/Admin/Recruiter `application_new`), **`crm-followups`** (cron `17 12 * * *` = 8:17 am DR: owners — or `leads.manage` for unowned leads — get "N follow-ups due today").
- **Website:** `lead-send.js` calls lead-intake in the background (keepalive, never blocks; EmailJS/Netlify Forms routes unchanged) and listens for Calendly's `calendly.event_scheduled` message (origin-checked). `careers.html` posts to application-intake after the EmailJS sends.
- **Import CSV** on Leads (`leads.manage`): `utils/csv.ts` reads Netlify Forms exports or any sheet with name/email columns → `public.import_leads(jsonb)` (skips people already listed, keeps the original date/source, no notifications via the `yva.importing_leads` setting).
- **UI:** `pages/LeadsPage.tsx` (`/leads`, CRM menu for CEO/Admin/Lead Gen or lead permissions; kanban with drag and drop, lead modal with activity + follow-ups, Mark won → `convertLead` creates client + project + contact), `components/ClientContacts.tsx` (client profile), `utils/clientHealth.ts` + badge on client cards, `components/OpeningCandidates.tsx` (`OpeningPicker` on the candidate profile, list on Requests). `services/crm.ts`. Notification kind `application_new` added.
- Tests: 26 SQL, 22 function, 16 browser + 7 website checks.

### Rules learned while building Steps 0–9
- **Columns added to existing tables must be nullable** (use a DEFAULT, not NOT NULL): the previous app version saves whole lists in one batch and PostgREST writes NULL for keys a new row lacks. `projects.pay_schedule`, `invoices.auto_generated`, `clients.next_invoice_seq` are nullable for this reason; code treats NULL as the default.
- **Trigger functions written by server functions** (service role) and that call `private.*` must be SECURITY DEFINER (or rely on Step 1's `GRANT USAGE ON SCHEMA private TO service_role`) — PL/pgSQL plans the whole IF expression, so a private call inside a short-circuited condition still needs schema access.
- Safe saving compares **each row with the copy it was made from**: loaded rows carry an enumerable Symbol load tag that survives `{ ...row, field }` but never reaches JSON/the database; this browser's own later saves are layered on top (so changing a value back is saved); rows rebuilt from scratch use the oldest remembered copy. Saves of one table run one at a time. An empty list may only delete rows every remembered load had. Tests: `tests/syncPlan.test.ts`.
- **Supabase returns at most 1,000 rows per request.** Big reads must page: `restAll()` in `netlify/functions/_lib/supa.cjs`, `fetchAllPages()` in `src/lib/pages.ts` (always with a unique order, e.g. `…,id`).
- **Client portal invoices** come from `public.portal_invoices()` (pay fields stripped from items); `migrate-portal-invoices-lockdown.sql` drops the direct portal policy once the app using it is live. Step 1/4 only *replace* that policy if it still exists, so re-running them never re-opens it. Never add a portal SELECT policy on `invoices` again.
- **Money rules (both copies, `money.cjs` + `moneyRules.ts`):** days are business-zone days; the night premium uses the employee's zone only if `safeTz()` accepts it (profiles hold free text); negative blocks/adjustments come off that day's regular time first, then premium, never below zero. Weekly-close invoices bill **whole minutes per day** and line amount = hours shown × rate shown.
- **Payroll** subtracts what other paydays already hold for the same person/project/period (paid or pending) and leaves out days another payday covers under a different schedule — this pays late-approved time on the next payday ("late time" line, flag `late_time`) and never pays a week twice after a schedule change (flag `schedule_overlap`). Pending bonuses attached to another unpaid payday are never moved. Client work follows the **project's** schedule, YVA-team work the person's (`employee-earnings` does the same).
- `yva_time_rollup` (per-person Approve, manual-time decisions) is redefined in Step 4 to include `time_adjustments` and is SECURITY DEFINER — re-run Step 4 after re-running YVA Time phase 2.
- Bill rates for the invoice builder without `rates.manage`: `public.placement_bill_rates()` (bill + position only).
- Projects: cards open the project page in both views; **Edit** goes to `/projects/:id?edit=1` (the full form with rates, pay schedule, supervisor). The invoice builder's styles (lost in a May 2026 update) are back in `styles.css` (`.invoice-builder`, `.builder-*`, `.daily-cell`).
- **Live database ID types:** `employees.id` / `employees.user_id` (and possibly other old tables' ids) are **text**. In SQL, compare old-table ids with uuid values as `x::text = y::text`; tests run with `TEXT_IDS=1` too.
- Pages gated by `allowed(...)` must keep every hook above the permission check, and permission-gated loaders must list the permission in their effect deps — permissions load after the first render for non-CEO roles.
- Owner setup checklist for this work: `SETUP-AFTER-BUILD.md`. Review fixes (2026-10-31): PLAN.md → "Independent review".

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
- **Portal activity audit logging implemented**: Added `log-portal-activity.cjs`, `auditPortalActivity()`, portal login logging, document upload/download audit events, document ownership checks, and `client_users.last_login_at` updates through the server function instead of direct browser writes.
- **Client portal UI polish**: ClientShell now has a desktop portal topbar title/subtitle, Documents and Settings use shared portal panel/section/upload/card classes, and the mobile portal bottom nav scrolls horizontally instead of squeezing or wrapping.
- **LawOS profile UI consistency sweep**: Client, employee, and project profiles now use shared profile layout classes for headers, KPI grids, field groups, document rows, communication panels, and responsive profile grids. Team project employee cards now show pointer/hover/focus states, card subtitles and stats handle long text, and profile/report/calendar fixed grids were converted to responsive classes where they were most likely to overflow.
- **Reports and Calendar UI cleanup**: Reports KPI drill-down cards now use the `clickable-card` hover/focus treatment, report two-column sections collapse on mobile, aging buckets use responsive metric grids, and Calendar uses responsive wrapper classes so the detail panel stacks below the calendar on smaller screens.
- **Latest pushed commits**:
  - `e45aa21` — Polish LawOS portal and profile UI
  - `9fbcf3f` — Harden client portal security
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

### 2026-05-17 — Client Portal Invite Bug Fix
**Problem**: Client invites were broken in two ways:
1. **Email invite** used `POST /auth/v1/admin/users` with `invite: true`, which does **not** accept a custom `redirect_to`. The invite email linked to the OS login page (Supabase Site URL) instead of `/portal/set-password`.
2. **RoleContext fallback** auto-inserted any unrecognized user as `recruiter` in `user_roles`. If a client logged in but their `client_users` row was missing (failed invite, existing auth account, race condition), they were permanently assigned `recruiter` and could access the internal OS.

**Fixes applied**:
- `netlify/functions/invite-client.cjs` now uses `generate_link` for **both** `email` and `link` modes. Both modes get the correct `redirect_to` pointing at `/portal/set-password`.
- `ClientProfilePage.tsx` now sends the invite email from the frontend using the existing `sendEmail()` utility (company Outlook mailbox since 2026-11, mailto fallback otherwise) for `mode='email'`.
- `RoleContext.tsx` now checks `user.user_metadata.role === 'client'` before the recruiter fallback. Invited clients without a `client_users` row are kept as `role='client'` in memory (no DB write to `user_roles`), preventing OS access.
- Added `auth_id` duplicate check in `invite-client.cjs` to prevent linking one email to multiple clients.

**Cleanup required for contaminated client**:
If a client was incorrectly assigned `recruiter`, run this in Supabase SQL Editor (replace with their actual `auth_id` or email):
```sql
-- 1. Find the contaminated user
SELECT id, email FROM auth.users WHERE email = 'client@example.com';

-- 2. Delete their erroneous user_roles row
DELETE FROM user_roles WHERE user_id = '<their-auth-uuid>';

-- 3. Verify they still have a client_users row (re-invite if missing)
SELECT * FROM client_users WHERE auth_id = '<their-auth-uuid>';
```
Then ask the client to log out and log back in. They will now be detected as `client` via their `client_users` row (or via metadata as a fallback).

### UI QA Notes — Next Session
- Retest LawOS desktop and mobile widths for: Clients, Client Profile, Team project view, Employee Profile, Project Profile, Reports, Calendar, Invoices, Estimates, and portal Documents/Settings.
- Known recent focus areas: long names/emails/notes should stay inside cards; clickable cards should show hand cursor or hover state; fixed side panels/grids should stack cleanly on mobile; portal bottom nav should remain usable when all tabs are visible.
- If more UI inconsistencies appear, prefer adding shared classes in `src/styles.css` over one-off inline styles so profile, portal, and report screens stay consistent.

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

### 1B. Supabase Security / Performance Advisor Cleanup — 2026-05-04

**Security Advisor — DONE**

SQL warnings fixed by moving SECURITY DEFINER helpers to `private` schema:
- `anon_security_definer_function_executable` (`current_user_role`, `is_internal`)
- `authenticated_security_definer_function_executable` (`current_user_role`, `is_internal`)

Run `supabase/migrate-security-advisor.sql` on existing databases, or use the updated `rls.sql` + `client-portal.sql` for new deployments.

Previous session items (2026-04-16):
- Critical `rls_disabled_in_public` on timesheet import tables — fixed
- Function Search Path Mutable warnings fixed for all 4 helpers
- Broad authenticated `USING (true)` / `WITH CHECK (true)` policies replaced with scoped policies

**Performance Advisor — 2026-04-16 cleanup applied**
- `auth_rls_initplan` warnings addressed
- Duplicate permissive policies consolidated

Validation query (run after any policy changes):
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

Post-RLS regression checklist:
- Internal LawOS login: dashboard, clients, invoices, projects, employees, tasks, settings.
- Client portal login: invoices, documents, requests, working-hour prefs, team reviews, bonus requests.
- Two-client isolation check: Client A must not see Client B invoices, projects, documents, employees, or requests.
- Payments: create test invoice, pay from portal, confirm Stripe payment and paid invoice status.
- AutoPay: verify saved card / AutoPay status, then run Netlify `run-autopay` against an eligible due invoice.
- Documents: upload/view/download internally and from portal if enabled.
- Internal CRUD: create/edit client, invoice, project/task, and delete a document if internal deletion is needed.

**Remaining dashboard-only item:**
- Enable Supabase Auth leaked password protection in the Supabase dashboard (Authentication → Policies → Leaked Password Protection).

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

Email (2026-11): `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SENDER_MAILBOX` (company Outlook mailbox — SETUP-AFTER-BUILD.md §3). `GMAIL_CLIENT_SECRET` is no longer used and can be deleted.

---

### 3. Stripe Dashboard setup ✅ Test mode

Stripe test-mode webhook destination was created.

Webhook endpoint:
```text
https://yvastaffing.agency/.netlify/functions/stripe-webhook
```

Subscribed events (2026-11 — add all of these; see SETUP-AFTER-BUILD.md → Stripe):
```text
payment_intent.succeeded, payment_intent.processing, payment_intent.payment_failed,
payment_intent.requires_action, payment_intent.canceled, charge.refunded,
charge.dispute.created, charge.dispute.funds_withdrawn, charge.dispute.funds_reinstated,
charge.dispute.closed, setup_intent.succeeded, payment_method.detached,
payment_method.automatically_updated, payment_method.updated
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
8. Email: Gmail was replaced by the company Outlook mailbox (2026-11); set the four `MS_*` variables (SETUP-AFTER-BUILD.md §3).

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
- Email goes out from one company Outlook mailbox through the `send-email` Netlify function (Microsoft Graph); no email tokens in the browser (Gmail removed 2026-11).
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
| `/settings` | SettingsPage | Tabbed: Company, Email (templates), Integrations (Email sending · Outlook), Currency, Notifications, Data (backup/restore/danger) |
| `/estimates` | EstimatesPage | Estimates list + right-side slide panel + line-item builder; status: draft/sent/accepted/declined/expired |
| `/time` | TimeTrackingPage | Time log with KPI cards, filters, slide panel to log hours per employee/project |
| `/portal` | PortalPage | Read-only client-facing invoice view (outside Shell, no nav) |
| `/oauth-callback` | — | Old Gmail sign-in return address; now redirects to Settings → Integrations |
| `/login` | LoginPage | Email/password login + sign-up toggle + Remember Me |
| `/me` | EmployeeWorkspace | Invited employees only (outside Shell): YVA Time info, assigned projects, own details — via `employee-me` |

## Profile Page Architecture
- All entity list pages (Clients, Employees, Projects, Candidates) navigate to profile routes on card click
- Profile pages use inline edit mode (`editing` boolean) — no separate modal
- Pattern: `const entityNN = entity!` after early-return null check, to satisfy TypeScript narrowing
- Action buttons in list cards use `stopPropagation` to prevent card-click navigation
- `GlobalSearch` in Shell topbar searches all entities and navigates to profile routes

## Design System
- **Navy & gold (v9, matches yvastaffing.agency):** navy `--primary` / `--sidebar-bg` `#1b1e2b`, background `--bg #f6f7f9`, white cards with 1px borders (shadows only on hover), radii 8–12px, Inter.
- **Two yellows:** `--brand #facc15` (website yellow) for **fills** — active menu item, current-month chart bar, avatars/badges with navy text, settings tab. `--gold #a16207` (and `--goldl` / `--goldd`) for **text, borders and focus rings** — bright yellow text on white is unreadable.
- Dashboard numbers (`.kpi-value`) are navy; red only for a real problem (overdue/unpaid > 0, negative earnings). KPI icons are neutral (`.kpi-icon-wrap`, top-right) — don't colour them inline. Cards without a `.kpi-body` stack vertically.
- Titles: `.page-title` 26px/700, card titles sentence case 15px/600 (no uppercase). Tabs (`.filter-tab`, `.view-toggle`) are quiet; the active one is white with a border.
- Phones: top bar hides the page name (≤640px), dashboard cards two per row without icons (≤480px). Client portal phone bottom bar: `.portal-bottom-nav-item`.
- Colours from the old dark theme (`#f87171`, `#4ade80`, `#f5b533`…) were replaced with readable ones; on white use `#dc2626` / `#059669` / `var(--gold)`.
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
- Email button: sends from the company Outlook mailbox with the invoice **PDF** attached and the client's Cc list; if sending fails the person can open their mail app instead (PDF downloaded)
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
- **Email Statement** — sends from the company Outlook mailbox with the statement PDF attached (+ Statement CC)
  - Button shows "Sending…" while in flight; disabled to prevent double-send
  - Green toast on success, error toast with the reason if sending fails
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

## Email (Outlook) — 2026-11, replaces Gmail
- **One company mailbox** (Microsoft 365, e.g. contact@yvastaffing.agency) sends everything: invoices, reminders, quick invoices, weekly-close sends, statements, estimates, team invites, notification emails. A copy lands in that mailbox's Sent Items (`saveToSentItems`).
- **Server:** `netlify/functions/_lib/outlook.cjs` — Microsoft Graph app-only sign-in (client credentials, token cached in memory until ~5 min before expiry) and `POST /users/{MS_SENDER_MAILBOX}/sendMail`. Setup problems throw `OutlookNotSetUp` with a plain reason (missing variables, wrong/expired secret, no Mail.Send consent, unknown mailbox). `_lib/emailRules.cjs` (pure, `tests/emailRules.test.ts`): ≤ 10 recipients, valid addresses, To never repeated in Cc, subject ≤ 300 chars on one line, text ≤ 200 KB, **PDF attachments only**, ≤ 4.5 MB together (Netlify body limit), safe file names.
- **`send-email`** (POST, staff roles only — never pending/client/employee): checks the Supabase session, validates, limits **100 emails per person per hour / 500 per day** from `public.email_log`, sends, and logs every attempt (who, To/Cc, subject, attachment names + sizes, sent/failed + Microsoft's reason; never the PDF). Before `migrate-outlook-email.sql` runs it still sends (no log, no limit). Answers 400 bad email · 401/403 · 429 · 503 `{notSetUp}` · 502 Microsoft error. **`email-status`** (GET, staff): `{ configured, mailbox, missing[] }`; `?check=1` also signs in to Microsoft (no email sent) → `{ ok, problem }`.
- **Browser:** `src/services/email.ts` — `sendEmail(to, subject, body, { attachments, cc })` → `{ mode: 'outlook' | 'mailto' | 'failed', attached, fallbackReason }`. Failures are never silent: a confirm dialog explains why (or that Outlook isn't set up yet) and offers the mail app (the PDFs are downloaded to attach by hand); declining returns `failed`. `utils/mime.ts` builds the request body and the `mailto:` link. Weekly close "Send all" needs Outlook configured (`loadEmailStatus`).
- **Settings:** Integrations → **Email sending · Outlook** (`components/settings/emailStatus.ts`): Connected / Not set up (names the missing Netlify variables) / Problem (reason), **Send test email to me** (to the signed-in login's address), Check again. Email tab shows "Sending from …".
- **Security:** no email tokens or secrets in the browser or database; the Entra app has only the Mail.Send **application** permission and is limited to the one mailbox by an Exchange **application access policy** (or RBAC for Applications) — SETUP-AFTER-BUILD.md §3; only staff can call `send-email`; per-person rate limits; `email_log` readable by CEO/Admin only, written by the server only.
- **Env (Netlify):** `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (expires — renew in Entra, then update Netlify), `MS_SENDER_MAILBOX`.
- **SQL:** `supabase/migrate-outlook-email.sql` — `email_log` + RLS; blanks the old Google tokens in `settings` and removes `gmail*` keys from every login's user metadata (columns kept for older app versions).
- Tests: `tests/emailRules.test.ts`, `tests/sendEmailFunction.test.ts` (send-email / email-status / notification emails against fake Supabase + Microsoft), scratchpad `outlook-sql/` (40 checks, both ID modes), `cc-pdf-ui.cjs`, `redesign-settings-ui.cjs`. The real Microsoft Graph can only be exercised on the live site (Settings → Send test email).

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
- Both EmployeesPage and EmployeeProfilePage: "Email Statement" sends from the company Outlook mailbox
- Attaches the statement as a PDF (+ the employee's Statement CC)
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
- [x] Employee email invoices (company Outlook mailbox with the invoice PDF attached; mailto: fallback)
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
- [x] Employee statement email (company Outlook mailbox with PDF attachment; sending state + toast confirmation)
- [x] Candidate hire conversion (creates employee record, removes candidate card, opens onboarding checklist)
- [x] Employee schedule + premium pay rules (saved shift defaults, night premium start/percent)
- [x] Premium-aware invoice/payroll math (billing + statements)
- [x] Legacy minute-style hour parsing (`3.08` = 3h08m)
- [x] Per-project invoice counter recovery from real saved invoices
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
- [x] Email from the company Outlook mailbox (`src/services/email.ts` → `send-email`, Microsoft Graph) — replaced the Gmail OAuth integration in 2026-11
- [x] **Supabase migration** — all data moved from localStorage to Supabase PostgreSQL + Auth
- [x] **Login page** — email/password auth with sign-up toggle and Remember Me checkbox
- [x] **Invoice groups collapsed by default** — all project sections closed on load; unpaid count shown in header
- [x] **Business Expenses KPI on dashboard** — general expenses card + deducted from Net Earnings
- [x] **Role-based dashboards** — CEO sees full financials; Admin sees team/ops KPIs; Accounting sees invoice/AR KPIs; Recruiter/Lead Gen see their own views
- [x] **CEO-only financials** — revenue charts, invoice history, payroll CSV, AR aging, forecasting all gated by `can.viewOwnerStats(role)`
- [x] **Team Access settings tab** — visible and editable by CEO only
- [x] **Login UX** — persists last email across logout; brute-force lockout (5 fails → 15-min cooldown); password strength meter on signup
- [x] **Security headers** — root `netlify.toml` `[[headers]] for = "/os/*"` (CSP, X-Frame-Options, HSTS…; the old `public/_headers` was never served)
- [x] **Supabase RLS** — row-level security on all tables; settings/user_roles write-restricted to CEO; script at `supabase/rls.sql`
- [x] **crypto.randomUUID()** — all entity creation uses UUID instead of timestamp-based IDs (required by Supabase UUID columns)
- [x] **UI redesign — YVA LawOS light theme** — Flowlu-style: white surface, light gray bg, dark navy sidebar (#1b1e2b), yellow (#facc15) accent; KPI cards with yellow top border; all entity pages updated
- [x] **Sign-up hidden at /signup** — login page is invite-only; /signup is accessible only via direct link
- [x] **Estimates page** — full estimates pipeline at `/estimates`; line-item builder with qty/unit price; status lifecycle (draft→sent→accepted/declined/expired); right-side slide panel; convert-to-invoice button (accepted estimates); KPI summary cards
- [x] **Time Tracking page** — time log at `/time`; per-employee/project entry; billable toggle; date range + employee + project filters; KPI cards (total/billable/unbillable hours + billable %); right-side slide panel
- [x] **Recurring Invoices tab** — tab in InvoicePage at `/invoice`; create/edit recurring schedules (weekly/biweekly/monthly); active/pause/delete; linked to client + project; right-side slide panel
- [x] ~~**Live Timer (Time Tracking)**~~ — removed 2026-10-30; live tracking moves to the YVA Time desktop app (see "YVA Time — Phase 0")
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
- `/portal` and `/login` render **outside** Shell (no nav/sidebar); `/oauth-callback` (old Gmail return address) redirects to Settings → Integrations
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
- Roles: `ceo` | `admin` | `accounting` | `recruiter` | `lead_gen` (staff, `isStaff()`), plus `client` (portal) and `pending`
- **New accounts start as `pending`** (no access, "waiting for approval" screen) — a CEO picks the real role in Settings → Team Access. The database only allows a self-insert of `pending` (`user_roles_self_insert_pending`); `private.is_internal()` is an explicit list of the 5 staff roles, so `pending`/`client`/future roles never get internal data. Run `supabase/migrate-role-lockdown.sql` on existing databases. **Never** re-add a self-insert policy without the `role = 'pending'` check (before 2026-10-30 any signup could make itself CEO).
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
- HTML built as a string (`invoiceHtml.ts`, `statementHtml.ts`, print windows, previews, email attachments) must pass every stored/typed value through `escapeHtml()` from `src/utils/html.ts` — names, notes and addresses must never become tags or scripts. The invoice preview `<iframe>` is `sandbox=""`.
- `stripe-webhook.cjs` rejects events whose signature timestamp is more than 5 minutes old (replay protection, same as Stripe's libraries), ignores events from the other mode, and records each event once (see "Payments (Stripe, 2026-11)").
- React Router stays on 6.30.x for now: its two remaining advisories are fixed only in v7 and don't apply here (no SSR, no navigation targets taken from the URL). Upgrade to v7 as its own task.
- No npm UI libraries — keep CSS self-contained
- Logo at `/public/yva-logo.png`
- Legacy builder at `/public/legacy/` — kept for reference but no longer used in app
- Netlify SPA routing: `public/_redirects` contains `/* /index.html 200`
