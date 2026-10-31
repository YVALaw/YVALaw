// The browser (src/utils/moneyRules.ts) and the server (netlify/functions/_lib/money.cjs) must agree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as web from '../src/utils/moneyRules.ts'
const server = createRequire(import.meta.url)('../netlify/functions/_lib/money.cjs')

const ana = { id: 'e1', pay_rate: 5, role: 'Intake Specialist', premium_enabled: true, premium_percent: 15, premium_start_time: '9:00 pm', timezone: null }
const ben = { id: 'e2', pay_rate: '', role: null, premium_enabled: false, premium_percent: null, premium_start_time: null, timezone: null }
const p1 = { id: 'p1', rate: 12, client_id: 'c1' }, p2 = { id: 'p2', rate: null, client_id: 'c2' }, p3 = { id: 'p3', rate: '', client_id: 'c3' }
const clients = { c1: { id: 'c1', default_rate: 11 }, c2: { id: 'c2', default_rate: '14,5' }, c3: { id: 'c3', default_rate: null } }
const rates = [
  { employee_id: 'e1', project_id: 'p1', position: 'Senior intake', bill_rate: 13, pay_rate: 6, effective_from: '2026-10-01' },
  { employee_id: 'e1', project_id: 'p1', position: null, bill_rate: 14, pay_rate: null, effective_from: '2026-11-01' },
  { employee_id: 'e1', project_id: null, position: null, bill_rate: null, pay_rate: 5.5, effective_from: '2026-09-01' },
  { employee_id: 'e2', project_id: 'p3', position: null, bill_rate: null, pay_rate: 4, effective_from: '2026-12-01' },
]

const rateCases = [
  ['e1', 'p1', '2026-09-15'], ['e1', 'p1', '2026-10-15'], ['e1', 'p1', '2026-11-02'], ['e1', 'p2', '2026-10-15'],
  ['e1', null, '2026-08-01'], ['e1', null, '2026-10-01'], ['e2', 'p3', '2026-11-01'], ['e2', 'p3', '2026-12-01'], ['e2', 'p2', '2026-10-01'],
] as const

test('rate chains: browser and server agree, and they never cross', () => {
  for (const [e, p, day] of rateCases) {
    const args = { employee: e === 'e1' ? ana : ben, project: p ? { p1, p2, p3 }[p] : null, client: p ? clients[({ p1, p2, p3 }[p]).client_id as keyof typeof clients] : null, rates, day }
    assert.deepEqual(web.resolveRates(args), server.resolveRates(args), `${e} ${p} ${day}`)
  }
  const r = web.resolveRates({ employee: ana, project: p1, client: clients.c1, rates, day: '2026-09-15' })
  assert.deepEqual([r.bill, r.pay], [{ rate: 12, source: 'project' }, { rate: 5.5, source: 'employee-dated', from: '2026-09-01' }])
  const r2 = web.resolveRates({ employee: ana, project: p1, client: clients.c1, rates, day: '2026-11-02' })
  assert.equal(r2.bill.rate, 14); assert.equal(r2.pay.rate, 6); assert.equal(r2.position, 'Senior intake')   // newer row only changed the bill rate
  const r3 = web.resolveRates({ employee: ben, project: p3, client: clients.c3, rates, day: '2026-11-01' })
  assert.deepEqual([r3.bill.source, r3.pay.source], ['none', 'none'])          // never falls back to the other chain
  assert.equal(web.resolveRates({ employee: ben, project: p2, client: clients.c2, rates, day: '2026-10-01' }).bill.rate, 14.5)
})

test('pay periods + payday (Friday after): browser and server agree', () => {
  const days = ['2026-10-26', '2026-11-01', '2026-11-02', '2026-10-15', '2026-10-16', '2026-10-31', '2026-02-28', '2026-12-31', '2027-01-01']
  for (const d of days) for (const s of ['weekly', 'biweekly', 'semimonthly', 'monthly']) {
    assert.deepEqual(web.payPeriod(d, s, '2026-10-19'), server.payPeriod(d, s, '2026-10-19'), `${d} ${s}`)
  }
  assert.deepEqual(web.payPeriod('2026-10-29', 'weekly'), { schedule: 'weekly', start: '2026-10-26', end: '2026-11-01', payday: '2026-11-06' })
  assert.deepEqual(web.payPeriod('2026-10-15', 'semimonthly'), { schedule: 'semimonthly', start: '2026-10-01', end: '2026-10-15', payday: '2026-10-16' })
  assert.equal(web.payPeriod('2026-11-20', 'semimonthly').end, '2026-11-30')
  assert.equal(web.payPeriod('2026-02-20', 'semimonthly').end, '2026-02-28')
  const bw = web.payPeriod('2026-11-05', 'biweekly', '2026-10-19')
  assert.deepEqual([bw.start, bw.end, bw.payday], ['2026-11-02', '2026-11-15', '2026-11-20'])
  // a period ending on a Friday is paid the next Friday
  assert.equal(web.payPeriod('2027-01-15', 'semimonthly').payday, '2027-01-22')
})

