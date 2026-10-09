# YVA Law Staffing — legalWebs Project

## Project Overview
Single-page website for **YVA Law Staffing** (yvastaffing.agency).
Single file: `index.html` (~3200 lines). Plain HTML pages + a small build step (`node build.js`): Tailwind CSS, Lucide icons, EmailJS, Calendly.

**Build step (runs on every Netlify deploy, and via `npm run dev` / `npm run build` locally):**
- `assets/css/tailwind.css` — compiled from `assets/css/tailwind.src.css` using the classes found in `*.html` + `build.js` (`tailwind.config.js`). Pages link this file; the Tailwind Play CDN is no longer used (it was ~400 KB of render-blocking JS). **After adding new Tailwind classes, run `npm run build` (or `npm run build:css`) before previewing locally** — Netlify rebuilds it on deploy anyway. Never build class names from string pieces in JS (`'bg-' + color`); the compiler only sees full class names.
- `assets/js/lucide.js` — generated subset of Lucide v0.469.0 with only the icons the site uses (found as `data-lucide="…"`, any quoted icon name in the pages, and job-post `icon` fields). Same API as the library: `lucide.createIcons()`.
- `tailwind.config.js` sets `future.hoverOnlyWhenSupported`, so `hover:` styles only apply on devices with a mouse (no "stuck" hover colors after a tap on phones).
- Shared base CSS in `tailwind.src.css`: icon placeholders keep their size before Lucide runs (no layout shift), form fields are 16px on phones (prevents iOS zoom-on-focus), and the blog article (`.prose`) styles used by blog posts and the `/admin` preview.
- Generated files (`tailwind.css`, `lucide.js`, `posts/index.json`, `posts/scheduled.json`, `jobs/index.json`, `sitemap.xml`) are committed so the site still works if previewed without building. **Exception: resized pictures** (`assets/img/site/`, made by `build-images.js` with `sharp`) are gitignored, so run `npm run build` before previewing locally or the photos are missing.
- `build-images.js` (run by `build.js`) resizes every picture spot to 480–2000px WebP (faces: 96/144px squares). If it fails (e.g. Node < 20.9 for sharp), `build.js` falls back to the original uploads instead of failing the deploy.

**Standalone pages:**
- `landing-intake.html` — Legal Intake ad landing page ($7.50/hr)
- `landing-assistants.html` — Legal Assistants ad landing page ($8.50/hr)
- `landing-demand.html` — Demand Writing ad landing page ($10/hr)
- `landing-case-managers.html` — Case Managers ad landing page ($12/hr)
- `landing-pi.html` — Personal Injury practice area ad landing page (GA: `landing_pi`, noindex)
- `landing-employment.html` — Employment Law practice area ad landing page (GA: `landing_employment`, noindex)
- `landing-workers-comp.html` — Workers' Comp practice area ad landing page (GA: `landing_workers_comp`, noindex)
- `checklist.html` — Lead magnet: printable Legal Staffing Checklist (10 Q&A sections, print button)
- `careers.html` — Careers page (7 open roles, application modal, separate EmailJS account)
- `blog.html` — Blog listing page (fetches posts/index.json dynamically)
- `blog-post.html` — Template for blog posts (also a client-side fallback renderer). `build.js` generates one static page per post at `blog/<slug>/index.html` (gitignored, built on every Netlify deploy) with its own title, description, canonical, OG tags and BlogPosting JSON-LD. Old `blog-post.html?slug=` URLs 301 to `/blog/<slug>/` via `_redirects` (forced with `301!`: blog-post.html exists, so an unforced rule was skipped).
- `package.json` — root deps for `build.js` (`marked`, `tailwindcss`, `lucide`). Netlify runs `npm install && node build.js`.

All service landing pages: Hero → Problem → Solution + cost comparison → Testimonials → How It Works → FAQ → Final CTA → Booking modal (EmailJS → Calendly). GA events use page-specific `event_category`.
Practice area landing pages: Hero → Problem → Services (role cards) → Cost comparison → Testimonials → How It Works → FAQ → Final CTA → Booking modal.

