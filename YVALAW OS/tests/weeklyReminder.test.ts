// Weekly reminder email: pure rules (is it due? which week? what does the email say?) from netlify/functions/_lib/weeklyReminder.cjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { nextReminder } from '../src/utils/reminderSchedule.ts'

const require = createRequire(import.meta.url)
const R = require('../netlify/functions/_lib/weeklyReminder.cjs')
const DR = 'America/Santo_Domingo'   // UTC−4 all year
const NY = 'America/New_York'        // has daylight saving time
const at = (iso: string) => Date.parse(iso)
const cfg = (over: object = {}) => ({ ...R.normalizeConfig({ weekly_reminder_enabled: true, weekly_reminder_day: 1, weekly_reminder_hour: 8 }), ...over })

test('config: defaults when the columns are empty; not ready before the SQL runs', () => {
  const before = R.normalizeConfig({ id: 1, company_name: 'YVA' })
  assert.equal(before.ready, false)
  assert.equal(before.enabled, false)
  const empty = R.normalizeConfig({ weekly_reminder_enabled: null, weekly_reminder_day: null, weekly_reminder_hour: null, weekly_reminder_recipients: null, weekly_reminder_include: null })
  assert.deepEqual({ ready: empty.ready, enabled: empty.enabled, day: empty.day, hour: empty.hour, recipients: empty.recipients, include: empty.include },
    { ready: true, enabled: false, day: 1, hour: 8, recipients: [], include: ['drafts', 'unpaid', 'weekly_close'] })
  const odd = R.normalizeConfig({ weekly_reminder_enabled: true, weekly_reminder_day: 9, weekly_reminder_hour: '25', weekly_reminder_recipients: ['A@x.com', 'a@x.com', 'nope', ' b@y.co '], weekly_reminder_include: ['unpaid', 'payroll'] })
  assert.equal(odd.day, 1); assert.equal(odd.hour, 8)
  assert.deepEqual(odd.recipients, ['A@x.com', 'b@y.co'])
  assert.deepEqual(odd.include, ['unpaid'])
  assert.equal(R.normalizeConfig({ weekly_reminder_enabled: true, weekly_reminder_day: 0, weekly_reminder_hour: 0 }).day, 0)
  assert.equal(R.cleanEmails(Array.from({ length: 14 }, (_, i) => `p${i}@x.com`)).length, 10)
})

test('week key: the Monday of the week on the business clock (Sunday night in DR is still last week)', () => {
  assert.equal(R.weekKey(at('2026-11-02T12:00:00Z'), DR), '2026-11-02')   // Monday 8 am
  assert.equal(R.weekKey(at('2026-11-09T03:30:00Z'), DR), '2026-11-02')   // Sunday 11:30 pm DR (Monday in UTC)
  assert.equal(R.weekKey(at('2026-11-09T04:00:00Z'), DR), '2026-11-09')   // Monday midnight DR
  assert.equal(R.weekKey(at('2026-11-09T04:00:00Z'), 'Not/AZone'), '2026-11-09')   // bad zone → business default
})

test('due on the chosen weekday from the chosen hour, once per week (Santo Domingo)', () => {
  const c = cfg()
  assert.deepEqual(R.isDue(c, at('2026-11-02T12:23:00Z'), DR), { due: true, reason: 'due', weekKey: '2026-11-02' })   // Mon 8:23 am
  assert.equal(R.isDue(c, at('2026-11-02T11:23:00Z'), DR).reason, 'not the reminder hour yet')                        // Mon 7:23 am
  assert.equal(R.isDue(c, at('2026-11-02T18:23:00Z'), DR).due, true)                                                  // later that Monday: catch-up
  assert.equal(R.isDue(c, at('2026-11-03T12:23:00Z'), DR).reason, 'not the reminder day')                             // Tuesday
  assert.equal(R.isDue(c, at('2026-11-03T03:23:00Z'), DR).due, true)                                                  // Mon 11:23 pm DR = Tue UTC
  assert.equal(R.isDue({ ...c, lastSent: '2026-11-02T12:23:05Z' }, at('2026-11-02T13:23:00Z'), DR).reason, 'already sent this week')
  assert.equal(R.isDue({ ...c, lastSent: '2026-10-26T12:23:05Z' }, at('2026-11-02T12:23:00Z'), DR).due, true)       // last week's
  assert.equal(R.isDue({ ...c, enabled: false }, at('2026-11-02T12:23:00Z'), DR).reason, 'turned off')
  assert.match(R.isDue(R.normalizeConfig({}), at('2026-11-02T12:23:00Z'), DR).reason, /migrate-weekly-reminder/)
  // Sunday reminder at 9 pm: Sunday is the last day of the Monday-start week
  const sun = cfg({ day: 0, hour: 21 })
  assert.equal(R.isDue(sun, at('2026-11-09T01:23:00Z'), DR).due, true)                                                // Sun Nov 8, 9:23 pm DR
  assert.equal(R.isDue({ ...sun, lastSent: '2026-11-09T01:23:00Z' }, at('2026-11-09T02:23:00Z'), DR).due, false)
  assert.equal(R.isDue({ ...sun, lastSent: '2026-11-09T01:23:00Z' }, at('2026-11-16T01:23:00Z'), DR).due, true)     // next Sunday
})

