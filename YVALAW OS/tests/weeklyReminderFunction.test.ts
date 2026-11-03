// weekly-reminder (scheduled) and weekly-reminder-test (POST) against a fake Supabase + Microsoft Graph
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { FakeBackend } from './helpers/fakeBackend.ts'

const require = createRequire(import.meta.url)
const scheduled = require('../netlify/functions/weekly-reminder.cjs')
const testFn = require('../netlify/functions/weekly-reminder-test.cjs')
const outlook = require('../netlify/functions/_lib/outlook.cjs')

let fb: FakeBackend
let graph: { status: number; body?: unknown }
let sent: { mailbox: string; message: any }[]
const MON_823 = Date.parse('2026-11-02T12:23:00Z')   // Monday 8:23 am in Santo Domingo

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  for (const [k, v] of Object.entries({ MS_TENANT_ID: 't', MS_CLIENT_ID: 'c', MS_CLIENT_SECRET: 's', MS_SENDER_MAILBOX: 'contact@yvastaffing.agency' })) process.env[k] = v
  outlook.__resetForTests()
  fb = new FakeBackend().install()
  graph = { status: 202 }; sent = []
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const u = new URL(String(input))
    if (u.host === 'login.microsoftonline.com') return res(200, { access_token: 'graph-token', expires_in: 3600 })
    if (u.host === 'graph.microsoft.com') {
      sent.push({ mailbox: decodeURIComponent(u.pathname.split('/')[3]), message: JSON.parse(String(init.body)).message })
      return res(graph.status, graph.body)
    }
    return inner(input, init)
  }) as typeof fetch
  fb.db.settings = [{ id: 1, company_name: 'YVA Staffing', business_timezone: 'America/Santo_Domingo', weekly_reminder_enabled: true, weekly_reminder_day: 1, weekly_reminder_hour: 8,
    weekly_reminder_recipients: ['hans@yva.com', 'paola@yva.com'], weekly_reminder_include: null, weekly_reminder_last_sent: '2026-10-26T12:23:00.000Z' }]
  fb.db.user_roles = [{ user_id: 'u-ceo', role: 'ceo', email: 'hans@yva.com' }, { user_id: 'u-adm', role: 'admin', email: 'paola@yva.com' }, { user_id: 'u-acc', role: 'accounting', email: 'acc@yva.com' }]
  fb.db.invoices = [
    { id: 'i1', number: 'HAL-0007', client_name: 'Halavi Law', subtotal: 1200, amount_paid: 0, status: 'draft', date: '2026-11-02' },
    { id: 'i2', number: 'TLA-0002', client_name: 'Top Law', subtotal: 500, amount_paid: 0, status: 'overdue', due_date: '2026-10-28', date: '2026-10-20' },
    { id: 'i3', number: 'TLA-0001', client_name: 'Top Law', subtotal: 300, amount_paid: 300, status: 'paid', date: '2026-09-20' },
  ]
  fb.db.week_closes = [{ id: 'w1', week_start: '2026-10-26', status: 'ready', summary: { invoices: 1, total: 1200, flags: 0 } }]
  fb.users = { 'tok-ceo': { id: 'u-ceo', email: 'hans@yva.com' }, 'tok-adm': { id: 'u-adm', email: 'paola@yva.com' }, 'tok-acc': { id: 'u-acc', email: 'acc@yva.com' } }
})
afterEach(() => fb.restore())

test('scheduled: sends once on the day/hour to the saved recipients, claims the week, then stays quiet', async () => {
  const r = await scheduled.run(MON_823)
  assert.equal(r.sent, true, JSON.stringify(r))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].mailbox, 'contact@yvastaffing.agency')
  assert.deepEqual(sent[0].message.toRecipients.map((x: any) => x.emailAddress.address), ['hans@yva.com', 'paola@yva.com'])
  assert.equal(sent[0].message.subject, 'YVA OS weekly summary — 1 draft, 1 unpaid ($500.00), weekly close to approve')
  assert.equal(sent[0].message.body.contentType, 'HTML')
  assert.match(sent[0].message.body.content, /TLA-0002/)
  assert.ok(!sent[0].message.body.content.includes('TLA-0001'), 'paid invoices never listed')
  assert.equal(fb.db.settings[0].weekly_reminder_last_sent, new Date(MON_823).toISOString())
  // only open invoices were read
  assert.ok(fb.restCalls.some(c => c.method === 'GET' && c.path.startsWith('invoices?') && decodeURIComponent(c.path).includes('status=in.(draft,sent,viewed,overdue,partial)')))
  // next hour, same week: nothing
  const again = await scheduled.run(MON_823 + 3600_000)
  assert.deepEqual(again, { sent: false, reason: 'already sent this week' })
  assert.equal(sent.length, 1)
})

test('scheduled: not the day / too early / off / before the SQL → nothing sent, nothing written', async () => {
  assert.equal((await scheduled.run(MON_823 - 3600_000)).reason, 'not the reminder hour yet')
  assert.equal((await scheduled.run(MON_823 + 86_400_000)).reason, 'not the reminder day')
  fb.db.settings[0].weekly_reminder_enabled = false
  assert.equal((await scheduled.run(MON_823)).reason, 'turned off')
  fb.db.settings = [{ id: 1, company_name: 'YVA Staffing' }]
  assert.match((await scheduled.run(MON_823)).reason, /migrate-weekly-reminder/)
  assert.equal(sent.length, 0)
  assert.ok(!fb.restCalls.some(c => c.method === 'PATCH'))
})

