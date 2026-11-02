# What to do when you're back (Steps 0–9)

Everything in PLAN.md is built and tested on the branch `claude/charming-turing-ue7mxi`.
**Nothing is live yet** and **no new YVA Time version was published.** Do these in order.

---

## 1. Run the database scripts (Supabase → SQL Editor)

Open each file, paste it all, press **Run**. (If one stops with an error, send it to me; after a fix, run
**all six again from the top** — they're safe to repeat.) Each one ends with a small table — every row should say
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

**Netlify → Forms:** if you have an email notification on the `lead-backup` form, add one for the new
`application-backup` form too (careers applications when EmailJS is blocked). They also land in YVA OS → Candidates.

## 2b. After the redesign (November) is live — 9 more small scripts

Same way as step 1, in this order (each is safe to run again):
1. `supabase/migrate-redesign-portal.sql` — "Request more staff" saves how many people and which project
2. `supabase/migrate-redesign-finance.sql` — receipts on expenses
3. `supabase/migrate-redesign-people.sql` — scheduled announcements notify the team when they go live
4. `supabase/migrate-redesign-settings.sql` — Settings → Company: website, invoice footer, your own logo; Crisp chat
5. `supabase/migrate-redesign-people-extras.sql` — full hire date on employees (anniversaries)
6. `supabase/migrate-cc-emails.sql` — CC emails on clients, employees and invoices
7. `supabase/migrate-staff-profiles.sql` — staff profiles + "who did what" history (run it again whenever you re-run the Step 1 script)
8. `supabase/migrate-live-updates.sql` — live updates: YVA OS only re-reads what someone actually changed (no more
   background refresh every minute), and the bell gets new notifications pushed. Afterwards check Supabase →
   **Database → Publications → supabase_realtime**: `data_versions` and `notifications` should be listed (the script adds
   them). Until this script runs, YVA OS keeps working as before (data kept 1 minute). If you create a new table
   later, run this script again.
9. `supabase/migrate-outlook-email.sql` — email from Outlook: a log of every email YVA OS sends (who, to whom, sent or
   failed) and the per-person sending limits; it also deletes the old Gmail sign-in keys that were stored. Set up
   Outlook first (step 3 below); emails still go out before this script runs, just without the log and limits.

**Crisp chat (client portal → Messages):** make a free account at crisp.chat → Settings → Website settings →
copy the **Website ID** → YVA OS → Settings → **Integrations** → Crisp → paste → Save. Clients then chat with
you from the portal; you answer in the Crisp app or website.

## 2c. Move the old CRM's data in (one time, November 2026)

1. YVA OS → Settings → Data → **Export JSON** (a copy of the test data, just in case).
2. Supabase → SQL Editor → paste and run `supabase/start-fresh-DELETES-ALL-DATA.sql`. It empties everything except
   your CEO login, settings and permissions. Sign out of YVA OS and back in afterwards.
3. YVA OS → Settings → Data → **Import from old CRM** → choose the old CRM's backup file → read the preview → **Import**
   (leave "Copy résumé/video files" ticked). Wait for "Everything is in YVA OS" → **Done — reload YVA OS**.
4. Optional: Supabase → Storage → empty the `screenshots` bucket (old test screenshots).

## 3. Email from Outlook (invoices, reminders, statements and automatic emails)

YVA OS sends every email from **one company mailbox** (for example `contact@yvastaffing.agency`) in your Microsoft 365.
You give YVA OS a "key" that can only send email, and only from that one mailbox. About 20 minutes, once.
You need a Microsoft 365 **admin** login.

**A. Create the app in Microsoft (Entra)**
1. Go to **entra.microsoft.com** and sign in as an admin.
2. Left menu → **Applications → App registrations** → **New registration**.
   Name: `YVA OS email` · Supported account types: **Accounts in this organizational directory only (single tenant)** ·
   leave Redirect URI empty → **Register**.
3. On the app's **Overview** page, copy two values into a note:
   **Application (client) ID** and **Directory (tenant) ID**.
4. Left menu of the app → **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** →
   search **Mail.Send** → tick it → **Add permissions**. Then click **Grant admin consent for …** → **Yes**.
   The status column must show a green check ("Granted").
   (If a "User.Read" delegated permission is listed you can remove it — YVA OS doesn't need it.)
5. Left menu → **Certificates & secrets** → **Client secrets** → **New client secret** → description `YVA OS`,
   expires **24 months** → **Add**. Copy the **Value** right away (it is shown only once — not the "Secret ID").
   Put a reminder in your calendar ~2 weeks before it expires: create a new secret and update Netlify (step B).

**B. Give the values to Netlify**
6. Netlify → your site → **Site configuration → Environment variables** → add these four:
   - `MS_TENANT_ID` = the Directory (tenant) ID
   - `MS_CLIENT_ID` = the Application (client) ID
   - `MS_CLIENT_SECRET` = the secret Value
   - `MS_SENDER_MAILBOX` = the mailbox emails come from, e.g. `contact@yvastaffing.agency`
7. If `GMAIL_CLIENT_SECRET` is listed there, delete it (Gmail is no longer used).
8. Netlify → **Deploys** → **Trigger deploy → Deploy site** (new variables only apply after a deploy).

**C. Lock the app to that one mailbox (important for security)**
Without this, Mail.Send lets the app send as *any* mailbox in your company. This limits it to the one you chose.
9. On a Windows computer, open **PowerShell** and run these one at a time (first two only once per computer):
   ```
   Install-Module ExchangeOnlineManagement -Scope CurrentUser
   Connect-ExchangeOnline
   New-ApplicationAccessPolicy -AppId <Application (client) ID> -PolicyScopeGroupId contact@yvastaffing.agency -AccessRight RestrictAccess -Description "YVA OS sends only as this mailbox"
   Test-ApplicationAccessPolicy -AppId <Application (client) ID> -Identity contact@yvastaffing.agency
   ```
   The last command should say **AccessCheckResult : Granted**. (Optional extra check: run it again with another
   person's address — it should say **Denied**.) Changes can take up to an hour to apply.

**D. Finish in YVA OS**
10. Supabase → SQL Editor → run `supabase/migrate-outlook-email.sql` (step 2b, item 9).
11. YVA OS → Settings → **Integrations** → **Email sending · Outlook** should say **Connected · Sends from contact@…**
    → click **Send test email to me** and check your inbox (and junk folder). If it says **Problem**, the message
    explains what to fix (wrong or expired secret, consent not granted, mailbox name, or the policy from step C not
    active yet — wait an hour and click **Check again**).
12. YVA OS → Settings → **Notifications** → **Send me a test** (the automatic emails use the same mailbox).

Until this is done, the email buttons still work: YVA OS explains that Outlook isn't set up and offers to open the
email in your own mail app with the PDF downloaded.

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
