# YVA Law Staffing: Work Plan (from 2026-11-04)

The saved list of everything we agreed to do, so nothing gets forgotten.
**To pick up where we left off:** tell Claude *"open docs/GROWTH-PLAN.md and continue with the next unchecked item."*
Tick items (`[x]`) as they're done. **You** = Hans; **Claude** = me.

Website = **yvastaffing.agency** (this repo). Staff app = **YVA OS** (`/os`).

---

## 0. First: stop publishing the project's internal files (security, Day 1)

The website is deployed from the whole project folder (`publish = "."` in `netlify.toml`), so anyone can download
internal files from the live site. Checked 2026-11-03, all returned 200:
`/CLAUDE.md`, `/YVALAW OS/SETUP-AFTER-BUILD.md`, `/YVALAW OS/CLAUDE.md`, YVA OS source code, database scripts
(`/YVALAW OS/supabase/*.sql`), server function code, `/YVA Time/…`, `build.js`, `package.json`.
No passwords or keys are in them (`.env` files are not deployed, keys live in Netlify), but they describe the
security setup, the Supabase project and client names.

- [ ] **Claude:** make those paths return "not found". Use a forced 404 rule in `_redirects` for `/YVALAW OS/*`,
      `/YVA Time/*`, `/docs/*`, `/CLAUDE.md` and the build files (`build.js`, `build-images.js`, `dev-server.js`,
      `package*.json`, `serve.json`, `tailwind.config.js`).
      **Keep public:** `/content/prices.json`, `/posts/*`, `/jobs/*` and `/admin/*` (the website and the content editor use them).
      Check on the Netlify preview that the website, blog, careers, `/admin`, `/os` and the server functions all still work.
- [ ] **You:** approve publishing the fix.

> This file lives in `docs/`, which the fix also hides. Until the fix is live, don't merge this file into `main`.

### 0b. Stop fake leads (Day 1–2)

On 2026-11-04 a fake lead arrived ("Joseph", service "contract review", Source "Website"). No form offers that
service, and real forms always send the page name. A bot posted straight to `/.netlify/functions/lead-intake`
with a made-up `Origin` header, which the current check can't tell apart from the real site.

- [ ] **You:** free Cloudflare account → **Turnstile** → add a widget for `yvastaffing.agency` (mode "Managed" /
      invisible). Send Claude the **site key**; it's public, so it's OK in chat. Put the **secret key** only in
      Netlify → Environment variables as `TURNSTILE_SECRET_KEY`. Never paste it in chat.
- [ ] **Claude:** add Turnstile to every booking form (home + 7 landing pages), the checklist form and the careers
      application form. `lead-intake` / `application-intake` must verify the token on the server and refuse
      without it. Keep the honeypot and rate limits. If Turnstile itself is down, the EmailJS / Netlify Forms
      backup still delivers, so no real lead is lost.
- [ ] **Claude:** lead panel in YVA OS: show the page (Source), the ad details (UTM / gclid / fbclid) and a
      **"Not from a website form"** warning when the source or service isn't one the forms send.
      A "Mark as spam" action that deletes the lead and logs it.
- [ ] **Claude:** test on the Netlify preview: a real submission works on every form, and a direct post without a
      token is refused.

---

## 1. Quick setup (You, about 1 hour, this week)

- [ ] **Bing Webmaster Tools** (bing.com/webmasters): sign in → **Import from Google Search Console** (or add
      `https://yvastaffing.agency` by hand) → submit `https://yvastaffing.agency/sitemap.xml`.
      *Why: ChatGPT's web search uses Bing. If Bing doesn't know the site, ChatGPT can't recommend it.*
- [ ] **Google Search Console:** Pages → check that the home, blog posts, careers and checklist are "Indexed".
      The ad landing pages are hidden from search on purpose, so "not indexed" is fine for them.
- [ ] **Google Analytics, count leads:** Admin → Events → mark these as **Key events**: `generate_lead` /
      the booking-form event, `download_checklist`, `application_submitted`. Today the report shows 0 key events.
      Claude will tell you the exact names if they don't show up.