test('scheduled: no recipients saved → every CEO login; a run that lost the claim race sends nothing', async () => {
  fb.db.settings[0].weekly_reminder_recipients = null
  fb.db.settings[0].weekly_reminder_include = ['drafts']
  const r = await scheduled.run(MON_823)
  assert.equal(r.sent, true)
  assert.deepEqual(sent[0].message.toRecipients.map((x: any) => x.emailAddress.address), ['hans@yva.com'])
  assert.ok(!sent[0].message.body.content.includes('Top Law'), 'only the chosen sections')
  assert.ok(!fb.restCalls.some(c => c.path.startsWith('week_closes')), 'weekly close not read when not chosen')
  // Someone else claimed the week between our read and our claim
  fb.db.settings[0].weekly_reminder_last_sent = '2026-10-26T12:23:00.000Z'
  const orig = fb.db.settings[0]
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if ((init.method || 'GET') === 'PATCH') orig.weekly_reminder_last_sent = '2026-11-02T12:23:01.000Z'
    return realFetch(input, init)
  }) as typeof fetch
  const lost = await scheduled.run(MON_823)
  assert.deepEqual(lost, { sent: false, reason: 'already sent this week' })
  assert.equal(sent.length, 1)
})

test('scheduled: Microsoft refuses → logged, week given back so the next hour retries; handler never throws', async () => {
  graph = { status: 500, body: { error: { code: 'ErrorInternalServerError', message: 'busy' } } }
  // the handler uses the real clock: make "now" the reminder day and hour
  const M = require('../netlify/functions/_lib/money.cjs')
  const now = M.localParts(Date.now(), 'America/Santo_Domingo')
  Object.assign(fb.db.settings[0], { weekly_reminder_day: now.weekday, weekly_reminder_hour: now.hour, weekly_reminder_last_sent: '2026-01-05T12:00:00.000Z' })
  const r = await scheduled.handler({})
  assert.equal(r.statusCode, 200)
  assert.equal(JSON.parse(r.body).sent, false)
  assert.match(JSON.parse(r.body).error, /Microsoft rejected/)
  assert.equal(fb.db.settings[0].weekly_reminder_last_sent, '2026-01-05T12:00:00.000Z', 'claim released')
  // Supabase down entirely: still a clean 200 with the reason
  fb.restore()
  globalThis.fetch = (async () => { throw new Error('network down') }) as typeof fetch
  const down = await scheduled.handler({})
  assert.equal(down.statusCode, 200)
  assert.match(JSON.parse(down.body).error, /network down/)
})

test('scheduled: weekly close not set up (no table) → that section is simply left out', async () => {
  delete fb.db.week_closes
  const r = await scheduled.run(MON_823)
  assert.equal(r.sent, true)
  assert.ok(!/close/i.test(sent[0].message.subject))
  assert.ok(!/Weekly close/.test(sent[0].message.body.content))
})

const ev = (token: string | null, body: unknown = {}, method = 'POST') => ({ httpMethod: method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) })
const call = async (token: string | null, body?: unknown) => { const r = await testFn.handler(ev(token, body)); return { status: r.statusCode, body: JSON.parse(r.body) } }

test('test send: CEO/Admin only, goes to the caller only, marked [Test], never touches last_sent', async () => {
  assert.equal((await call(null)).status, 401)
  assert.equal((await call('tok-bad')).status, 401)
  const acc = await call('tok-acc')
  assert.equal(acc.status, 403)
  assert.equal((await testFn.handler(ev('tok-ceo', {}, 'GET'))).statusCode, 405)
  assert.equal(sent.length, 0)
  const before = fb.db.settings[0].weekly_reminder_last_sent
  const r = await call('tok-adm', { include: ['unpaid', 'bogus'] })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.to, 'paola@yva.com')
  assert.deepEqual(sent[0].message.toRecipients.map((x: any) => x.emailAddress.address), ['paola@yva.com'])
  assert.match(sent[0].message.subject, /^\[Test\] YVA OS weekly summary — 1 unpaid/)
  assert.ok(!sent[0].message.body.content.includes('HAL-0007'), 'only the ticked sections')
  assert.equal(fb.db.settings[0].weekly_reminder_last_sent, before)
  // Works even when the reminder is off and before the SQL runs (saved sections → all)
  fb.db.settings = [{ id: 1, company_name: 'YVA Staffing' }]
  const ceo = await call('tok-ceo')
  assert.equal(ceo.status, 200)
  assert.match(sent[1].message.body.content, /HAL-0007/)
})

test('test send: Outlook not set up → 503 notSetUp; Microsoft refusal → 502', async () => {
  delete process.env.MS_CLIENT_SECRET
  const a = await call('tok-ceo')
  assert.equal(a.status, 503); assert.equal(a.body.notSetUp, true); assert.match(a.body.error, /MS_CLIENT_SECRET/)
  process.env.MS_CLIENT_SECRET = 's'
  graph = { status: 400, body: { error: { code: 'ErrorInvalidRecipients', message: 'bad' } } }
  const b = await call('tok-ceo')
  assert.equal(b.status, 502); assert.match(b.body.error, /Microsoft rejected/)
})
