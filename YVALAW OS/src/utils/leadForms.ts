/** Same lists as netlify/functions/_lib/leadForms.cjs (tests/leadForms.test.ts checks they match).
 *  Used by the lead panel to warn about leads that didn't come from a website form. */
export const FORM_SOURCES = [
  'Home page',
  'Legal Intake landing page', 'Legal Assistants landing page', 'Demand Writing landing page', 'Case Managers landing page',
  'PI landing page', 'Employment landing page', "Workers' Comp Landing Page",
  'Checklist pop-up',   // assets/js/exit-offer.js (home, blog, blog posts, service/guide pages)
]
export const FORM_SERVICES = [
  'Legal Intake', 'Legal Assistants', 'Demand Writing', 'Case Managers', 'Not sure yet',
  'Legal Assistant', 'Case Manager', 'Workers Comp Firm',
  'Free checklist',
]
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
export const isFormSource = (s: unknown) => FORM_SOURCES.some(x => norm(x) === norm(s))
export const isFormService = (s: unknown) => FORM_SERVICES.some(x => norm(x) === norm(s))

/** Sources staff type themselves or that other parts of YVA OS create (not website forms) */
const STAFF_SOURCES = ['manual', 'import', 'imported', 'referral', 'old crm', 'phone', 'email', 'linkedin', 'whatsapp', 'event']

/** Website leads started arriving in YVA OS on 2026-11-01; older dates are imports from the old CRM (any source) */
const SITE_LEADS_SINCE = '2026-11-01'

/** A warning for a lead that says it came from the website but doesn't match any form, else null.
 *  Leads added by staff (Manual, Imported, Referral…) and imported older leads are never flagged. */
export function leadFormWarning(lead: { source?: string | null; service?: string | null; created_at?: string | null }): string | null {
  if (lead.created_at && lead.created_at.slice(0, 10) < SITE_LEADS_SINCE) return null
  const src = norm(lead.source)
  if (STAFF_SOURCES.some(s => src === s || src.startsWith(`${s} `))) return null
  const fromSite = !src || src === 'website' || isFormSource(lead.source) || src.includes('landing') || src.includes('page')
  if (!fromSite) return null
  if (!isFormSource(lead.source)) return `Source "${lead.source || 'Website'}" isn't sent by any website form`
  if (!isFormService(lead.service)) return `Service "${lead.service || '(none)'}" isn't offered on the website forms`
  return null
}