**Brand colors:** Dark navy `#1b1e2b`, Yellow `#facc15` / `yellow-400`, White backgrounds.
**Font:** Inter (Google Fonts).

---

## Current Services (in order)

| # | Service | Rate | Monthly (160 hrs) |
|---|---|---|---|
| 0 | Legal Intake | $7.50/hr | ~$1,200/mo |
| 1 | Legal Assistants | $8.50/hr | ~$1,360/mo |
| 2 | Demand Writing | $10/hr | ~$1,600/mo |
| 3 | Case Managers | $12/hr | ~$1,920/mo |

**Starting rate used in copy:** $7.50/hr (referenced in hero, footer, how-it-works, FAQ, meta tags).

### What each role does (for copy accuracy)
- **Legal Intake** — First point of contact. Bilingual call/email handling, client screening & eligibility, intake form + CRM entry, consultation scheduling, lead follow-up.
- **Legal Assistants** — Day-to-day attorney support. Calendar management, client correspondence, case file organization, deadline tracking, document drafting.
- **Demand Writing** — Builds full demand packages. Medical record review, damages calculation, demand letter drafting to firm standards, settlement package prep, adjuster follow-up.
- **Case Managers** — Owns the full case lifecycle. Coordinates client/attorney/providers/adjusters, treatment follow-up, deadline tracking, status reporting. Nothing falls through.

---

## Page Structure (section IDs)

| Section | ID | Notes |
|---|---|---|
| Hero | `#home` | Price badge, testimonial float, trust signals |
| Service Pillars | `#service-pillars` | 4 clickable cards — desktop expands `#services`, mobile opens modal |
| Services Detail | `#services` | Sliding panels (desktop only, hidden by default) |
| Pricing | `#pricing` | 4 cards + comparison table |
| How It Works | `#how-it-works` | 3 steps |
| Testimonials | `#testimonials` | 4-slide carousel, auto-advances |
| About | `#about` | Story, stats grid, founders toggle |
| Footer | — | Quick links, services list, contact |

---

## Key Behaviors & JavaScript

### Services — Desktop
- Clicking a pillar card (`data-service="0-3"`) expands `#services` section below with smooth CSS animation.
- Clicking the same card again collapses it.
- Tabs inside `#services` slide between panels via `services-track` translateX.

### Services — Mobile
- Below 768px, pillar cards render as a tappable list (icon · title · chevron); above that they are cards.
- Clicking a pillar card opens `#mobile-service-modal` (bottom sheet on phones).
- Backdrop tap closes it. Esc key also closes.
- Content rendered dynamically from `mobileServiceData[]` array in JS.
- **To update mobile modal content**, edit the `mobileServiceData` array (order must match pillar card `data-service` indices).

### Founders Section
- Cards (`#founders-cards`) are hidden by default (`max-height: 0`).
- `#founders-toggle` button reveals/hides them with CSS transition.
- Arrow icon rotates 180deg when open.

### Comparison Table
- **Desktop** (`hidden md:block`): standard HTML table.
- **Mobile** (`md:hidden`): stacked cards showing In-House vs YVA vs Savings.

### Booking Modal
- Two-step: form (EmailJS) → Calendly embed.
- `openCalendly(serviceName)` pre-fills the service field.
- EmailJS: service `service_d485bxr`, templates `template_8gftonr` (to YVA) and `template_9r6xtuw` (auto-reply to client).
- All booking forms (home + 7 landing pages) send through `yvaSendLead()` in `assets/js/lead-send.js`. If EmailJS fails (ad/privacy blockers can block it), the lead is posted to **Netlify Forms** (`lead-backup`, declared by a hidden form at the top of `index.html` — keep its field names in sync with the script). GA events: `lead_backup_used` / `lead_lost` (`event_category: lead_delivery`). Requires form detection + an email notification enabled in Netlify → Forms.
- Calendly URL: `https://calendly.com/contact-yvastaffing-vuu8/new-meeting`

