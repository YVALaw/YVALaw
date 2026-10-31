# YVA OS — Automation & Growth Plan

Agreed with Hans on 2026-10-31. Being built on branch `claude/charming-turing-ue7mxi` — see **Build progress** at the end.
Each step is built and tested; nothing is merged to the live site or published as a new YVA Time version until Hans has checked it.

The goal: **time tracking, employee earnings, payroll and client invoicing all connected and automatic.**
The system prepares everything; Hans only reviews and approves before invoices are sent or employees are paid.
No more Hubstaff, Excel exports or hand-calculated invoices.

---

## Decisions

| Topic | Decision |
|---|---|
| Work week | Monday–Sunday, closes **Sunday 11:59 pm Dominican time** |
| Invoices | **Weekly, every client**. **One combined invoice per client** covering all their projects/people (e.g. 2 intakers + accountant + social media manager = one invoice), numbered per client (e.g. `HAL-0001`) |
| Rates | People can have different rates on the same project. **Bill rates (client) and pay rates (employee) are separate**: clients never see pay rates, employees never see bill rates or invoice amounts |
| Billing precision | **Exact minutes** — no rounding |
| Problems | **Flag only**, never block |
| Pay schedule | Set **per project**: weekly, every two weeks, quincena (1–15 / 16–end) or monthly. YVA team: chosen per person |
| Payday | **The Friday after the pay period ends** (e.g. Mon–Sun hours → paid the following Friday). Payroll is not held back if a client is late — only flagged |
| Currency | Employees paid in **DOP**. Hans checks and enters the exchange rate when paying (auto-fetch BHD button as a helper); the rate is locked on that payroll |
| Payments | Client payments received and employee payments made are **recorded manually** for now (portal card payments are already automatic) |
| Payout methods | From BHD to **any DR bank**, or **PayPal** for international staff |
| Bonuses / deductions | Yes, **simple**: attached to one payroll and used up when paid — never reappear on later statements (the problem in the old CRM) |
| Approvals | **Only Hans** for now — but every action is a permission so others can be given access later |
| Late / offline time | Hans decides case by case: **edit the time** himself or **defer** it to the next week |
| Edited time | The employee sees "adjusted by YVA" with Hans's note |
| Emails & notifications | Like the old CRM: sent from Hans's connected **Gmail**, notification email to the address set in Settings, plus the bell in YVA OS, plus phone notifications |
| Earnings display | Live earnings in **My workspace** only (not the desktop app) |
| Payslips | Employees download them in My workspace after Hans marks them paid |
| Time off | Employees request vacation / sick / personal days; Hans approves |
| Language | My workspace in **Spanish and English**; YVA OS stays English |
| Phone app | **One installable app called "YVA OS"** (add to iPhone home screen, no App Store). Staff see YVA OS, employees My workspace, clients their portal |
| Invoice builder on phones | **Review and approve** on the phone; building stays on the computer |
| Sales | Only Hans today — built so a future lead-gen hire can own leads |
| Build order | Left to Claude (below) |
| Screenshots | Kept **60 days** (was 90) |

---

## Principles

- **Built for growth.** Every action is a permission (approve week, mark paid, see pay rates, see bank details, manage leads). Hans holds all of them today. Every change is recorded (who, what, when).
- **Bill rates and pay rates never meet.** Profit figures are for Hans only.
- **The system prepares, Hans approves.** Nothing is sent or paid without a click.
- **Phone-first for new screens.** Every new screen works on an iPhone.

---

## Step 0 — Screenshots (small, first)

Finding (2026-10-31): screenshots **are** uploading (18 stored in Supabase). They are shown in
**YVA OS → Time Tracking → Screenshots** (pick the employee and the day) — verified working.
They are just hard to find and can't be opened from the app or seen by the employee.

- **Desktop app:** click the latest screenshot to open it full size · "N screenshots waiting to upload — reason" when uploads fail · a log file to send when something goes wrong.
- **YVA OS:** "View screenshots" on the employee profile and on the Live tab (opens the Screenshots tab on that person and day).
- **My workspace:** "My screenshots" — the employee's own screenshots by day, with activity %.
- **Retention:** 60 days (daily clean-up job + the notice in the app and My workspace).

## Step 1 — Foundation

