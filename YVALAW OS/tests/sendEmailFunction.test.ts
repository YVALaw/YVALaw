// The send-email / email-status Netlify functions against a fake Supabase + Microsoft (global fetch replaced)
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
process.env.SUPABASE_URL = 'https://db.example.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
const sendFn = require('../netlify/functions/send-email.cjs')
const statusFn = require('../netlify/functions/email-status.cjs')
const outlook = require('../netlify/functions/_lib/outlook.cjs')
const { dispatchPending } = require('../netlify/functions/_lib/notify.cjs')

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined }
type World = {
  users: Record<string, { id: string; email: string }>
  roles: Record<string, string>
  log: Record<string, unknown>[]
  logTableMissing: boolean
  tokenCalls: number
  tokenFails: null | { status: number; body: unknown }
  graph: { status: number; body?: unknown }
  sent: { url: string; auth: string; body: any }[]
  calls: Call[]
  notifications?: any[]
}
let w: World

function setEnv(on = true) {
  for (const [k, v] of Object.entries({ MS_TENANT_ID: 'tenant-1', MS_CLIENT_ID: 'app-1', MS_CLIENT_SECRET: 's3cret', MS_SENDER_MAILBOX: 'contact@yvastaffing.agency' })) {
    if (on) process.env[k] = v; else delete process.env[k]
  }
}

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  w = {
    users: { 'tok-ceo': { id: 'u-ceo', email: 'hans@yva.com' }, 'tok-emp': { id: 'u-emp', email: 'ana@yva.com' }, 'tok-rec': { id: 'u-rec', email: 'rec@yva.com' } },
    roles: { 'u-ceo': 'ceo', 'u-emp': 'employee', 'u-rec': 'recruiter' },
    log: [], logTableMissing: false, tokenCalls: 0, tokenFails: null, graph: { status: 202 }, sent: [], calls: [],
  }
  setEnv(true)
  outlook.__resetForTests()
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input)
    const headers = Object.fromEntries(new Headers(init.headers).entries())
    const method = (init.method || 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : undefined
    w.calls.push({ url, method, headers, body })
    const u = new URL(url)
    if (u.host === 'db.example.co') {
      if (u.pathname === '/auth/v1/user') {
        const user = w.users[(headers.authorization || '').replace('Bearer ', '')]
        return user ? res(200, user) : res(401, { msg: 'bad jwt' })
      }
      if (u.pathname.startsWith('/auth/v1/admin/users/')) return res(200, { id: u.pathname.split('/').pop(), email: 'person@yva.com' })
      if (u.pathname === '/rest/v1/user_roles') {
        const id = (u.searchParams.get('user_id') || '').replace('eq.', '')
        return res(200, w.roles[id] ? [{ role: w.roles[id] }] : [])
      }
      if (u.pathname === '/rest/v1/email_log') {
        if (w.logTableMissing) return res(404, { message: 'relation "public.email_log" does not exist' })
        if (method === 'POST') { w.log.push(JSON.parse(body!)); return res(201) }
        const who = (u.searchParams.get('sent_by') || '').replace('eq.', '')
        const since = Date.parse(decodeURIComponent((u.searchParams.get('created_at') || '').replace('gte.', '')))
        return res(200, w.log.filter(r => r.sent_by === who && Date.parse(String(r.created_at ?? new Date().toISOString())) >= since).map((_, i) => ({ id: i })))
      }
      if (u.pathname === '/rest/v1/notifications') {
        if (method === 'GET') return res(200, (w.notifications || []).filter(n => !n.dispatch_claimed_at).map(n => ({ id: n.id })))
        if (method === 'PATCH') {
          const patch = JSON.parse(body!)
          const hit = (w.notifications || []).filter(n => (u.searchParams.get('id') || '').includes(n.id))
          hit.forEach(n => Object.assign(n, patch))
          return res(200, hit)
        }
      }
      if (u.pathname === '/rest/v1/notification_prefs' || u.pathname === '/rest/v1/push_subscriptions') return res(200, [])
      return res(404, { message: `no fake for ${u.pathname}` })
    }
    if (u.host === 'login.microsoftonline.com') {
      w.tokenCalls++
      assert.equal(u.pathname, '/tenant-1/oauth2/v2.0/token')
      const form = new URLSearchParams(body)
      assert.equal(form.get('grant_type'), 'client_credentials')
      assert.equal(form.get('scope'), 'https://graph.microsoft.com/.default')
      assert.equal(form.get('client_id'), 'app-1'); assert.equal(form.get('client_secret'), 's3cret')
      if (w.tokenFails) return res(w.tokenFails.status, w.tokenFails.body)
      return res(200, { access_token: `graph-token-${w.tokenCalls}`, expires_in: 3599 })
    }
    if (u.host === 'graph.microsoft.com') {
      w.sent.push({ url, auth: headers.authorization, body: JSON.parse(body!) })
      return res(w.graph.status, w.graph.body)
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
})

