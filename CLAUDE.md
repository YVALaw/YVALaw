# YVA Law Staffing — legalWebs Project

## Project Overview
Single-page website for **YVA Law Staffing** (yvastaffing.agency).
Single file: `index.html` (~3100 lines). No build system — pure HTML, Tailwind CDN, Lucide icons, EmailJS, Calendly.

**Standalone pages:**
- `landing-intake.html` — Legal Intake ad landing page ($7.50/hr)
- `landing-assistants.html` — Legal Assistants ad landing page ($8.50/hr)
- `landing-demand.html` — Demand Writing ad landing page ($10/hr)
- `landing-case-managers.html` — Case Managers ad landing page ($12/hr)
- `landing-pi.html` — Personal Injury practice area landing page (GA: `landing_pi`)
- `landing-employment.html` — Employment Law practice area landing page (GA: `landing_employment`)
- `landing-workers-comp.html` — Workers' Comp practice area landing page (GA: `landing_workers_comp`)
- `checklist.html` — Lead magnet: printable Legal Staffing Checklist (10 Q&A sections, print button)
- `careers.html` — Careers page (7 open roles, application modal, separate EmailJS account)
- `blog.html` — Blog listing page (fetches posts/index.json dynamically)
- `blog-post.html` — Individual post renderer (marked.js markdown)

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
- Clicking a pillar card opens `#mobile-service-modal` (fixed overlay).
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

### Sticky CTA Bar (`#sticky-cta`)
- Fixed bottom bar, appears after scrolling 600px.
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

## Integrations
- **Google Analytics:** `G-V2Q6V4HE4F`
- **EmailJS:** Public key `Vsnmntfk0c8ChKXVL`
- **Calendly:** `contact-yvastaffing-vuu8/new-meeting`

---

## Things Completed

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
- [ ] Social media links (footer currently href="#" placeholders)
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