### Language Toggle (EN/ES)
- Pill buttons in desktop nav and mobile drawer (`#lang-en`, `#lang-es`, `#lang-en-mobile`, `#lang-es-mobile`).
- `data-i18n="key"` attributes on all translatable elements (nav, hero, trust badges, service pillars + full panels + bullets, pricing, comparison table, ROI calculator, testimonials header, about section + stats, founder section, footer, cookie banner).
- Central `translations` object with `en` and `es` keys (~80 keys each).
- `setLang(lang)` iterates all `[data-i18n]` elements and sets `innerHTML`.
- Language persisted to `localStorage('yva_lang')`.
- **To add a new translatable string:** add `data-i18n="myKey"` to the element, then add `myKey` to both `en` and `es` objects in the translations block.

### Lead Magnet Modal (`#lead-magnet-modal`)
- Triggered by `openLeadMagnet()` — strip button between ROI calculator and How It Works.
- Two-step: email + name capture form → success screen with link to `checklist.html`.
- On submit: sends EmailJS notification to YVA (`template_8gftonr`) AND auto-reply to submitter (`template_9r6xtuw`) with checklist link.
- GA event: `download_checklist` / `event_category: lead_magnet`.
- **Note:** verify `template_9r6xtuw` uses `{{email}}` as To address and `{{name}}` for personalization in EmailJS dashboard.