test('night premium split and money: browser and server agree', () => {
  const blocks = [
    { block_start: '2026-10-28T13:00:00Z', seconds: 600, first_offset: 0, last_offset: 599, project_id: 'p1', status: 'tracked' },   // 9:00 am DR
    { block_start: '2026-10-29T00:55:00Z', seconds: 600, first_offset: 0, last_offset: 599, project_id: 'p1', status: 'approved' },  // 8:55 pm: half premium
    { block_start: '2026-10-29T01:30:00Z', seconds: 300, first_offset: 100, last_offset: 399, project_id: 'p1', status: 'tracked' }, // 9:30 pm: all premium
    { block_start: '2026-10-29T14:00:00Z', seconds: 600, first_offset: null, last_offset: null, project_id: null, status: 'approved' },  // YVA work, no offsets
    { block_start: '2026-10-29T15:00:00Z', seconds: 600, first_offset: 0, last_offset: 599, project_id: 'p1', status: 'removed' },
  ]
  const ctx = { blocks, employee: ana, projectsById: { p1, p2, p3 }, clientsById: clients, rates }
  for (const kind of ['pay', 'bill'] as const) assert.deepEqual(JSON.parse(JSON.stringify(web.blocksMoney({ ...ctx, kind }))), JSON.parse(JSON.stringify(server.blocksMoney({ ...ctx, kind }))))
  const pay = web.blocksMoney({ ...ctx, kind: 'pay' })
  assert.equal(pay.seconds, 2100); assert.equal(pay.premiumSeconds, 600)
  // p1 pay 6/h: 1500 s of which 600 premium (+15%) → (900/3600)*6 + (600/3600)*6.9 = 1.5 + 1.15 ; YVA 600 s at 5.5 → 0.9167
  assert.equal(pay.amount, Math.round((1.5 + 1.15 + 600 / 3600 * 5.5) * 100) / 100)
  const bill = web.blocksMoney({ ...ctx, kind: 'bill' })
  assert.equal(bill.seconds, 1500)                                   // YVA-team work types are never billed
  assert.equal(bill.amount, Math.round(((900 / 3600) * 13 + (600 / 3600) * 13 * 1.15) * 100) / 100)
  assert.equal(web.premiumSeconds(blocks[1], { ...ana, premium_enabled: false }), 0)
})

test('zoned midnight (DR has no DST; New York does)', () => {
  assert.equal(new Date(web.zonedMidnight('2026-11-02')).toISOString(), '2026-11-02T04:00:00.000Z')
  assert.equal(new Date(web.zonedMidnight('2026-11-02', 'America/New_York')).toISOString(), '2026-11-02T05:00:00.000Z')
  assert.equal(web.zonedMidnight('2026-03-09', 'America/New_York'), server.zonedMidnight('2026-03-09', 'America/New_York'))
})

test('free-text time zones never break the maths (fall back to the business zone)', () => {
  for (const tz of ['AST / EST', 'America/New_York', '', null]) {
    assert.equal(web.safeTz(tz), server.safeTz(tz))
  }
  assert.equal(web.safeTz('AST / EST'), 'America/Santo_Domingo')
  const block = { block_start: '2026-10-29T01:30:00Z', seconds: 600, first_offset: 0, last_offset: 599, project_id: 'p1', status: 'approved' }
  const bad = { ...ana, timezone: 'AST / EST' }
  assert.equal(web.premiumSeconds(block, bad), server.premiumSeconds(block, bad))
  assert.equal(web.premiumSeconds(block, bad), 600)                       // 9:30 pm DR
})

test('removing time comes off regular time first, then premium, never below zero', () => {
  const day = [
    { block_start: '2026-10-28T23:00:00Z', seconds: 600, first_offset: 0, last_offset: 599, project_id: 'p1', status: 'approved' },  // 7:00 pm regular
    { block_start: '2026-10-29T01:30:00Z', seconds: 600, first_offset: 0, last_offset: 599, project_id: 'p1', status: 'approved' },  // 9:30 pm premium
    { block_start: '2026-10-28T16:00:00Z', seconds: -900, first_offset: null, last_offset: null, project_id: 'p1', status: 'approved' }, // YVA removes 15 min
  ]
  const ctx = { blocks: day, employee: ana, projectsById: { p1, p2, p3 }, clientsById: clients, rates, kind: 'pay' as const }
  const w = web.blocksMoney(ctx), s = server.blocksMoney(ctx)
  assert.deepEqual(JSON.parse(JSON.stringify(w)), JSON.parse(JSON.stringify(s)))
  assert.equal(w.seconds, 300); assert.equal(w.premiumSeconds, 300)          // 10 min regular gone, then 5 of premium
  assert.equal(w.amount, Math.round(((300 / 3600) * 6 * 1.15 + Number.EPSILON) * 100) / 100)   // 0.575 → 0.58
  const tooMuch = web.blocksMoney({ ...ctx, blocks: [day[0], { ...day[2], seconds: -5000 }] })
  assert.equal(tooMuch.seconds, 0); assert.equal(tooMuch.amount, 0)
})