- [ ] **Google Analytics, clean numbers:** in Reports → Engagement → Pages and screens, add **Stream name** and
      **Hostname** (the **+** next to the first column). Find which ID the unknown "EZ Way Mortgage" /
      "{{NOMBRE_EMPRESA_CORTO}}" pages arrive through and from which website. Send Claude a screenshot.
      - Known: .agency uses `G-V2Q6V4HE4F`; .net uses `G-GR54EXMBTD` (its code is at github.com/hanler11/YVA).
      - [ ] **Claude:** if the strange traffic comes through the .agency ID, swap in a new ID (You create it:
            Admin → Data streams → Add stream → Web → yvastaffing.agency) on every page.

---

## 2. Case studies (You send the info; Claude writes them)

For each client (1–2 to start; Halavi Law, Top Law Assist and FoodNet PR are candidates), send:

1. **Permission:** may we use their name and logo? If not, we write "a personal injury firm in Texas".
2. **About the firm:** practice area, city/state, roughly how many attorneys / staff.
3. **The problem before YVA:** e.g. missed calls, slow intake, demands taking weeks, staff turnover, cost.
4. **What YVA provided:** which roles (intake, assistant, demand writer, case manager), how many people, since when, hours.
5. **Results with numbers** (estimates are OK, say which are estimates):
   - calls answered / response time
   - consultations booked or cases signed per month (before → after)
   - demand letters per month / turnaround time
   - money saved vs. hiring in-house
   - hours the attorneys got back per week
6. **A quote** from the attorney or office manager (1–3 sentences), with name and title.
7. **Optional:** their logo file, a photo, their website / LinkedIn link.

- [ ] You: info for case study 1
- [ ] You: info for case study 2
- [ ] Claude: write both case studies (English + Spanish), as pages + a short version on the home page
- [ ] Claude: **client logos bar** near the top of the home page (only clients who said yes)

---

## 3. Website pages that search engines and AI can read (Claude)

The 7 ad landing pages stay as they are (hidden from search, for ads). New pages are written differently so they
don't compete with the ads.

- [ ] One page per **role**: Legal Intake, Legal Assistants, Demand Writing, Case Managers
      (what they do, a typical day, price from the Prices form, FAQ, book a call)
- [ ] One page per **practice area**: Personal Injury, Employment Law, Workers' Comp
- [ ] **Pricing guide:** "How much does a virtual legal assistant cost?" (in-house vs. freelancer vs. YVA, real numbers)
- [ ] **Comparison pages:** "Virtual legal assistant vs. hiring in-house" and "How to choose a virtual legal staffing company"
- [ ] **Company facts** for AI: an `llms.txt` file plus an "At a glance" box on About (who, where, roles, prices,
      languages, 72-hour onboarding, no contracts, clients served). Same wording everywhere.
- [ ] Add the new pages to the sitemap, the menu/footer and the site's built-in business info (structured data)
- [ ] **Spanish versions** of the key pages (being bilingual is the main selling point)
- [ ] Automatic "new page" notice to Bing on every deploy (IndexNow)

## 4. Blog (Claude drafts, You approve, 2 posts a month)

Titles are the questions people actually type into Google / ChatGPT. First ideas:
- [ ] Can a virtual assistant handle legal intake for a PI firm?
- [ ] Is it legal (and safe) to outsource intake / client communication for a law firm?
- [ ] Bilingual intake: how much business are English-only firms losing?
- [ ] What does a legal case manager do, and when does a firm need one?
- [ ] How long does it take to onboard a virtual legal assistant? (72-hour process)
- [ ] Demand letter checklist: what a good demand package includes

## 5. Turning visitors into leads (Claude)

