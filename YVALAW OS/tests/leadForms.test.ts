// Run: npm test — lead-intake only accepts what the website forms send (netlify/functions/_lib/leadForms.cjs).
// If a page adds a form, a source or a service option, this test fails until the lists are updated.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { FORM_SOURCES, FORM_SERVICES, leadFormWarning } from '../src/utils/leadForms.ts'
const require = createRequire(import.meta.url)
const lib = require('../netlify/functions/_lib/leadForms.cjs')
const SITE = new URL('../../', import.meta.url)
const pages = ['index.html', ...readdirSync(SITE).filter(f => /^landing-.*\.html$/.test(f))]
const unq = (s: string) => s.replace(/\\'/g, "'")

test('YVA OS and the server use the same lists', () => {
  assert.deepEqual(FORM_SOURCES, lib.FORM_SOURCES)
  assert.deepEqual(FORM_SERVICES, lib.FORM_SERVICES)
})

test('every source and service the website forms send is accepted', () => {
  const seenSources = new Set<string>(), seenServices = new Set<string>()
  for (const f of pages) {
    const html = readFileSync(new URL(f, SITE), 'utf8')
    if (!html.includes('yvaSendLead(')) continue
    for (const m of html.matchAll(/source:\s*'((?:\\'|[^'])+)'/g)) seenSources.add(unq(m[1]))
    for (const m of html.matchAll(/<option value="([^"]+)"/g)) seenServices.add(m[1])
    for (const m of html.matchAll(/\bservice:\s*'([^']+)'/g)) seenServices.add(m[1])
    for (const m of html.matchAll(/openCalendly\('([^']+)'\)/g)) seenServices.add(m[1])
  }
  const exit = readFileSync(new URL('assets/js/exit-offer.js', SITE), 'utf8')
  seenSources.add(exit.match(/SOURCE = '([^']+)'/)![1]); seenServices.add(exit.match(/SERVICE = '([^']+)'/)![1])
  assert.ok(seenSources.size >= 9, `found sources: ${[...seenSources]}`)
  for (const s of seenSources) assert.ok(lib.isFormSource(s), `source "${s}" missing from leadForms`)
  for (const s of seenServices) assert.ok(lib.isFormService(s), `service "${s}" missing from leadForms`)
})

test('a direct post with a made-up source or service is dropped', () => {
  assert.equal(lib.notFromForm({ source: 'Home page', service: 'Legal Intake' }), null)
  assert.equal(lib.notFromForm({ source: "workers' comp landing page", service: 'case manager' }), null)
  assert.match(lib.notFromForm({ source: 'Website', service: 'Legal Intake' }), /unknown source/)
  assert.match(lib.notFromForm({ source: undefined, service: 'Legal Intake' }), /unknown source/)
  assert.match(lib.notFromForm({ source: 'Home page', service: 'contract review' }), /unknown service/)
})

test('lead panel warning: only website-looking leads that match no form', () => {
  const d = '2026-11-04T10:00:00Z'
  assert.match(leadFormWarning({ source: 'Website', service: 'contract review', created_at: d })!, /isn't sent by any website form/)
  assert.match(leadFormWarning({ source: 'Home page', service: 'contract review', created_at: d })!, /isn't offered/)
  assert.equal(leadFormWarning({ source: 'Home page', service: 'Legal Intake', created_at: d }), null)
  assert.equal(leadFormWarning({ source: 'Manual', service: 'Anything', created_at: d }), null)
  assert.equal(leadFormWarning({ source: 'Referral', service: '', created_at: d }), null)
  assert.equal(leadFormWarning({ source: 'Imported', service: '', created_at: d }), null)
  assert.equal(leadFormWarning({ source: 'Website', service: 'x', created_at: '2026-06-01T00:00:00Z' }), null, 'old imported leads are not flagged')
})