const event = (token: string | null, body: unknown, method = 'POST') => ({
  httpMethod: method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body), queryStringParameters: {},
})
const call = async (token: string | null, body: unknown) => { const r = await sendFn.handler(event(token, body)); return { status: r.statusCode, body: JSON.parse(r.body) } }
const pdfB64 = Buffer.from('%PDF-1.7 test').toString('base64')
const invoiceEmail = { to: ['ap@halavi.com'], cc: ['acct@halavi.com'], subject: 'Invoice HAL-1', text: 'Hello', attachments: [{ name: 'Invoice-HAL-1.pdf', contentType: 'application/pdf', base64: pdfB64 }] }

test('signed-out callers and non-staff are refused before anything is sent', async () => {
  assert.equal((await call(null, invoiceEmail)).status, 401)
  assert.equal((await call('tok-bad', invoiceEmail)).status, 401)
  const emp = await call('tok-emp', invoiceEmail)
  assert.equal(emp.status, 403)
  assert.match(emp.body.error, /Only YVA staff/)
  delete w.roles['u-rec']   // pending / unknown role
  assert.equal((await call('tok-rec', invoiceEmail)).status, 403)
  assert.equal(w.sent.length, 0); assert.equal(w.log.length, 0)
  assert.equal((await sendFn.handler({ httpMethod: 'GET', headers: {} })).statusCode, 405)
})

test('a bad email is refused with the reason (nothing sent, nothing logged)', async () => {
  const r = await call('tok-ceo', { ...invoiceEmail, attachments: [{ name: 'x.exe', contentType: 'application/x-msdownload', base64: 'AAAA' }] })
  assert.equal(r.status, 400); assert.match(r.body.error, /Only PDF attachments/)
  assert.equal((await call('tok-ceo', { ...invoiceEmail, to: 'nope' })).status, 400)
  assert.equal(w.sent.length, 0); assert.equal(w.log.length, 0)
})

test('success: Graph gets the right message from the company mailbox, and the log records it', async () => {
  const r = await call('tok-rec', invoiceEmail)
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, from: 'contact@yvastaffing.agency' })
  assert.equal(w.sent.length, 1)
  const s = w.sent[0]
  assert.equal(s.url, 'https://graph.microsoft.com/v1.0/users/contact%40yvastaffing.agency/sendMail')
  assert.equal(s.auth, 'Bearer graph-token-1')
  assert.equal(s.body.saveToSentItems, true)
  assert.equal(s.body.message.subject, 'Invoice HAL-1')
  assert.deepEqual(s.body.message.body, { contentType: 'Text', content: 'Hello' })
  assert.deepEqual(s.body.message.toRecipients, [{ emailAddress: { address: 'ap@halavi.com' } }])
  assert.deepEqual(s.body.message.ccRecipients, [{ emailAddress: { address: 'acct@halavi.com' } }])
  assert.deepEqual(s.body.message.attachments, [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'Invoice-HAL-1.pdf', contentType: 'application/pdf', contentBytes: pdfB64 }])
  assert.equal(w.log.length, 1)
  assert.deepEqual({ ...w.log[0] }, {
    sent_by: 'u-rec', sent_by_email: 'rec@yva.com', to_addresses: ['ap@halavi.com'], cc_addresses: ['acct@halavi.com'], subject: 'Invoice HAL-1',
    attachments: [{ name: 'Invoice-HAL-1.pdf', size: 13 }], status: 'sent', from_address: 'contact@yvastaffing.agency',
  })
  // the Microsoft token is reused, not fetched for every email
  await call('tok-ceo', invoiceEmail)
  assert.equal(w.tokenCalls, 1)
  assert.equal(JSON.stringify(w.log).includes(pdfB64), false)   // the PDF itself is never stored
})

test('limits: 100 an hour per person (others unaffected), then 500 a day', async () => {
  const now = new Date().toISOString()
  for (let i = 0; i < 100; i++) w.log.push({ sent_by: 'u-ceo', status: 'sent', created_at: now })
  const r = await call('tok-ceo', invoiceEmail)
  assert.equal(r.status, 429); assert.match(r.body.error, /100 emails in the last hour/)
  assert.equal((await call('tok-rec', invoiceEmail)).status, 200)
  w.log = []
  const earlier = new Date(Date.now() - 3 * 3600_000).toISOString()
  for (let i = 0; i < 500; i++) w.log.push({ sent_by: 'u-ceo', status: 'sent', created_at: earlier })
  const d = await call('tok-ceo', invoiceEmail)
  assert.equal(d.status, 429); assert.match(d.body.error, /500 emails today/)
})

