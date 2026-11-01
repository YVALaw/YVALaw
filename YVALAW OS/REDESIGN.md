# YVA OS redesign (2026-11) — implementation guide

The owner's mockup (`design_handoff_yva_os_redesign`) is the **visual source of truth**; the current code is the
**functional source of truth**. Every existing feature, option, setting and workflow must survive, restyled.
Mockup files (open in a browser, or read the HTML: markup at the top, `class Component` with states/labels at the bottom):

`/tmp/claude-0/-home-user-YVALaw/69338fe5-b873-5c0f-ba0e-b1ab37438381/scratchpad/mockup/design_handoff_yva_os_redesign/`
→ `README.md` (tokens, per-page behaviour — read it fully) and `designs/*.dc.html`.

To see a mockup screen: from that `designs/` folder run `python3 -m http.server 4190 --bind 127.0.0.1` (skip if
`curl -s localhost:4190` already answers), then from the scratchpad `tests/` folder:
`node ../mockshot.cjs "Leads.dc.html" 1440 900 <out.png>` (and 390 844 for phone). Files that are sub-pages are
mounted by `YVA OS.dc.html`; a sub-file opened alone renders its desktop branch with sample data.

## Already built (do not edit — ask in your report if you need a change)
- `src/styles/ds.css` — tokens + all primitives (read it: buttons `.btn .btn--primary|--gold|--ghost|--danger|--soft-gold|--sm|--xs|--icon`,
  `.input .select .textarea .field .form-grid`, `.seg`, `.tabs/.tab`, `.chips/.chip`, `.pill pill--<tone>`, `.dot`, `.card`,
  `.kpi-strip`, `.table-card .table`, `.mcards .mcard` (phone cards), `.kanban`, `.banner`, `.drawer`, `.modal-x`, `.menu`,
  `.sheet`, `.info-grid`, `.list-row`, `.stepper`, `.progress`, `.dropzone`, `.coming-soon-card`, `.avatar-i`, `.tag-preview`, `.tag-mono`…).
- `src/components/ui/index.tsx` — React kit: `PageHeader, Card, EmptyState, KpiStrip, Segmented, Tabs, Chips, Field,
  SearchInput, Checkbox, Switch, Stepper, Pill (+toneFor), Dot, Activity, Banner, Avatar, AvatarStack, Skel, Drawer, Modal,
  Sheet, Menu, Responsive, useIsMobile, useMediaQuery, useOverlay, onEnter`. Use these instead of hand-rolling.
- `src/components/Icon.tsx` — `<Ic d={P.name} size={16} />` with the redesign icon map `P` (old `IconX` exports remain).
- `src/utils/format.ts` — `usd, usdShort, dop, hmText, hmClock, initials, dateShort, dateMed, weekdayDate, ago`.
- `src/components/Shell.tsx` + `src/styles/shell.css` + `src/lib/nav.ts` + `src/services/hubStatus.ts` — header, dock,
  hub pop-ups/sheets, search palette, Create menu, account menu, **sibling chips above every hub page** (pages must NOT
  render their own hub chips or breadcrumbs). On phones the shell header shows the page name, so `PageHeader` hides
  its H1 below 760px unless `keepTitleOnPhone` (use that for record names on profile pages).
- `src/components/NotificationBell.tsx` (new look), `src/lib/install.ts`.