- **Safe saving.** Most pages save a whole list at once (`syncAll`); two people editing — or the Sunday job and a person — can overwrite or delete each other's records. Switch to one record at a time, **invoices first**, then clients, projects, employees, expenses, the rest.
- **Permissions + change history** (see Principles).
- **Draft invoices hidden from clients in the database** (the portal page already hides them; the database rule doesn't).
- **Gmail sending** like the old CRM: connect Gmail once; invoices, payslips and notifications go out from it, including from scheduled jobs; failures are shown, never silent.
- **Notifications:** bell in YVA OS + email + phone push, with per-person on/off choices.
- **Installable "YVA OS" app:** home-screen icon and full-screen mode, phone notifications (iPhone iOS 16.4+ after "Add to Home Screen" and tapping Allow; Android and computers too), badge count, iPhone notch/home-bar spacing, in-app back buttons.

## Step 2 — Rates and placements (brought over from the old CRM, YVALaw/YVA-OS)

- A **placement** = one person on one project: position, **bill rate**, **pay rate**, start/end date, premium (night) rules.
- Fallbacks that never cross: bill = placement → project → client default; pay = placement → employee default.
- Rate changes take effect **from a date** — past weeks keep their rates.
- **Missing rates** list so nobody is invoiced or paid at $0.

## Step 3 — Live earnings in My workspace

- "Today 2h 10m · $21.67", "This pay period 18h 40m · $186.67 (≈ RD$11,200)", updating every minute while they track.
- Labels: **Estimated → Approved → Paid**. Night premium included automatically.
- Calculated on the server; employees see only their own pay rate and earnings.

## Step 4 — Weekly close (Sunday 11:59 pm)

| When | What happens |
|---|---|
| Sunday 11:59 pm | The week closes. **One draft invoice per client**: every person grouped by project/role, daily hours, their bill rate, exact minutes, night premium, due date from the client's terms |
| Monday morning | Notification (Gmail email + bell + phone): "7 invoices ready ($12,340) · 3 things to check" |
| Review | **Weekly close** screen: Summary · Invoices (open/edit) · Time (per person, per day — edit minutes with a note, or move to next week) · Flags · Payroll preview |
| Approve | **Approve week** approves the hours and marks invoices ready |
| Send | Send each or all from Gmail with the PDF; clients also see it in the portal; AutoPay unchanged (it only charges sent invoices) |

**Flags:** no time on a shift day · over 50 h/week · activity under 30% · work outside shift hours · missing screenshots · missing rate · client without email · manual time requests waiting · late time (uploaded after close → *Add to this week* or *Move to next week*).

## Step 5 — Client payments (recorded manually)

- **Record payment:** date, amount, method (wire / ACH / Zelle / check / card), reference; partial payments; invoice status updates. Portal card payments are recorded automatically (already).
- Dashboard: collected vs outstanding (AR aging exists).

## Step 6 — Payroll (Fridays)

- Pay schedule per project (weekly / every two weeks / quincena / monthly); YVA team per person.
- **Friday payroll screen:** everyone due, grouped by payout method (BHD · other DR banks · PayPal): hours (regular / premium), pay rate, gross, adjustments, net USD, net DOP.
- Hans enters today's **exchange rate** (BHD auto-fetch helps) → DOP updates → locked when marked paid.
- **Bonuses / deductions:** add to this payroll → used up when paid; optional "repeat for the next N paydays" ends by itself.
- **Mark paid** per person or all (date + reference).
- **Payslips** created automatically when marked paid → My workspace (+ optional email).
- **Payment list** for the transfers (printable / CSV): name, bank or PayPal, account, amount DOP. BHD bulk file later if wanted.
- **Bank / PayPal details** per employee, visible only with the "see bank details" permission.
- Info flag: client hasn't paid yet for these hours.

## Step 7 — My workspace redesign (Spanish / English, phone-first)

Menu (bottom tabs on phones): **Home** (status, today, week vs target, notices) · **My time** (charts, approved/pending, activity %, on-time record, add missing time, adjustments by YVA) · **My pay** (live earnings, payslips, payment history) · **My screenshots** · **Requests** (time off, missing time) · **My client** (supervisor, hours, instructions) · **Documents** · **Company** (announcements, holidays, handbook) · **Profile**.
YVA OS side: approvals inbox (time off + missing time), announcements editor, employee documents. Approved days off are not flagged as "No time" on the Schedule.

## Step 8 — Phone pass for the existing YVA OS pages

Bottom tab bar for the main sections, tables shown as cards on phones, every page checked at iPhone sizes. Fully usable on the phone: Weekly close, Payroll, approvals, Live. Invoice builder: review/approve only on phones.

## Step 9 — CRM

- **Leads** captured automatically from the website forms (with source page and Calendly booking) → pipeline with an owner per lead (ready for a lead-gen hire) → follow-ups and reminders → won lead becomes a client + project in one click.
- **Contacts** at each client firm (role, email, phone, WhatsApp); calls / meetings / notes timeline.
- **Careers applications** go straight into Candidates; client staff requests become openings with their own candidate pipeline.
- **Client health** badge (check-ins, open requests, overdue invoices, renewal).

---

## Rollout

Run the weekly close **alongside the current process for two weeks** and compare invoices and payroll. Once they match, retire Hubstaff and the Excel work. Existing invoices, statements and paid records stay as they are; the new system starts from the week it's switched on.

---

## Technical notes (for implementation)

Reuse what exists: tracker tables + `yva_time_approve` / `yva_time_rollup`, Schedule logic (`src/utils/schedule.ts`), invoice HTML/PDF + portal, AutoPay (`run-autopay` charges only `sent/viewed/overdue/partial`), Gmail OAuth function, BHD rate function. From the old CRM (`/home/user/yva-os`, read-only): `src/utils/rates.ts` (two rate chains), `projects.assignments` idea, Gmail failure handling, `timesheet-reminder.cjs` (scheduled Gmail send via a designated sender user's refresh token).

Sketch of new data (names indicative):
- `placements` + `placement_rates(effective_from)` — bill/pay rate history per person per project.
- `projects.pay_schedule` (`weekly | biweekly | semimonthly | monthly` + anchor); employee override for the YVA team.
- `week_closes(week_start, status, prepared_at, approved_at, approved_by)`; invoices get `client_id`, `week_close_id`, `auto_generated`; items keep per-person sections, daily minutes, bill rate, premium minutes (snapshot, like the old CRM).
- `time_adjustments(employee_id, day, minutes_delta, note, by)` — visible to the employee; late blocks (created after close) flagged.
- `client_payments(invoice_id, date, amount, method, reference)`.
- `payroll_runs(payday, exchange_rate, status)`, `payroll_lines(run_id, employee_id, project_id, period, regular/premium minutes, pay_rate, gross_usd, adjustments, net_usd, net_dop, paid_at, reference)`, `payroll_adjustments(employee_id, type, amount, reason, run_id, repeat_remaining)`.
- `employee_payout_methods(employee_id, method bank|paypal, bank, account_type, account_number, holder_id, paypal_email)` — RLS on a `see_bank_details` permission.
- Permissions: `role_permissions(role, permission)` + `private.has_permission(text)`; `audit_log` via triggers.
- `notifications`, `push_subscriptions` (Web Push / VAPID from a Netlify function), `notification_prefs`.
- Scheduled functions (Netlify cron is UTC): week close Sun 23:59 America/Santo_Domingo = Mon 03:59 UTC; payroll-due reminder before Friday.
- Premium split from tracked time: blocks carry first/last second, so night-premium minutes can be allocated per 10-minute block.
- Portal invoice policy: add `status <> 'draft'`.
- PWA: `manifest.webmanifest` (name "YVA OS", scope `/os/`, standalone), square icons, service worker for push; `viewport-fit=cover` + safe-area insets.

---

## Build progress

Hans asked (2026-10-31) for all steps to be built in one go and checked together when he's back.
Nothing below is live until the branch is merged; the YVA Time app version is bumped but **not published**.

| Step | Status | Notes |
|---|---|---|
| 0 — Screenshots | ✅ Built + tested | Desktop app 0.4.0 (not published): click the screenshot → opens full size (one file per screen), "N screenshots waiting to upload — reason", log file (`%APPDATA%\YVA Time\logs\yva-time.log`, ⋯ → *Show log file*). YVA OS: *View screenshots* on the employee profile and on Live (deep link `/time?tab=screens&employee=ID&day=YYYY-MM-DD`). My workspace → *My screenshots* (own only, no delete; uses the existing employee-read policies, no SQL). Retention 60 days. |
| 1 — Foundation | ✅ Built + tested | **Run `supabase/migrate-step1-foundation.sql`.** Safe saving (only changed columns, never deletes records the page didn't have — also fixes Business Expenses deleting every project expense). Permissions (Team Access → Permissions; CEO has all). Change history (Settings → History + "Show change history" on client/employee/project profiles). Drafts hidden from the portal (re-asserted). Gmail errors shown, never silent; scheduled jobs send from the account chosen in Settings → Notifications → *Use my Gmail*. Bell + email + phone push (Settings → Notifications; My workspace → Notifications). Installable "YVA OS" app (manifest, icons, notifications worker). Tests: 47 SQL, 30 server, 28 unit, 24 browser checks. |
| 2 — Rates & placements | ✅ Built + tested | **Run `supabase/migrate-step2-rates.sql`.** Project → **Rates** card (position, bill rate, pay rate per person, from a date; history); employee profile → **Pay** (raises from a date, pay schedule for the YVA team); project → pay schedule; Projects page warns about placements with no rate. The invoice builder no longer bills clients at the employee's pay rate when a project has no rate. Only people with *Bill & pay rates* permission see rates. |
| 3 — Live earnings | ✅ Built + tested | My workspace → **My pay**: today, this pay period per project (its own schedule), ≈ RD$, Estimated / Approved / Paid, night premium, payday — refreshed every minute by the `employee-earnings` function (own pay only). |
| 4 — Weekly close | ✅ Built + tested | **Run `supabase/migrate-step4-weekly-close.sql`.** Every Monday 12:05 am (Dominican time) the `week-close-scheduled` job prepares last week: one combined draft invoice per client (people grouped by project, daily hours, bill rate, exact minutes, night premium as its own line, due date from the client's terms, numbered per client e.g. HAL-0001), flags and a payroll preview, then notifies (bell + email + phone). **Finance → Weekly close**: Summary · Invoices (preview / send / send all / payments) · Time (tap a day: add/remove minutes or move to next week, with a note the employee sees) · Flags · Payroll preview; *Prepare again*, *Approve week*. Employees see "Changes made by YVA" in My workspace. Invoice hours now print as "7h 20m". |
| 5 — Client payments | ✅ Built + tested | **Record payment** (date, amount, method, reference; partial payments) from Invoices (💲 button) or Weekly close; the invoice's amount paid and status update automatically; portal card payments are recorded by the Stripe webhook (counted once) and notify you. Dashboard: **Collected** for the date range. |
| 6 — Payroll | ✅ Built + tested | **Run `supabase/migrate-step6-payroll.sql`.** **Finance → Payroll** for each Friday: everyone whose pay period (project schedule; YVA team per person) is paid that Friday, from **approved** hours + YVA's adjustments, pay rate per day + night premium; grouped BHD · other DR banks · PayPal; exchange rate (BHD helper) locked once anyone is paid; **Mark paid** (date + reference) per person or all; bonuses/deductions used once (repeat N paydays creates N, each used once — they never come back); payslips (Payroll + My workspace, after paid); printable/CSV payment list; employee profile → **Payout** (bank or PayPal; visible only with the bank permission). Wednesday 9 am: prepared automatically + "Payroll due Friday" reminder. Flags: hours not approved, missing pay rate, no payout details, client hasn't paid yet (info only). |
| 7 — My workspace redesign | ✅ Built + tested | **Run `supabase/migrate-step7-workspace.sql`.** Spanish / English (follows the phone language, switch in Profile or the ES/EN pill). Menu: Home (tracking now?, today, week vs target, notices, next holiday) · My time (+ changes by YVA) · My pay (+ payslips) · My screenshots · Requests (**time off** + missing time) · My client (supervisor, WhatsApp, instructions) · Documents · Company (announcements, holidays) · Profile (details, notifications, language). Sidebar on computers, bottom tabs + "More" on phones. YVA OS: **HR → Approvals** (time off + missing time), **HR → Announcements** (news + holidays), employee profile → **Documents**, project → supervisor + instructions; approved days off show as days off on the Schedule (and aren't flagged in the weekly close). |
| 8 — Phone pass | ✅ Built + tested | YVA OS on phones: bottom tabs (Home · Week or Invoices · Time · Payroll or Team · More), safe areas for the iPhone notch/home bar, page headers wrap; every main page checked at 390 px (no sideways scrolling). Invoice builder is review-only on phones (explains instead of opening). |