test('Microsoft errors are shown in plain words and logged as failed', async () => {
  w.graph = { status: 403, body: { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } } }
  const denied = await call('tok-ceo', invoiceEmail)
  assert.equal(denied.status, 503); assert.equal(denied.body.notSetUp, true)
  assert.match(denied.body.error, /Mail\.Send application permission/)
  assert.equal(w.log.at(-1)!.status, 'failed'); assert.match(String(w.log.at(-1)!.error), /ErrorAccessDenied/)

  w.graph = { status: 400, body: { error: { code: 'ErrorInvalidRecipients', message: 'At least one recipient is not valid.' } } }
  const bad = await call('tok-ceo', invoiceEmail)
  assert.equal(bad.status, 502); assert.match(bad.body.error, /Microsoft rejected the email \(400 ErrorInvalidRecipients\): At least one recipient/)

  outlook.__resetForTests()
  w.tokenFails = { status: 401, body: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' } }
  const secret = await call('tok-ceo', invoiceEmail)
  assert.equal(secret.status, 503); assert.match(secret.body.error, /MS_CLIENT_SECRET is wrong or expired/)
  assert.ok(!secret.body.error.includes('s3cret'))
})

test('not set up: says which settings are missing; before the SQL runs it still sends (no log, no limit)', async () => {
  setEnv(false)
  const r = await call('tok-ceo', invoiceEmail)
  assert.equal(r.status, 503); assert.equal(r.body.notSetUp, true)
  assert.match(r.body.error, /MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_MAILBOX missing/)
  setEnv(true)
  w.logTableMissing = true
  const ok = await call('tok-ceo', invoiceEmail)
  assert.equal(ok.status, 200); assert.equal(w.sent.length, 1)
})

test('email-status: staff only; shows the mailbox, never secrets; check signs in to Microsoft without sending', async () => {
  const st = async (token: string | null, check = false) => {
    const r = await statusFn.handler({ httpMethod: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}, queryStringParameters: check ? { check: '1' } : {} })
    return { status: r.statusCode, body: JSON.parse(r.body), raw: r.body }
  }
  assert.equal((await st(null)).status, 401)
  assert.equal((await st('tok-emp')).status, 403)
  const plain = await st('tok-ceo')
  assert.deepEqual(plain.body, { configured: true, mailbox: 'contact@yvastaffing.agency', missing: [] })
  assert.equal(w.tokenCalls, 0)
  const checked = await st('tok-ceo', true)
  assert.equal(checked.body.ok, true); assert.equal(w.tokenCalls, 1); assert.equal(w.sent.length, 0)
  assert.ok(!checked.raw.includes('s3cret') && !checked.raw.includes('graph-token'))
  outlook.__resetForTests()
  w.tokenFails = { status: 400, body: { error: 'unauthorized_client', error_description: 'AADSTS700016: Application not found in the directory.' } }
  const bad = await st('tok-ceo', true)
  assert.equal(bad.body.ok, false); assert.match(bad.body.problem, /check MS_TENANT_ID \/ MS_CLIENT_ID/)
  setEnv(false)
  const off = await st('tok-ceo', true)
  assert.equal(off.body.configured, false); assert.equal(off.body.mailbox, null); assert.equal(off.body.missing.length, 4)
})

test('notification emails go out from the company mailbox; a setup problem stops the run with the reason', async () => {
  w.notifications = [
    { id: 'n1', user_id: 'u-ceo', kind: 'lead_new', title: 'New lead: Halavi', body: 'Booked a call', link: '/leads', dispatch_claimed_at: null },
    { id: 'n2', user_id: 'u-rec', kind: 'lead_new', title: 'New lead: Smith', body: null, link: null, dispatch_claimed_at: null },
  ]
  const r = await dispatchPending()
  assert.equal(r.emailed, 2); assert.equal(r.emailProblem, null)
  assert.equal(w.sent.length, 2)
  assert.equal(w.sent[0].body.message.body.contentType, 'HTML')
  assert.equal(w.sent[0].body.message.subject, 'New lead: Halavi')
  assert.ok(w.notifications.every(n => n.emailed_at))

  w.notifications.push({ id: 'n3', user_id: 'u-ceo', kind: 'x', title: 'A', dispatch_claimed_at: null }, { id: 'n4', user_id: 'u-ceo', kind: 'x', title: 'B', dispatch_claimed_at: null })
  w.graph = { status: 403, body: { error: { code: 'ErrorAccessDenied', message: 'denied' } } }
  const sentBefore = w.sent.length
  const r2 = await dispatchPending()
  assert.equal(r2.emailed, 0); assert.match(String(r2.emailProblem), /Microsoft refused to send/)
  assert.equal(w.sent.length - sentBefore, 1)   // stopped after the first refusal instead of trying every email
  setEnv(false)
  w.notifications.push({ id: 'n5', user_id: 'u-ceo', kind: 'x', title: 'C', dispatch_claimed_at: null })
  const r3 = await dispatchPending()
  assert.match(String(r3.emailProblem), /not set up/)
})