## Rules for every screen
1. Start the page with `<div className="page">` + `<PageHeader title sub actions />`. Cards on `--bg`; tables inside
   `.table-card` with a `min-width` on the table; **on phones (<760px) tables become `.mcards`** (see each mockup's mobile branch).
2. **No inline styles** for layout/colour/type. Put screen CSS in **your hub file only** (`src/styles/<hub>.css`), class
   names prefixed for your hub: home `home-`, finance `fin-`, crm `crm-`, operations `ops-`, people `ppl-`, settings `set-`,
   portal `por-`, my workspace `mw-`. Inline `style` only for truly dynamic values (a bar's width %, a data colour).
3. Keep **all** business logic, service calls (`services/*`), Supabase/Netlify-function calls, permission checks
   (`usePermission`, `can.*`, RLS assumptions), validations, confirmations and success/error feedback. Move logic, don't rewrite it.
   If you move code out of a page into a sub-component, keep behaviour identical.
4. Permission pattern: every hook above any early `return`; permission-gated loaders list the permission in effect deps
   (permissions load after first render for non-CEO roles).
5. Writes surface failures (optimistic update → await → roll back + message on error). Success = green `Banner` at the top
   of the page (or the existing ToastContext).
6. Destructive actions live in `⋯` `Menu`s or drawer footers in red text — never next to the primary button.
7. Loading: skeletons shaped like the cards/tables (`Skel`). Empty states: white card, centered muted copy (mockup copy).
8. Phone: tap targets ≥ 44px (ds.css does this for `.btn/.input` under 760px); no horizontal page scroll at 390px;
   tablets checked at 820px; desktop 1440px.
9. **Create menu deep links** (open the page's existing create flow on mount, then clear the param with
   `setSearchParams({}, { replace: true })`): `/invoice?create=invoice`, `/invoice?create=payment` (Record payment: pick an open
   invoice), `/leads?create=1`, `/clients?create=1`, `/projects?create=1`, `/time?create=1` (log manual time),
   `/employees?create=1`, `/expenses?create=1`. **Search deep links**: `/invoice?open=<id>` opens that invoice,
   `/leads?open=<id>` opens that lead's drawer.
10. New features shown in the mockup: build them for real when they're legitimate (frontend + backend + permissions).
    If one needs an external service/credential we don't have, implement what's possible and document the dependency —
    never fake it. **Saved views** (Clients, Invoices) are allowed as real features: per-user filters saved in `localStorage`
    key `yva_views_<page>` (no new table needed); keep the dashed `PREVIEW` tag off once it works.
11. Don't edit files owned by another hub. If two hubs share a component, the owner listed below edits it; others reuse it.
12. Fonts: Geist / Geist Mono are loaded (index.html). Use `.mono` for invoice numbers, `h:mm`, date strips, PREVIEW.

## File ownership
| Agent | Screens (mockup file) | Owns |
|---|---|---|
| Home | Home (`YVA OS.dc.html` home section), Reports view | `pages/HomePage.tsx` (new), `pages/ReportsPage.tsx`, `services/reportsService.ts`, `styles/home.css`, the `/` route line in `App.tsx` |
| Finance | Weekly close, Invoices + builder, Payroll, Expenses | `pages/WeeklyClosePage.tsx, InvoicePage.tsx, PayrollPage.tsx, GeneralExpensesPage.tsx`, `components/InvoiceBuilder.tsx, RecordPaymentModal.tsx`, `services/weeklyClose.ts, payroll.ts, payments.ts, invoiceEmail.ts`, `utils/invoiceHtml.ts, payslipHtml.ts`, `styles/finance.css` |
| CRM | Leads, Clients, Client profile, Estimates, Staff requests | `pages/LeadsPage.tsx, ClientsPage.tsx, ClientProfilePage.tsx, EstimatesPage.tsx, RequestsPage.tsx`, `components/ClientContacts.tsx`, `services/crm.ts`, `utils/clientHealth.ts`, `styles/crm.css` |
| Operations | Projects + project page, Time tracking (all tabs), Calendar | `pages/ProjectsPage.tsx, ProjectProfilePage.tsx, TimeTrackingPage.tsx, CalendarPage.tsx, pages/time/*`, `components/PlacementRates.tsx, MissingRates.tsx, MentionInput.tsx, TagInput.tsx, TagBadge.tsx`, `styles/ops.css` |
| People | Team + employee page, Approvals, Candidates + profile, Announcements | `pages/EmployeesPage.tsx, EmployeeProfilePage.tsx, ApprovalsPage.tsx, CandidatesPage.tsx, CandidateProfilePage.tsx, AnnouncementsPage.tsx`, `components/EmployeePayRates.tsx, EmployeePayoutMethod.tsx, EmployeeDocuments.tsx, OpeningCandidates.tsx, RecordHistory.tsx`, `styles/people.css` |
| Settings | Settings (all tabs), Login/Signup/Set-password/Connect-app look | `pages/SettingsPage.tsx, LoginPage.tsx, SignupPage.tsx, ConnectAppPage.tsx, OAuthCallbackPage.tsx, PortalPage.tsx`, `components/PermissionsMatrix.tsx, HistoryList.tsx, NotificationSettings.tsx, AutoEmailSender.tsx`, `styles/settings.css` |
| Portal | Client portal (`Client Portal.dc.html`) | `components/ClientShell.tsx, PaymentModal.tsx, PortalSection.tsx`, `pages/portal/*`, `services/portalStorage.ts`, `styles/portal.css` |
| My workspace | `My Workspace.dc.html` | `pages/me/*`, `styles/me.css` |

Shared but owned: `pages/time/ScreenshotDay.tsx` (Operations; My workspace reuses it via its `self` prop),
`components/NotificationSettings.tsx` (Settings; My workspace reuses), `pages/time/EmployeeDevices.tsx` (Operations; People
reuses on the employee page), `components/HistoryList.tsx` (Settings; others reuse). Old `styles.css` stays until the end
(the integrator removes dead rules) — don't edit it; override in your hub file if an old global rule gets in the way.

## Testing (each agent)
- `cd "YVALAW OS" && npx tsc --noEmit -p tsconfig.json && npm test` must pass.
- Build to your own folder and serve on your own port (T = scratchpad `tests/`):
  `VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder npx vite build --outDir "$T/os-dist-<hub>" --emptyOutDir`
  then `npx vite preview --outDir "$T/os-dist-<hub>" --port <port> --strictPort` (ports: home 4201, finance 4202, crm 4203,
  ops 4204, people 4205, settings 4206, portal 4207, me 4208). Stop your preview server when done (kill by PID, never `pkill -f` a pattern that matches your own shell).
- Browser tests use `$T/osmock.cjs` (fake Supabase + functions; `OS_BASE=http://localhost:<port>/os`). Read `step4-ui.cjs` /
  `step9-ui.cjs` for examples. Write **your own** `$T/redesign-<hub>-ui.cjs` that exercises your screens' real flows
  (create, edit, status changes, drawers, permissions per role, phone layout at 390px with no horizontal overflow,
  tablet 820px) and port the assertions of the old tests that cover your screens (list in your brief). Don't edit the old
  `step*-ui.cjs` files (the integrator retires them). Save screenshots of every screen at 1440 and 390 in `$T/redesign-<hub>/`
  and compare them with the mockup.