test('daylight saving (New York): the hour follows the local clock and a repeated hour sends once', () => {
  const c = cfg({ day: 1, hour: 8 })
  // Before the switch (EST, UTC−5) and after it (EDT, UTC−4): 8 am local is a different UTC hour
  assert.equal(R.isDue(c, at('2026-03-02T13:23:00Z'), NY).due, true)    // Mon Mar 2, 8:23 EST
  assert.equal(R.isDue(c, at('2026-03-09T12:23:00Z'), NY).due, true)    // Mon Mar 9, 8:23 EDT
  assert.equal(R.isDue(c, at('2026-03-09T11:23:00Z'), NY).due, false)   // 7:23 EDT
  // Sunday Nov 1 2026: 1 am happens twice. Both are the same week; after the first send the second is refused.
  const s = cfg({ day: 0, hour: 1 })
  assert.equal(R.weekKey(at('2026-11-01T05:23:00Z'), NY), '2026-10-26')
  assert.equal(R.weekKey(at('2026-11-01T06:23:00Z'), NY), '2026-10-26')
  assert.equal(R.isDue(s, at('2026-11-01T05:23:00Z'), NY).due, true)    // 1:23 EDT
  assert.equal(R.isDue({ ...s, lastSent: '2026-11-01T05:23:00Z' }, at('2026-11-01T06:23:00Z'), NY).reason, 'already sent this week')   // 1:23 EST
  // Spring forward Sunday Mar 8: 2 am doesn't exist — a 2 am reminder goes at 3:23 EDT that day
  const g = cfg({ day: 0, hour: 2 })
  assert.equal(R.isDue(g, at('2026-03-08T06:23:00Z'), NY).due, false)   // 1:23 EST
  assert.equal(R.isDue(g, at('2026-03-08T07:23:00Z'), NY).due, true)    // 3:23 EDT
})

const invoices = [
  { number: 'HAL-0007', client_name: 'Halavi Law', subtotal: 1200, amount_paid: 0, status: 'draft', date: '2026-11-02' },
  { number: 'FNP-0003', client_name: 'FoodNet <PR>', subtotal: 800, amount_paid: 0, status: 'draft', date: '2026-11-02' },
  { number: 'HAL-0006', client_name: 'Halavi Law', subtotal: 1000, amount_paid: 400, status: 'partial', due_date: '2026-11-10', date: '2026-10-27' },
  { number: 'TLA-0002', client_name: 'Top Law', subtotal: 500, amount_paid: 0, status: 'sent', due_date: '2026-10-28', date: '2026-10-20' },
  { number: 'TLA-0001', client_name: 'Top Law', subtotal: 300, amount_paid: 300, status: 'sent', due_date: '2026-10-01', date: '2026-09-20' },   // fully paid → skipped
]