### Header / Navigation
- `#navbar` is `sticky` at every width with a fixed height (64px phones, 80px desktop). On scroll it only gains a shadow (`.nav-scrolled`) — changing its height caused layout jumps.
- Brand lockup everywhere: `logo/img2.png` + the text **YVA Law Staffing** (header, drawer, footer, all pages).
- Full desktop nav from `lg` (1024px); below that the hamburger + `#mobile-menu` drawer (hidden with `visibility` when closed, scrolls on short screens).
- **Staff Login is hidden for now** (YVA LawOS is a work in progress): the `/os/login` links in the desktop nav and the mobile drawer are wrapped in HTML comments. To bring them back, remove the comment wrappers — then check the nav still fits at 1024px (hide "Home" at `lg` with `hidden xl:inline` if it doesn't).
- The active-section highlight uses `#desktop-nav a[href^="#"]`.

### Mobile layout notes
- Pricing cards (`#pricing`) are a horizontal swipe row (scroll-snap) below 640px, a grid above.
- Testimonials: swipe on touch screens; arrows only from `md`.
- Modals (`#calendly-modal`, `#faq-modal`, `#privacy-modal`, `#mobile-service-modal`, landing `#lp-modal`) open as bottom sheets below 640px, sized with `dvh` so iOS Safari's toolbar can't hide their bottom.
- Decorative absolutely-positioned glows must stay inside an `overflow-hidden` parent — one poking out of the hero made every phone page 16px too wide (sideways wobble, clipped modals).

### Sticky CTA Bar (`#sticky-cta`)
- Fixed bottom bar, appears after scrolling 600px. On phones it's a single full-width "Book a Free Call" button + dismiss; the body gets matching bottom padding while it shows.
- Dismissed per session via `sessionStorage('yva_sticky_closed')`.
- z-index: 80 (cookie banner at 90 takes priority when both visible).

### Trust Badges Section
- 6 badges between hero and service pillars: 100% Bilingual, U.S. Time Zones, 72-hr Onboarding, No Contracts, Vetted Talent, Free Replacement.
- All badge text has `data-i18n` keys (`badge1`–`badge6`, `badge1sub`–`badge6sub`).

### Other Modals
- `#faq-modal` — FAQ accordion
- `#privacy-modal` — Privacy Policy
- `#email-picker` — Opens Gmail/Outlook for contact email
- `#mobile-menu` — Mobile nav drawer (slides from right)
- `#cookie-banner` — Slides up from bottom, dismissed to localStorage

---

## Content Manager (`/admin`)
- Decap CMS, pinned to an exact version in `admin/index.html` (a floating range could ship a release that rejects `admin/config.yml` and breaks the whole admin). Login: Netlify Identity + Git Gateway, commits straight to `main`.
- `admin/config.yml`: two collections, Blog Posts (`posts/`) and Job Posts (`jobs/`). Field `name`s are the frontmatter keys `build.js` reads; labels/hints are plain-language copy for non-technical editors.
- `admin/preview.js`: live preview pane drawn with the site's own CSS (blog card + post page, careers job card). Its markup mirrors `blog.html`, `build.js` and `careers.html` — update it when those change. `tailwind.config.js` scans `admin/*.js`.
- `admin/editor-blocks.js`: the blog editor's "+" menu blocks: **Book a call button** (`.post-cta`, links to `/?contact=1` by default), **Highlight box** (`.post-callout`) and **Table** (rows typed with `|` or pasted from Excel/Sheets, saved as a markdown table; its pattern matches *every* markdown table, so old tables open in the same form). Blocks are saved into the post as HTML/markdown that `build.js` renders as-is and that each block's `pattern` reads back — change `toBlock` and `pattern` together, and keep old class names working (posts already contain them). Styles live in `tailwind.src.css` as plain CSS, not Tailwind utilities.
- Blog `draft: true` → `build.js` skips the post (no listing, page or sitemap entry). `image_alt` → the featured image's alt text (falls back to the title).
- Editor is rich-text only (Markdown mode hidden). Verified that re-saving every existing post in rich-text mode leaves the rendered pages unchanged, tables included.
- **Website Content** collection (files in `content/`): `testimonials.json` (home slider), `faq.json` (FAQ modal + FAQPage JSON-LD, built from the same text), `stats.json` (the 6 About cards, EN + ES; card colours fixed by position), `contact.json` (office hours EN/ES on every page, location, optional phone / WhatsApp / LinkedIn / Instagram / Facebook). `build.js` writes them into the pages between `CMS:<name> START` / `CMS:<name> END` marker lines, or inline `<!-- CMS:hours -->…<!-- /CMS:hours -->` (index, blog, blog-post, careers), replacing what's there. **Edit these sections through the JSON files / admin, not in the HTML**, or the next build overwrites the change. The build fails if a marker goes missing. Stat labels and footer hours/location reach the EN/ES switch through the generated `// CMS:i18n` block after the `translations` object. The carousel counts its slides, so any number of testimonials works.
- **Open & close roles** board (`admin/hiring.html` + `admin/hiring.js`, linked by a yellow button on the Job Posts list): Open/Closed switches for every `jobs/*.md`; saving writes all changed files in one commit. It calls Git Gateway (`/.netlify/git/github`) directly with the Netlify Identity login, using the same GitHub git-data calls Decap makes (branch → tree → blobs → tree → commit → non-forced ref update), and only rewrites each file's `status:` line. A save that races another edit is refused (422) instead of overwriting. `BRANCH` in `hiring.js` must match `backend.branch` in `config.yml`. Tested against a local stand-in gateway; the real Git Gateway can only be exercised on the live site.
- **Website Content** also has: **Home Page Top** (`content/hero.json`: label, headline + words to highlight, text, button, count, floating review — EN/ES), **Prices** (`content/prices.json`: 4 hourly rates + hours/month) and **Home Page Pictures** (`content/pictures-home.json`: hero, 4 service photos, 4 faces; image + alt + focus). Testimonials/FAQ have optional `_es` fields for the EN/ES switch. Contact & Hours has the contact **email**.
- **Landing Pages** collection (`content/landing-<page>.json`): each ad page's `picture` (spot `landing_<page>`), `testimonials` and `faq`, written between `CMS:lp-testimonials` / `CMS:lp-faq` markers in that page's design (`LANDING_STYLE` in build.js: service pages, condensed practice pages, Workers' Comp).
- **Prices**: every price is a marker naming what it shows — `<!-- CMS:price:EXPR -->$7.50<!-- /CMS:price:EXPR -->` in HTML, `/* CMS:price:EXPR */…/* … */` in scripts. EXPR = `start`, `hours`, `rate-S`, `month-S`, `year-S`, `save-N-S`, `savepct-N-S`, `savek-N-S` (rounded down to $1,000), `num-S`, `strhr-S`; S = intake/assistants/demand/case, several joined with `+`, or `all`; N = the in-house monthly figure written on that page (comparison claims are not prices and stay fixed). Home JSON-LD offer prices are matched by service name. `<head>` text uses `<!-- CMS:head-price EXPR $7.50 -->`. Text fields and blog articles accept `{price}`, `{intake}`, `{assistants}`, `{demand}`, `{case}`, `{month-intake}` / `{year-intake}` (etc.) and `{hours}` (articles that quote YVA prices use them; the admin preview fills them in too). **When adding a price to a page, wrap it in a marker** or it won't follow the Prices form.
- **Pictures**: `<!-- CMS:img:<spot> --><img …><!-- /CMS:img:<spot> -->` — build fills `src/srcset/alt/style` (object-position from the focus) and keeps the tag's own `class/sizes/width/height`; the phone service pop-up data uses `/* CMS:imgurl:<spot> */` and `/* CMS:imgpos:<spot> */`. The default photos are copies in `images/uploads/`.
- **Email**: each page records the address it shows (`<!-- CMS:email … -->` in `<head>`); the build swaps every occurrence when Contact & Hours changes.
- **Scheduled blog posts**: a post dated in the future is skipped like a draft and its date goes to `posts/scheduled.json`; the hourly Netlify function `YVALAW OS/netlify/functions/publish-scheduled-posts.mjs` triggers a deploy through the `BLOG_BUILD_HOOK_URL` build hook once one is due (without that env var, scheduled posts appear with the next deploy).
- Test locally: add `local_backend: true` to a copy of `admin/config.yml`, run `npx decap-server` in the site folder and serve the site on localhost.

## Integrations
- **Google Analytics:** `G-V2Q6V4HE4F`
- **EmailJS:** Public key `Vsnmntfk0c8ChKXVL`
- **Calendly:** `contact-yvastaffing-vuu8/new-meeting`

---

## Things Completed

### Session 11 (content manager)
- About section: Sam Colas removed (story, founder card, JSON-LD); Hans Henriquez → **Hans Esmel**, described as sole founder ("CEO & Founder"). Headings now "The Founder" / "Meet the Founder".
- `/admin` round 3: scheduled blog posts; swappable pictures with automatic resizing (`build-images.js`, sharp); Home Page Top, Prices, contact email, Spanish testimonials/FAQ; Landing Pages collection (photo, testimonials, FAQ per ad page). Fixed the PI page's 4-role total ($5,990 → $6,080).
- `/admin/hiring.html`: open/close several job roles at once without opening each post.
- `/admin` "Website Content": testimonials, FAQ, About numbers, contact & hours now editable (see "Content Manager"). Top-bar/phone-menu hours on the home page now follow the EN/ES switch. FAQ structured data now uses the full answers shown on the page.
- `/admin` editor blocks: Book a call button, Highlight box, Table (see "Content Manager").
- `/admin` made simpler: YVA logo, plain-language field hints, Draft switch, image description field, today's date by default, Spanish accents stripped from new post URLs, newest-first sorting, Drafts / Open / Closed filters, trimmed rich-text toolbar, icon picker for jobs, and a live preview that looks like the real site. See "Content Manager" above.

### Session 10 (SEO, branding, mobile)
- Title/brand: header, drawer and footer now read **YVA Law Staffing** (the logo image only says "YV"). Home `<title>`: "YVA Law Staffing | Bilingual Virtual Legal Staff for Law Firms".
- `<head>` fixes on every page: `<meta charset>`/viewport first; the Meta Pixel `<noscript><img>` moved to `<body>` (an `<img>` in `<head>` makes Google stop reading the head, so canonical/robots/description after it were ignored).
- Square favicons generated from the logo (`favicon.ico`, `favicon-192.png`, `apple-touch-icon.png`); the old `favicon.png` (61×52, not square) is kept only for the OS app.
- Structured data on the home page: Organization (logo, founders, contact point), Service + offer catalog, WebSite. Blog posts: BlogPosting with publisher logo + BreadcrumbList.
- Branded share image `assets/img/og-image.jpg` (1200×630) for home, blog, checklist and blog posts without a photo; `og:site_name` added.
- `build.js` frontmatter parser handles the multi-line values Decap CMS writes (descriptions were cut mid-sentence).
- `/os/*` (internal YVA LawOS app) is `noindex` (meta tag + `X-Robots-Tag` header in `netlify.toml`).
- Performance: Tailwind compiled at build time; Lucide subset served from the site; fonts via `<link>` + preconnect.
- Mobile: see "Mobile layout notes" above. All pages checked for horizontal overflow at 320/360/390/768/1024px.
- About stat "100x Assistants Placed" → "100+"; Staff Login links hidden until YVA LawOS is ready.

### Session 9 (SEO / indexing fixes)
- Fixed `blog-post.html`, which had been truncated mid-script since the logo update commit (posts never loaded)
- Static per-post blog pages generated by `build.js` → `/blog/<slug>/`; sitemap + blog listing point there; old query URLs redirect
- All 7 `landing-*.html` pages are paid-ad landing pages: `noindex, nofollow`, excluded from the sitemap, not linked from the home page. Their "not indexed" status in Search Console is expected.
- Sitemap: dropped fake per-deploy `lastmod` on static pages

### Session 8 (cleanup + fixes)
- Removed all founder names (Hans Esmel, Paola Delgado, Oven Valerio) from all HTML, translations (EN + ES), and about section
- Removed the entire Meet the Team / founders section from index.html (HTML, CSS, JS)
- Updated stats: 10+ → 50+ Law Firms Served; 27x → 100x Client Team Growth (EN + ES)

### Session 7 (marketing enhancements + translation)
- Removed Hans co-founder — Paola Delgado is now sole founder; updated all copy, grid layout, section labels, JS toggle labels
- Added `FAQPage` JSON-LD schema in `<head>` (8 Q&A pairs — triggers Google FAQ rich results)
- Added Trust Badges section (6 badges, between hero and service pillars)
- Added Lead Magnet strip + modal: email capture → success → link to `checklist.html`; EmailJS sends notification to YVA + auto-reply to submitter; GA event `download_checklist`
- Strip relocated to between ROI Calculator and How It Works (better conversion context)
- Added Sticky CTA bar (scroll-triggered at 600px, session-dismissible)
- Added EN/ES language toggle to desktop nav and mobile drawer
- `data-i18n` attributes added site-wide (~80 keys); full Spanish translations with natural phrasing
- Created `checklist.html` — printable/PDF legal staffing checklist (10 Q&A sections, print button)
- Created `landing-pi.html` — Personal Injury practice area landing page
- Created `landing-employment.html` — Employment Law practice area landing page
- Created `landing-workers-comp.html` — Workers' Comp practice area landing page
- Removed yellow announcement bar (user preference)
- Fixed lead magnet email: now sends auto-reply to submitter (was only notifying YVA)

### Session 1 (index.html)
- Removed Admin Support as a service entirely
- Added Legal Assistants ($8.50/hr) as the new 2nd service
- Reordered: Legal Intake → Legal Assistants → Demand Writing → Case Managers
- Updated Case Managers to $12/hr
- Updated all starting-price copy from $6.50 → $7.50
- Rewrote all service descriptions to accurately reflect each role's responsibilities
- Mobile comparison section: replaced scrollable table with stacked cards (all content visible)
- Mobile services: pillar cards now open an inline modal overlay instead of expanding below
- Founders section: cards hidden by default, reveal arrow added below heading
- All connected sections kept in sync: pillar cards, service tabs, panels, pricing cards, comparison table (desktop + mobile), footer services list, booking modal dropdown, JS mobile data array

### Session 2 (landing pages)
- Created `landing-intake.html` — Legal Intake ad landing page
- Created `landing-assistants.html` — Legal Assistants ad landing page
- Created `landing-demand.html` — Demand Writing ad landing page
- Created `landing-case-managers.html` — Case Managers ad landing page
- All 4 pages: same structure, same EmailJS/Calendly integrations, service pre-filled in modal, GA conversion tracking per page

### Session 3 (careers page)
- Created `careers.html` — standalone careers page, globally open (not DR-only)
- 7 open roles: Legal Intake Specialist, Legal Assistant, Demand Writer, Case Manager, Social Media Manager, Web Designer, Marketing Specialist
- Application modal: pre-fills role from card clicked, collects name/email/phone/country/languages/experience/LinkedIn/message
- EmailJS: separate account — service `service_e0rf9ot`, public key `3eYVQFnWUlAnJ1Ah0`
  - `template_5q01i8v` — application notification to YVA
  - `template_2mbtvvn` — auto-reply confirmation to applicant
- GA events: `open_application` and `application_submitted` with `event_category: careers`
- Added "Careers" link to `index.html`: desktop nav, mobile drawer, and footer quick links

---

## Growth Roadmap

### High Priority
- [x] ROI Calculator — interactive savings calculator on index.html (session 6)
- [x] FAQ schema markup — FAQPage JSON-LD added (session 7)
- [x] Lead magnet — Legal Staffing Checklist with email capture (session 7)
- [x] Practice area landing pages — PI, Employment Law, Workers Comp (session 7)
- [x] Spanish/English language toggle — full site translated (session 7)
- [ ] **WhatsApp floating button** — 30 min of work, high conversion for bilingual market
- [ ] **Client logos bar** — FoodNet PR, Top Law Assist, Halavi Law above the fold
- [ ] **Live chat** — Tidio free tier, catches visitors before they leave

### Medium Priority
- [ ] **Growth Services section** — Social Media, Web Design, Marketing for law firms (roles on careers page but not marketed to clients on main site)
- [ ] **"Try 1 week" pilot offer** — lowers barrier to yes for cold traffic
- [ ] Exit intent email capture popup

### Low Priority / Future
- [ ] Video — 60-sec founder or explainer video (highest trust signal)
- [ ] Case studies — detailed client stories with results
- [ ] Pricing toggle (part-time vs full-time hours)
- [ ] Real photos of team / founders (currently pravatar.cc placeholders)
- [ ] Social media links: fields exist in /admin → Website Content → Contact & Hours; icons appear in the home footer once filled in
- [ ] Connect landing pages to Google/Meta ad campaigns
- [ ] A/B test landing page headlines once campaigns are live

### Session 4 (blog system)
- Set up GitHub repo at https://github.com/YVALaw/YVALaw and connected to Netlify
- Created `blog.html` — public blog listing page, fetches posts/index.json dynamically
- Created `blog-post.html` — individual post renderer using marked.js for markdown
- Created `admin/index.html` + `admin/config.yml` — Decap CMS admin panel at /admin
- Created `build.js` — runs on every Netlify deploy, generates posts/index.json from markdown files
- Created `netlify.toml` — sets build command to `node build.js`, publish dir `.`
- Added Blog link to main nav (desktop + mobile) and footer in index.html
- Blog uses Netlify Identity + Git Gateway for CMS authentication
- Writing workflow: /admin → write post → publish → Netlify auto-deploys in ~1 min

### Session 5 (SEO + blog content)
- Added JSON-LD structured data to `index.html`: Organization, ProfessionalService (all 4 services with prices), WebSite
- Verify schema at search.google.com/test/rich-results
- Wrote 6 SEO-targeted blog posts with Unsplash featured images:
  - `why-law-firms-need-virtual-staff` — general virtual staffing trend
  - `how-to-hire-a-legal-intake-specialist` — targets "hire legal intake specialist"
  - `real-cost-inhouse-vs-virtual-legal-staff` — cost comparison with table
  - `what-is-demand-writing` — targets "demand writing law firm"
  - `signs-your-firm-needs-a-virtual-case-manager` — targets "virtual case manager"
  - `bilingual-staff-law-firms` — targets "bilingual legal staff" with U.S. market data
