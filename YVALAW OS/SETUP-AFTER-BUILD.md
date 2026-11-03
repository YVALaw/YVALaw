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

## 2b. After the redesign (November) is live — 11 more small scripts

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
10. `supabase/migrate-stripe-secure.sql` — safer online payments: each Stripe payment, refund and dispute is recorded
   exactly once, card/bank payments recorded by Stripe can't be edited or deleted by mistake, bank (ACH) and saved
   payment methods. Once an invoice has recorded payments, its "amount paid" is always their total (changing the status
   by hand can no longer make a paid invoice payable again). Run it **before** adding the new Stripe webhook events
   (step 3b), and run it again whenever you re-run `migrate-step4-weekly-close.sql`.
11. `supabase/migrate-expenses-recurring-fees.sql` (after item 10) — **repeating expenses** (rent, software…: Finance →
   Expenses → Add expense → *Repeats: every month*, they then add themselves; the new daily `expenses-recurring`
   function does it at 12:30 am, the Expenses page also catches up when you open it) and **Stripe fees** in Reports
   ("Card & bank fees", "Received after fees"). Afterwards press **Fill missing fees** in Reports once for Stripe
   payments made before this script.

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

## 3b. Stripe — card and bank payments, "Pay now" links, AutoPay

What clients can do: pay an invoice in the portal by **card or US bank account (ACH)**, pay from the **"Pay online" link**
that is now added to every invoice and reminder email (no login needed; it always charges the current balance and
expires after 60 days), save a card or bank account, and turn on **AutoPay** (only invoices with a due date; up to 3
tries, 3 days apart). From YVA OS you can **refund** a card/bank payment (Invoices → 💲 → Refund) and **Copy pay link**.

**A. Test mode first (your current keys)** — about 10 minutes
1. Run `supabase/migrate-stripe-secure.sql` (2b, item 10).
2. Stripe → turn **Test mode** on → **Settings → Payment methods** → make sure **Cards** and **ACH Direct Debit** are on.
3. Stripe → **Developers → Webhooks** → open your existing endpoint
   (`https://yvastaffing.agency/.netlify/functions/stripe-webhook`) → **Select events / Update details** → tick all of these
   and save:
   `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.requires_action`,
   `payment_intent.canceled`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.funds_withdrawn`,
   `charge.dispute.funds_reinstated`, `charge.dispute.closed`, `setup_intent.succeeded`, `payment_method.detached`,
   `payment_method.automatically_updated`, `payment_method.updated`, and (recommended — it fills in the Stripe fee of
   bank payments once Stripe knows it) `charge.updated`
4. YVA OS → Settings → Integrations → **Stripe** should say "Connected · Test mode" with no warnings.
5. Permissions (Settings → Team Access → Permissions): **Refund card/bank payments** for whoever may refund (you, the
   CEO, always can). **Send email from YVA OS**: CEO, Admin and Accounting can always send; give it (or "Send invoices")
   to any recruiter / lead-gen person who needs to email from YVA OS.
6. Try it with a test client portal login:
   - Pay an invoice with card `4242 4242 4242 4242` (any future date, any CVC) → the invoice turns Paid.
   - Pay another with **US bank account** → choose the test bank → the invoice shows "Bank payment on its way"; in test
     mode it clears after a few minutes and turns Paid.
   - Billing → **Add card or bank account** with the AutoPay box ticked → AutoPay On.
   - In YVA OS open that invoice's 💲 → **Refund** part of it → the balance goes back up.
   - Email yourself an invoice → click **Pay online** → you land on a Stripe page for the balance.

**B. Going live (real money)** — about 15 minutes, when the tests look good
1. Stripe → turn **Test mode off**. Finish anything Stripe asks for (business details, the bank account for payouts).
2. **Settings → Payment methods** (live) → turn on **ACH Direct Debit** (cards are on by default).
3. **Developers → API keys** (live) → copy the **Publishable key** (`pk_live_…`) and the **Secret key** (`sk_live_…`).
4. **Developers → Webhooks** (live) → **Add endpoint** → `https://yvastaffing.agency/.netlify/functions/stripe-webhook`,
   the same 16 events as above → save → copy its **Signing secret** (`whsec_…`).
5. Netlify → **Site configuration → Environment variables** → replace the three values with the live ones:
   `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` → **Deploys → Trigger deploy**.
6. YVA OS → Settings → Integrations → Stripe must say **"Connected · Live"**. If one key is test and the other live it
   shows a warning — and payments from the wrong mode are ignored, so nothing mixes.
7. Pay a small real invoice (e.g. $1) yourself, then refund it from YVA OS.
8. Tell clients: cards or bank accounts saved in test mode don't carry over — they add them again once. Re-send any
   invoice emailed during testing (its pay link was made for test mode).
Never paste these keys into an email or chat; they only go into Netlify.

## 3c. Live updates (turn on when your team uses YVA OS)

Live updates are **paused** to keep the database quiet while you're the only one using YVA OS (Settings → Integrations
shows "Live updates · Paused"). When your team starts working in it: Netlify → **Site configuration → Environment
variables** → add `VITE_LIVE_UPDATES` = `on` → **Deploys → Trigger deploy**. Changes teammates make then appear right
away and the bell gets notifications instantly. If the Supabase dashboard ever warns about the **Disk IO budget**, set it
back to `off` (or upgrade the Supabase compute).

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