- [ ] **WhatsApp button** (floating, every page; number from /admin → Contact & Hours)
- [ ] **Live chat** on the website (Crisp, already used in the client portal)
- [ ] **"Try 1 week" pilot offer** (You decide the terms first: price, what's included)
- [ ] **Exit pop-up** offering the free checklist
- [ ] Check the booking form on phones (short, fast, clear "what happens next")

## 6. Getting mentioned on other websites (You; Claude drafts the text)

AI tools mostly repeat what *other* websites say about a company. This is the biggest lever for AI recommendations.
- [ ] **Google Business Profile** (Claude drafts the description and services)
- [ ] **Clutch** profile, then **GoodFirms** and **UpCity** (same description everywhere)
- [ ] Ask 5–10 happy clients for a review on Clutch or Google (Claude writes the request email)
- [ ] **LinkedIn** company page complete, plus 1–2 posts a week (Claude drafts a month of posts at a time)
- [ ] Vendor listings: state trial-lawyer associations (PI firms), legal software partner directories (e.g. Clio)
- [ ] Helpful answers on Reddit (r/LawFirm) / Quora when people ask about intake or staffing. No ads.
- [ ] 1 guest article or podcast a month aimed at small law firm owners (Claude finds targets + drafts pitches)

## 7. Measuring it (monthly, first week of each month)

- [ ] Ask ChatGPT, Perplexity and Gemini the same questions and write down whether YVA appears:
      1. "best bilingual virtual legal assistant companies"
      2. "virtual legal intake services for personal injury firms"
      3. "how much does a virtual legal assistant cost"
      4. "outsourced legal staffing Spanish speaking"
      5. "YVA Law Staffing reviews"
- [ ] Google Analytics: visits from **AI Assistant** and **Organic Search**, and **key events** (leads), compared with last month
- [ ] Claude: short monthly summary + what to change

---

## 8. YVA OS: permissions and email signatures (decided 2026-11-03, not built yet)

Decisions:
- **Admin** may keep editing Settings (company info, email wording, weekly reminder, etc.).
- **Signatures:** each person can set their own in a new *My profile* page. If they haven't, the email ends with
  their registered name. Automatic emails (weekly reminder, AutoPay, alerts) use the company signature.
- **Replies** keep going to the shared company mailbox (no extra Microsoft 365 licences).
- **Email history:** everyone can see every email sent.
- **Accounting** may see the money screens too (revenue, payroll totals, client rates).

To build (Claude):
- [ ] **Data tab:** "Export all data" and "Restore from backup" for the CEO only (today every staff role sees them; Restore can overwrite data)
- [ ] Recruiter / Lead Gen: hide the Settings tabs they can't save (today they see the forms but saving fails)
- [ ] Exchange rate: CEO + anyone with "Run payroll" (today Admin can change it in Settings regardless)
- [ ] My profile: name, title, phone, signature (own only; CEO can edit anyone's) + database column/table
- [ ] Every send (invoice, reminder, statement, client email, bulk, weekly close) uses the sender's signature, falling back to their registered name
- [ ] One permissions screen: turn the fixed role rules into defaults the CEO can change, plus a "what this role can see" summary
- [ ] Check the live database rules with a read-only query first (You run it, Claude reads the result)
- [ ] Database locks, not just hidden screens; test; then publish

---

## Schedule

| When | You | Claude |
|---|---|---|
| **Wed Nov 4** | Approve the security fix (0). Turnstile account + keys (0b). Bing + Search Console + key events (1). | Security fix (0), test on preview. Fake-lead protection + lead panel (0b). |
| **Thu–Fri Nov 5–6** | Send case study info (2). Analytics screenshot with Hostname. | Role pages + practice-area pages (3). WhatsApp button (5). |
| **Week of Nov 9** | Google Business Profile, Clutch (6). Review the new pages. | Pricing guide, comparison pages, company facts / llms.txt, IndexNow (3). Case studies + logos bar (2). |
| **Week of Nov 16** | Ask clients for reviews. LinkedIn page. Decide pilot-offer terms. | Permissions + signatures in YVA OS (8). First 2 blog posts (4). |
| **Week of Nov 23** | GoodFirms, UpCity, association listings. | Spanish versions (3). Live chat, exit pop-up, pilot offer (5). |
| **Week of Nov 30** | First monthly AI check (7). | Monthly summary (7). Next 2 blog posts. LinkedIn posts for December. |
| **Every month after** | Reviews, LinkedIn, 1 outreach. | 2 blog posts, LinkedIn drafts, monthly check-in. |

---

## Log
- 2026-11-03: Plan written. Live check found internal files downloadable from the site (section 0).
- 2026-11-04: Fake lead ("contract review", Source "Website") came in by direct post to lead-intake; added 0b (Turnstile + lead panel).
