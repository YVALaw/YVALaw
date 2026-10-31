# What to do when you're back (Steps 0–9)

Everything in PLAN.md is built and tested on the branch `claude/charming-turing-ue7mxi`.
**Nothing is live yet** and **no new YVA Time version was published.** Do these in order.

---

## 1. Run the database scripts (Supabase → SQL Editor)

Open each file, paste it all, press **Run**. Each one ends with a small table — every row should say
`RLS on` / `yes`. They're safe to run again, and safe for the site that's live today.

1. `supabase/migrate-step1-foundation.sql`
2. `supabase/migrate-step2-rates.sql`
3. `supabase/migrate-step4-weekly-close.sql`
4. `supabase/migrate-step6-payroll.sql`
5. `supabase/migrate-step7-workspace.sql`
6. `supabase/migrate-step9-crm.sql`

(There's no "step 3/5/8" file — those steps needed no database changes.)

## 2. Put the new version live

Ask me to open the pull request. Netlify builds a **preview** of it (real data) so you can click around
first. When you're happy, merge it.

**Right after it's live**, run one more script: `supabase/migrate-portal-invoices-lockdown.sql`.
It stops clients from reading staff pay details through the portal. (Running it *before* the new
version is live would make the old portal show no invoices — so wait until the merge has deployed.)
If you ever re-run the YVA Time phase 2 script, run `migrate-step4-weekly-close.sql` again after it.

## 3. Connect Gmail (for invoices, payslips and automatic emails)

1. Google Cloud Console → your OAuth client (Web application) → **Authorized redirect URIs** → add
   `https://yvastaffing.agency/os/oauth-callback`.
2. Netlify → Site configuration → Environment variables → add **`GMAIL_CLIENT_SECRET`** (the client
   secret from Google) → redeploy.
3. YVA OS → Settings → **Integrations** → paste the Client ID → **Connect Gmail**.
4. YVA OS → Settings → **Notifications** → **Automatic emails are sent from** → **Use my Gmail**.
5. Same page → **Send me a test**.

If you haven't yet: Supabase → Authentication → URL Configuration → Site URL
`https://yvastaffing.agency/os/` and Redirect URL `https://yvastaffing.agency/os/**`.

## 4. Turn on phone notifications (you, then your team)

**iPhone:** open `yvastaffing.agency/os` in **Safari** → Share → **Add to Home Screen** → open
**YVA OS** from the new icon → Settings → Notifications → **Turn on for this device** → Allow.
(Needs iOS 16.4 or newer.) **Android / computer:** same button, no home-screen step needed.
Employees do the same in **My workspace → Perfil / Profile → Notificaciones**.

## 5. Fill in what the automation needs (one time)

| Where | What |
|---|---|
| Each **project** → Edit | **Pay schedule** (weekly / every two weeks / quincena / monthly), client **supervisor** + **instructions** for the team |
| Each **project** → **Rates** card | Bill rate and pay rate per person where they differ from the project/employee rate. The Projects page warns about anyone with no rate |
| Each **employee** profile | **Payout** (BHD / other bank / PayPal); **Pay** card for raises or the YVA-team pay schedule; **Documents** (contract…) |
| Each **client** | Email (invoices go there), payment terms (e.g. "Net 15"), **Contacts** |
| HR → **Announcements** | Holidays for the year (they're never flagged as "No time") |
| Settings → Team Access → **Permissions** | Only if someone besides you should run payroll, see bank details, approve time off, own leads… (you always have everything) |

## 6. Publish YVA Time 0.4.0 (desktop app)

GitHub → **Actions** → "YVA Time — Windows installer" → **Run workflow** → tick **Publish** → Run.
Installed apps update themselves. New in 0.4.0: click the screenshot to open it full size, a warning
when screenshots can't upload, and ⋯ → **Show log file** to send us when something goes wrong.

## 7. Your new weekly rhythm

| When | What happens | You |
|---|---|---|
| **Monday 12:05 am** | Last week closes: one draft invoice per client, flags, payroll preview. You get a notification | **Finance → Weekly close**: check flags, fix time (tap a day), **Approve week**, **Send all** |
| **Wednesday 9 am** | Friday's payroll is prepared; "Payroll due Friday" notification | — |
| **Friday** | Payday | **Finance → Payroll**: enter the exchange rate (or **BHD rate**), **Payment list** for the bank, **Mark paid** — everyone gets their payslip in My workspace |
| When a client pays | — | Invoices → 💲 **Record payment** (card payments in the portal record themselves) |
| Every morning 8 am | Lead follow-ups due today | **CRM → Leads** (website leads arrive here automatically) |
| Any time | Time-off requests, missing time | **HR → Approvals** |

**Recommended:** run the weekly close and payroll **next to your current process for two weeks** and
compare the numbers before retiring Hubstaff / Excel.

## Good to know

- Screenshots are now kept **60 days** (the app notice says so).
- Saving is safer: a page only changes what you edited, and can never delete records it didn't have
  (this also fixed **Business Expenses**, which deleted every project expense when you saved).
- The invoice builder no longer bills a client at the employee's pay rate when a project has no rate.
- Every change is in Settings → **History** (and "Show change history" on client / employee / project pages).
  History of pay rates, payroll, bank details and leads is only shown to people who may see those.
- Time approved **after** a payday is paid on the next payday as a "late time" line (it used to be missed).
- Employee time zones should be real zone names (e.g. *America/Santo_Domingo*). Anything else is ignored
  and the Dominican time zone is used.
- Full details for developers: `PLAN.md` (Build progress) and `CLAUDE.md`.
