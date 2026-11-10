/**
 * What the website booking forms send to lead-intake (assets/js/lead-send.js callers in index.html and landing-*.html).
 * A lead whose source or service isn't one of these didn't come from one of our forms (a bot posting straight to the
 * function — e.g. the 2026-11-04 "contract review" lead), so lead-intake quietly drops it. A real visitor's lead
 * still reaches YVA by email (EmailJS / Netlify Forms run separately in the browser).
 * Keep in sync with the pages: tests/leadForms.test.ts scans them, and src/utils/leadForms.ts (YVA OS lead panel).
 */
const FORM_SOURCES = [
  'Home page',
  'Legal Intake landing page', 'Legal Assistants landing page', 'Demand Writing landing page', 'Case Managers landing page',
  'PI landing page', 'Employment landing page', "Workers' Comp Landing Page",
  'Checklist pop-up',   // assets/js/exit-offer.js (home, blog, blog posts, service/guide pages)
]
const FORM_SERVICES = [
  'Legal Intake', 'Legal Assistants', 'Demand Writing', 'Case Managers', 'Not sure yet',
  'Legal Assistant', 'Case Manager', 'Workers Comp Firm',
  'Free checklist',
]
const norm = s => String(s || '').trim().toLowerCase()
const isFormSource = s => FORM_SOURCES.some(x => norm(x) === norm(s))
const isFormService = s => FORM_SERVICES.some(x => norm(x) === norm(s))
/** Why a submission doesn't look like one of our forms, or null when it does */
function notFromForm({ source, service }) {
  if (!isFormSource(source)) return `unknown source "${String(source || '').slice(0, 60)}"`
  if (!isFormService(service)) return `unknown service "${String(service || '').slice(0, 60)}"`
  return null
}
module.exports = { FORM_SOURCES, FORM_SERVICES, isFormSource, isFormService, notFromForm }