test('email: drafts, unpaid with balance (overdue first), weekly close; plain subject; escaped HTML', () => {
  const m = R.buildReminder({ invoices, close: { status: 'ready', summary: { invoices: 4, total: 5200.5, flags: 2 } }, today: '2026-11-03', lastWeek: '2026-10-26', appUrl: 'https://yvastaffing.agency/os/' })
  assert.deepEqual(m.counts, { drafts: 2, unpaid: 2, overdue: 1, owed: 1100, weeklyClose: 'ready' })
  assert.equal(m.subject, 'YVA OS weekly summary — 2 drafts, 2 unpaid ($1,100.00), weekly close to approve')
  assert.match(m.text, /2 INVOICES STILL IN DRAFT \(\$2,000\.00\)/)
  assert.match(m.text, /2 UNPAID INVOICES · \$1,100\.00 OWED · 1 OVERDUE \(\$500\.00\)/)
  const lines = m.text.split('\n')
  const tla = lines.findIndex((l: string) => l.includes('TLA-0002')), hal = lines.findIndex((l: string) => l.includes('HAL-0006'))
  assert.ok(tla > 0 && tla < hal, 'overdue invoice listed first')
  assert.match(lines[tla], /OVERDUE · TLA-0002 · Top Law · \$500\.00 owed · due Oct 28 \(6 days late\)/)
  assert.match(lines[hal], /HAL-0006 · Halavi Law · \$600\.00 owed · due Nov 10$/)
  assert.ok(!m.text.includes('TLA-0001'))
  assert.match(m.text, /LAST WEEK'S CLOSE \(OCT 26 – NOV 1\) IS WAITING FOR APPROVAL/)
  assert.match(m.text, /4 invoices · \$5,200\.50 · 2 things to check/)
  assert.match(m.text, /Open Weekly close: https:\/\/yvastaffing\.agency\/os\/weekly-close/)
  assert.match(m.text, /Review drafts: https:\/\/yvastaffing\.agency\/os\/invoice/)
  assert.ok(m.html.includes('FoodNet &lt;PR&gt;') && !m.html.includes('FoodNet <PR>'))
  assert.ok(m.html.includes('href="https://yvastaffing.agency/os/"'))
})

test('email: only the chosen sections; weekly close left out when not set up; approved / not prepared; test + all clear', () => {
  const onlyUnpaid = R.buildReminder({ include: ['unpaid'], invoices, close: { status: 'approved' }, today: '2026-11-03', lastWeek: '2026-10-26' })
  assert.ok(!/DRAFT|CLOSE/.test(onlyUnpaid.text))
  assert.equal(onlyUnpaid.counts.drafts, undefined)
  const noClose = R.buildReminder({ invoices: [], close: undefined, today: '2026-11-03', lastWeek: '2026-10-26' })
  assert.ok(!/CLOSE/.test(noClose.text))
  assert.match(noClose.text, /NO INVOICES WAITING IN DRAFT/)
  assert.match(noClose.text, /NO UNPAID INVOICES/)
  assert.equal(noClose.subject, 'YVA OS weekly summary — all clear')
  const approved = R.buildReminder({ include: ['weekly_close'], close: { status: 'approved' }, today: '2026-11-03', lastWeek: '2026-10-26' })
  assert.match(approved.text, /IS APPROVED/)
  assert.ok(!approved.text.includes('Open Weekly close'))
  assert.equal(approved.subject, 'YVA OS weekly summary — all clear')
  const missing = R.buildReminder({ include: ['weekly_close'], close: null, today: '2026-11-03', lastWeek: '2026-10-26', test: true })
  assert.match(missing.text, /HASN'T BEEN PREPARED YET/)
  assert.equal(missing.subject, '[Test] YVA OS weekly summary — weekly close to approve')
  assert.match(missing.text, /This is a test/)
  const nothing = R.buildReminder({ include: [], today: '2026-11-03' })
  assert.match(nothing.text, /Nothing is selected/)
  // Long lists are cut at 10 lines with "…and N more"
  const many = Array.from({ length: 13 }, (_, i) => ({ number: `D-${i}`, client_name: 'X', subtotal: 1, status: 'draft' }))
  const cut = R.buildReminder({ include: ['drafts'], invoices: many, today: '2026-11-03' })
  assert.equal(cut.text.split('\n').filter((l: string) => l.includes('D-')).length, 10)
  assert.match(cut.text, /…and 3 more/)
})

test('Settings "next email" (browser) agrees with the scheduled function (server), hour by hour over two weeks, both zones', () => {
  for (const tz of [DR, NY]) {
    for (const [day, hour, lastSent] of [[1, 8, null], [0, 21, '2026-11-01T12:00:00Z'], [5, 0, '2026-11-06T05:00:00Z'], [3, 23, null]] as [number, number, string | null][]) {
      const c = { ...cfg({ day, hour }), lastSent }
      for (let t = Date.parse('2026-11-01T00:23:00Z'); t < Date.parse('2026-11-15T00:00:00Z'); t += 3600_000) {
        const server = R.isDue(c, t, tz).due
        const browser = nextReminder({ day, hour, lastSent }, t, tz)
        assert.equal(browser.catchUp, server, `${tz} day ${day} hour ${hour} at ${new Date(t).toISOString()}`)
        if (!server) assert.ok(browser.date >= R.weekKey(t, tz))
      }
    }
  }
  // Concrete cases: Tuesday Nov 3 → next Monday Nov 9 at 8; already sent this Monday → Nov 9; Monday before 8 → today
  assert.deepEqual(nextReminder({ day: 1, hour: 8 }, Date.parse('2026-11-03T15:00:00Z'), DR), { date: '2026-11-09', hour: 8, catchUp: false })
  assert.deepEqual(nextReminder({ day: 1, hour: 8, lastSent: '2026-11-02T12:23:00Z' }, Date.parse('2026-11-02T13:00:00Z'), DR), { date: '2026-11-09', hour: 8, catchUp: false })
  assert.deepEqual(nextReminder({ day: 1, hour: 8 }, Date.parse('2026-11-02T11:00:00Z'), DR), { date: '2026-11-02', hour: 8, catchUp: false })
})
