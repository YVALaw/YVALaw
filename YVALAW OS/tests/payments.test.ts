import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { FakeBackend, signedEvent } from './helpers/fakeBackend.ts'

const require = createRequire(import.meta.url)

const P = require('../netlify/functions/_lib/payments.cjs')
const { toForm } = require('../netlify/functions/_lib/stripe.cjs')

const INV = 'a0000000-0000-4000-8000-000000000001'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const OTHER = 'c0000000-0000-4000-8000-000000000002'
const NOW = Date.parse('2026-11-10T15:00:00Z')
const DAY = 86400_000

// ── Pure rules ──────────────────────────────────────────────────────────────
test('balance is worked out in cents from the database row', () => {
  assert.equal(P.balanceCents({ subtotal: 1000.1, amount_paid: 400.05 }), 60005)
  assert.equal(P.balanceCents({ subtotal: '0.3', amount_paid: '0.1' }), 20)
  assert.equal(P.isPayable({ status: 'Sent', subtotal: 10, amount_paid: 0 }), true)
  assert.equal(P.isPayable({ status: 'draft', subtotal: 10 }), false)
  assert.equal(P.isPayable({ status: 'partial', subtotal: 10, amount_paid: 9.6 }), false, 'under 50 cents is not payable online')
})

test('an invoice belongs to a client by client_id; the name is only for invoices without one', () => {
  assert.equal(P.invoiceBelongsToClient({ client_id: CLIENT, client_name: 'Other' }, { id: CLIENT, name: 'Acme' }), true)
  assert.equal(P.invoiceBelongsToClient({ client_id: OTHER, client_name: 'Acme' }, { id: CLIENT, name: 'Acme' }), false, 'same name, different client')
  assert.equal(P.invoiceBelongsToClient({ client_id: null, client_name: 'Acme ' }, { id: CLIENT, name: 'Acme' }), true)
  assert.equal(P.invoiceBelongsToClient({ client_id: null, client_name: '' }, { id: CLIENT, name: '' }), false)
})

test('AutoPay: due date required, waits for money in flight, 3 tries 3 days apart', () => {
  const inv = { status: 'sent', subtotal: 100, amount_paid: 0, due_date: '2026-11-10' }
  const today = '2026-11-10'
  assert.deepEqual(P.autopayDecision({ invoice: inv, today, now: NOW }), { charge: true, tryNumber: 1 })
  assert.equal(P.autopayDecision({ invoice: { ...inv, due_date: null }, today, now: NOW }).reason, 'no_due_date')
  assert.equal(P.autopayDecision({ invoice: { ...inv, due_date: '2026-11-11' }, today, now: NOW }).reason, 'not_due')
  const iso = (ms: number) => new Date(ms).toISOString()
  assert.equal(P.autopayDecision({ invoice: inv, today, now: NOW, attempts: [{ status: 'processing', source: 'portal', attempted_at: iso(NOW - 2 * DAY) }] }).reason, 'in_flight')
  assert.equal(P.autopayDecision({ invoice: inv, today, now: NOW, attempts: [{ status: 'succeeded', source: 'portal', attempted_at: iso(NOW - DAY) }] }).reason, 'recently_paid')
  const fail = (daysAgo: number) => ({ status: 'failed', source: 'autopay', attempted_at: iso(NOW - daysAgo * DAY) })
  assert.equal(P.autopayDecision({ invoice: inv, today, now: NOW, attempts: [fail(1)] }).reason, 'waiting_retry')
  assert.deepEqual(P.autopayDecision({ invoice: inv, today, now: NOW, attempts: [fail(3)] }), { charge: true, tryNumber: 2 })
  assert.equal(P.autopayDecision({ invoice: inv, today, now: NOW, attempts: [fail(9), fail(6), fail(3)] }).reason, 'gave_up')
  assert.deepEqual(P.autopayDecision({ invoice: inv, today, now: NOW, attempts: [{ status: 'failed', source: 'portal', attempted_at: iso(NOW - 3600_000) }] }), { charge: true, tryNumber: 1 }, "the client's own failed try doesn't count")
})

test('pay links name one invoice, expire, and cannot be altered', () => {
  const secret = 'test-secret'
  const tok = P.signPayLink(INV, { secret, now: NOW })
  assert.deepEqual(P.verifyPayLink(tok, { secret, now: NOW + DAY }), { ok: true, invoiceId: INV })
  assert.equal(P.verifyPayLink(tok, { secret, now: NOW + 61 * DAY }).reason, 'expired')
  assert.equal(P.verifyPayLink(tok, { secret: 'other', now: NOW }).reason, 'bad_signature')
  const swapped = tok.replace(INV, 'a0000000-0000-4000-8000-000000000009')
  assert.equal(P.verifyPayLink(swapped, { secret, now: NOW }).reason, 'bad_signature')
  const [v, id, exp, sig] = tok.split('.')
  assert.equal(P.verifyPayLink([v, id, String(Number(exp) + 999999), sig].join('.'), { secret, now: NOW }).reason, 'bad_signature', 'extending the expiry breaks it')
  assert.equal(P.verifyPayLink('garbage', { secret }).reason, 'malformed')
  assert.equal(P.verifyPayLink(undefined, { secret }).reason, 'malformed')
})

test('Stripe form encoding: nested objects and arrays', () => {
  const s = toForm({ a: 1, b: { c: 'x y', d: null }, t: ['card', 'us_bank_account'], l: [{ q: 1 }] }).join('&')
  assert.equal(decodeURIComponent(s), 'a=1&b[c]=x y&t[0]=card&t[1]=us_bank_account&l[0][q]=1')
})

test('saved method summary for cards and bank accounts', () => {
  assert.deepEqual(P.methodSummary({ id: 'pm_1', type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 } }),
    { id: 'pm_1', type: 'card', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030, bankName: null })
  assert.equal(P.savedMethodColumns(P.methodSummary({ id: 'pm_2', type: 'us_bank_account', us_bank_account: { bank_name: 'Chase', last4: '6789' } })).default_bank_name, 'Chase')
  assert.equal(P.savedMethodColumns(null).default_payment_method_id, null)
})

// ── Webhook ─────────────────────────────────────────────────────────────────
const WH = 'whsec_test'
function webhookBackend() {
  process.env.STRIPE_WEBHOOK_SECRET = WH
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  const fb = new FakeBackend().install()
  fb.db = {
    stripe_events: [], client_payments: [], payment_attempts: [], activity_log: [], client_users: [], notifications: [],
    role_permissions: [], user_roles: [{ user_id: 'u-ceo', role: 'ceo' }],
    invoices: [{ id: INV, number: 'ACM0001', client_id: CLIENT, client_name: 'Acme', subtotal: 1000, amount_paid: 0, status: 'sent' }],
  }
  fb.stripe = (method, path) => {
    if (path.startsWith('/payment_methods/')) return { id: path.split('/')[2], type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2031 } }
    throw new Error(`unexpected stripe ${method} ${path}`)
  }
  return fb
}
const pi = (over: Record<string, unknown> = {}) => ({ id: 'pi_1', object: 'payment_intent', amount: 100000, amount_received: 100000, currency: 'usd', customer: 'cus_1',
  payment_method: 'pm_1', latest_charge: 'ch_1', metadata: { invoiceId: INV, clientId: CLIENT, invoiceNumber: 'ACM0001', source: 'portal' }, ...over })
const evt = (id: string, type: string, object: object, livemode = false) => ({ id, type, livemode, data: { object } })

test('webhook: bad signature or an old timestamp is refused', async () => {
  const fb = webhookBackend()
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    const e = signedEvent(evt('evt_1', 'payment_intent.succeeded', pi()), 'whsec_wrong')
    assert.equal((await handler(e)).statusCode, 400)
    const old = signedEvent(evt('evt_1', 'payment_intent.succeeded', pi()), WH, Math.floor(Date.now() / 1000) - 400)
    assert.equal((await handler(old)).statusCode, 400)
    assert.equal(fb.table('client_payments').length, 0)
  } finally { fb.restore() }
})

test('webhook: a payment is recorded once as a client payment; the invoice is never overwritten', async () => {
  const fb = webhookBackend()
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    const e = signedEvent(evt('evt_s1', 'payment_intent.succeeded', pi({ amount_received: 40000, amount: 40000 })), WH)
    const r1 = await handler(e)
    assert.equal(r1.statusCode, 200, r1.body)
    const r2 = await handler(e)   // Stripe retry
    assert.match(r2.body, /duplicate/)
    const pays = fb.table('client_payments')
    assert.equal(pays.length, 1)
    assert.deepEqual([pays[0].amount, pays[0].method, pays[0].kind, pays[0].external_ref, pays[0].stripe_charge_id], [400, 'card', 'payment', 'pi_1', 'ch_1'])
    assert.equal(fb.restCalls.filter(c => c.method === 'PATCH' && c.path.startsWith('invoices')).length, 0, 'invoice status comes from the database trigger only')
    assert.ok(fb.table('stripe_events')[0].processed_at)
    assert.equal(fb.table('payment_attempts')[0].status, 'succeeded')
  } finally { fb.restore() }
})

test('webhook: a database failure answers 500 so Stripe retries, and the retry is processed', async () => {
  const fb = webhookBackend()
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    fb.failInsert.client_payments = 'connection reset'
    const e = signedEvent(evt('evt_f1', 'payment_intent.succeeded', pi()), WH)
    assert.equal((await handler(e)).statusCode, 500)
    assert.equal(fb.table('stripe_events')[0].processed_at, undefined)
    assert.equal((await handler(e)).statusCode, 200)
    assert.equal(fb.table('client_payments').length, 1)
  } finally { fb.restore() }
})

test('webhook: events from the other mode are ignored', async () => {
  const fb = webhookBackend()
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    const r = await handler(signedEvent(evt('evt_l1', 'payment_intent.succeeded', pi(), true), WH))
    assert.match(r.body, /other mode/)
    assert.equal(fb.table('client_payments').length, 0)
  } finally { fb.restore() }
})

test('webhook: a payment that overpays tells the team; non-USD payments are not applied', async () => {
  const fb = webhookBackend()
  try {
    fb.table('invoices')[0].amount_paid = 900
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    await handler(signedEvent(evt('evt_o1', 'payment_intent.succeeded', pi()), WH))
    assert.equal(fb.table('client_payments').length, 1, 'recorded as received (visible as overpaid)')
    assert.ok(fb.table('notifications').some(n => /overpaid by \$900\.00/.test(String(n.title))))
    await handler(signedEvent(evt('evt_o2', 'payment_intent.succeeded', pi({ id: 'pi_eur', currency: 'eur' })), WH))
    assert.equal(fb.table('client_payments').length, 1)
  } finally { fb.restore() }
})

test('webhook: one row per Stripe refund — events together, out of order or repeated count once; a failed refund is undone', async () => {
  const fb = webhookBackend()
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    await handler(signedEvent(evt('evt_p', 'payment_intent.succeeded', pi()), WH))
    const refunds = [{ id: 're_1', amount: 10000, status: 'succeeded' }]
    const base = fb.stripe
    fb.stripe = (method, path, form) => path === '/refunds' && method === 'GET' ? (assert.equal(form.get('charge'), 'ch_1'), { data: refunds }) : base(method, path, form, {})
    const charge = (refunded: number) => ({ id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 100000, amount_refunded: refunded })
    refunds.push({ id: 're_2', amount: 20000, status: 'pending' })
    await Promise.all([handler(signedEvent(evt('evt_r2', 'charge.refunded', charge(30000)), WH)), handler(signedEvent(evt('evt_r1', 'charge.refunded', charge(10000)), WH))])
    await handler(signedEvent(evt('evt_r3', 'charge.refunded', charge(30000)), WH))
    const rows = () => fb.table('client_payments').filter(p => p.kind === 'refund')
    assert.deepEqual(rows().map(r => [r.external_ref, r.amount]).sort(), [['re_1', -100], ['re_2', -200]])
    refunds[1].status = 'failed'   // a bank refund that failed days later
    await handler(signedEvent(evt('evt_r4', 'charge.refund.updated', { id: 're_2', object: 'refund', charge: 'ch_1', payment_intent: 'pi_1', status: 'failed', amount: 20000 }), WH))
    assert.deepEqual(rows().map(r => r.external_ref), ['re_1'])
  } finally { fb.restore() }
})

test('webhook: a late "processing" event never overwrites a finished payment', async () => {
  const fb = webhookBackend()
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    await handler(signedEvent(evt('evt_ok', 'payment_intent.succeeded', pi()), WH))
    await handler(signedEvent(evt('evt_late', 'payment_intent.processing', pi({ status: 'processing' })), WH))
    assert.equal(fb.table('payment_attempts')[0].status, 'succeeded')
    assert.equal(fb.table('payment_attempts').length, 1)
  } finally { fb.restore() }
})

test('webhook: the same event arriving twice at once is processed once (409 → Stripe retries later)', async () => {
  const fb = webhookBackend()
  try {
    fb.table('stripe_events').push({ id: 'evt_dup', type: 'payment_intent.succeeded', received_at: new Date().toISOString(), processed_at: null })
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    const r = await handler(signedEvent(evt('evt_dup', 'payment_intent.succeeded', pi()), WH))
    assert.equal(r.statusCode, 409)
    assert.equal(fb.table('client_payments').length, 0)
  } finally { fb.restore() }
})

test('webhook: disputes take the money back and give it back if won', async () => {
  const fb = webhookBackend()
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    await handler(signedEvent(evt('evt_p', 'payment_intent.succeeded', pi()), WH))
    const d = { id: 'dp_1', object: 'dispute', charge: 'ch_1', payment_intent: 'pi_1', amount: 100000, reason: 'fraudulent', status: 'needs_response' }
    await handler(signedEvent(evt('evt_d1', 'charge.dispute.created', d), WH))
    await handler(signedEvent(evt('evt_d2', 'charge.dispute.funds_withdrawn', d), WH))
    assert.deepEqual(fb.table('client_payments').filter(p => p.kind === 'dispute').map(p => p.amount), [-1000])
    await handler(signedEvent(evt('evt_d3', 'charge.dispute.funds_reinstated', d), WH))
    assert.equal(fb.table('client_payments').filter(p => p.kind === 'dispute').length, 0)
    assert.ok(fb.table('notifications').some(n => /disputed/.test(String(n.title))))
  } finally { fb.restore() }
})

test('webhook: a paid-with card is saved only if asked and only when nothing is saved yet', async () => {
  const fb = webhookBackend()
  try {
    fb.table('client_users').push({ id: 'cu1', client_id: CLIENT, stripe_customer_id: 'cus_1', default_payment_method_id: null })
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    await handler(signedEvent(evt('evt_a', 'payment_intent.succeeded', pi()), WH))
    assert.equal(fb.table('client_users')[0].default_payment_method_id, null, 'not asked to save')
    await handler(signedEvent(evt('evt_b', 'payment_intent.succeeded', pi({ id: 'pi_2', setup_future_usage: 'off_session', payment_method: 'pm_new' })), WH))
    assert.equal(fb.table('client_users')[0].default_payment_method_id, 'pm_new')
    await handler(signedEvent(evt('evt_c', 'payment_intent.succeeded', pi({ id: 'pi_3', setup_future_usage: 'off_session', payment_method: 'pm_other' })), WH))
    assert.equal(fb.table('client_users')[0].default_payment_method_id, 'pm_new', 'AutoPay never switches cards on its own')
    await handler(signedEvent(evt('evt_d', 'payment_method.detached', { id: 'pm_new', object: 'payment_method', type: 'card' }), WH))
    assert.equal(fb.table('client_users')[0].default_payment_method_id, null)
    assert.equal(fb.table('client_users')[0].auto_pay_enabled, false)
  } finally { fb.restore() }
})

test('webhook: AutoPay failure counts up and the last try tells the team', async () => {
  const fb = webhookBackend()
  try {
    fb.table('client_users').push({ id: 'cu1', client_id: CLIENT, stripe_customer_id: 'cus_1', autopay_failures: 0 })
    for (const n of [1, 2]) fb.table('payment_attempts').push({ stripe_payment_intent_id: `pi_old${n}`, stripe_customer_id: 'cus_1', source: 'autopay', status: 'failed', attempted_at: new Date().toISOString() })
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    const failed = pi({ status: 'requires_payment_method', amount_received: 0, last_payment_error: { message: 'Your card was declined.' }, metadata: { invoiceId: INV, clientId: CLIENT, invoiceNumber: 'ACM0001', autoPay: 'true', try: '3' } })
    await handler(signedEvent(evt('evt_x', 'payment_intent.payment_failed', failed), WH))
    assert.equal(fb.table('client_users')[0].autopay_failures, 3, 'counted from the attempts, so a repeated event never double-counts')
    assert.ok(fb.table('notifications').some(n => /AutoPay stopped trying/.test(String(n.title))))
    assert.equal(fb.table('payment_attempts').find(a => a.stripe_payment_intent_id === 'pi_1')!.status, 'failed')
  } finally { fb.restore() }
})

// ── create-payment-intent ───────────────────────────────────────────────────
function portalBackend() {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  const fb = new FakeBackend().install()
  fb.users = { 'tok-client': { id: 'u-client', email: 'ap@acme.com' }, 'tok-ceo': { id: 'u-ceo', email: 'ceo@yva.com' }, 'tok-other': { id: 'u-other', email: 'x@other.com' } }
  fb.db = {
    client_users: [{ id: 'cu1', auth_id: 'u-client', client_id: CLIENT, stripe_customer_id: null }, { id: 'cu2', auth_id: 'u-other', client_id: OTHER, stripe_customer_id: 'cus_o' }],
    clients: [{ id: CLIENT, name: 'Acme', email: 'ap@acme.com' }, { id: OTHER, name: 'Other', email: 'x@other.com' }],
    invoices: [{ id: INV, number: 'ACM0001', client_id: CLIENT, client_name: 'Acme', subtotal: 1000, amount_paid: 250, status: 'partial' }],
    payment_attempts: [], user_roles: [{ user_id: 'u-ceo', role: 'ceo' }],
  }
  const intents: Record<string, Record<string, unknown>> = {}
  let n = 0
  fb.stripe = (method, path, form) => {
    if (path === '/customers' && method === 'POST') return { id: 'cus_new' }
    if (path === '/payment_intents' && method === 'POST') {
      const id = `pi_${++n}`
      intents[id] = { id, client_secret: `${id}_secret`, status: 'requires_payment_method', currency: 'usd', amount: Number(form.get('amount')),
        setup_future_usage: form.get('setup_future_usage'), metadata: { invoiceId: form.get('metadata[invoiceId]') } }
      return intents[id]
    }
    const m = /^\/payment_intents\/(pi_\d+)$/.exec(path)
    if (m && method === 'GET') return intents[m[1]]
    if (m && method === 'POST') { Object.assign(intents[m[1]], { amount: Number(form.get('amount')), setup_future_usage: form.get('setup_future_usage') || null }); return intents[m[1]] }
    if (path.includes('/payment_methods')) return { data: [] }
    throw new Error(`unexpected stripe ${method} ${path}`)
  }
  return { fb, intents }
}
const call = (token: string | null, body: object) => ({ httpMethod: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) })

test('pay: only the client\'s own portal login, only its invoices, amount from the database', async () => {
  const { fb } = portalBackend()
  try {
    const { handler } = require('../netlify/functions/create-payment-intent.cjs')
    assert.equal((await handler(call(null, { invoiceId: INV, clientId: CLIENT }))).statusCode, 401)
    assert.equal((await handler(call('tok-ceo', { invoiceId: INV, clientId: CLIENT }))).statusCode, 403, 'staff (preview) can never start a charge')
    assert.equal((await handler(call('tok-other', { invoiceId: INV, clientId: CLIENT }))).statusCode, 403, "another client's login")
    assert.equal((await handler(call('tok-other', { invoiceId: INV, clientId: OTHER }))).statusCode, 403, 'invoice of another client')
    assert.equal((await handler(call('tok-client', { invoiceId: INV, clientId: CLIENT, amountCents: 100 }))).statusCode, 409, 'browser figure must match')
    const ok = await handler(call('tok-client', { invoiceId: INV, clientId: CLIENT, amountCents: 75000 }))
    assert.equal(ok.statusCode, 200, ok.body)
    const create = fb.stripeCalls.find(c => c.path === '/payment_intents')!
    assert.equal(create.form.get('amount'), '75000')
    assert.equal(create.form.get('payment_method_types[1]'), 'us_bank_account')
    assert.equal(create.form.get('setup_future_usage'), null, 'never saved unless the client asks')
    assert.ok(create.headers['idempotency-key'])
    assert.equal(fb.table('client_users')[0].stripe_customer_id, 'cus_new')
  } finally { fb.restore() }
})

test('pay: reopening reuses the same payment (and updates the "save" choice) instead of creating another', async () => {
  const { fb, intents } = portalBackend()
  try {
    const { handler } = require('../netlify/functions/create-payment-intent.cjs')
    const a = JSON.parse((await handler(call('tok-client', { invoiceId: INV, clientId: CLIENT }))).body)
    const b = JSON.parse((await handler(call('tok-client', { invoiceId: INV, clientId: CLIENT, savePaymentMethod: true }))).body)
    assert.equal(a.paymentIntentId, b.paymentIntentId)
    assert.equal(Object.keys(intents).length, 1)
    assert.equal(intents[a.paymentIntentId].setup_future_usage, 'off_session')
  } finally { fb.restore() }
})

test('pay: no second payment while a bank payment is clearing', async () => {
  const { fb } = portalBackend()
  try {
    fb.table('payment_attempts').push({ invoice_id: INV, status: 'processing', source: 'portal', attempted_at: new Date().toISOString() })
    const { handler } = require('../netlify/functions/create-payment-intent.cjs')
    const r = await handler(call('tok-client', { invoiceId: INV, clientId: CLIENT }))
    assert.equal(r.statusCode, 409)
    assert.match(r.body, /already on its way/)
  } finally { fb.restore() }
})

// ── remove card, AutoPay settings ───────────────────────────────────────────
test('removing a saved method detaches it in Stripe and turns AutoPay off', async () => {
  const { fb } = portalBackend()
  try {
    Object.assign(fb.table('client_users')[0], { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1', auto_pay_enabled: true })
    fb.stripe = (method, path) => {
      if (path === '/payment_methods/pm_1' && method === 'GET') return { id: 'pm_1', customer: 'cus_1', type: 'card' }
      if (path === '/payment_methods/pm_1/detach') return { id: 'pm_1' }
      throw new Error(`unexpected ${method} ${path}`)
    }
    const { handler } = require('../netlify/functions/portal-remove-card.cjs')
    assert.equal((await handler(call('tok-client', { clientId: CLIENT }))).statusCode, 200)
    assert.ok(fb.stripeCalls.some(c => c.path === '/payment_methods/pm_1/detach'))
    assert.equal(fb.table('client_users')[0].default_payment_method_id, null)
    assert.equal(fb.table('client_users')[0].auto_pay_enabled, false)
  } finally { fb.restore() }
})

test('AutoPay can be turned on with the saved method, and only with a method of this login', async () => {
  const { fb } = portalBackend()
  try {
    Object.assign(fb.table('client_users')[0], { stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1' })
    fb.stripe = (_m, path) => {
      if (path === '/payment_methods/pm_mine') return { id: 'pm_mine', customer: 'cus_1', type: 'us_bank_account', us_bank_account: { bank_name: 'Chase', last4: '6789' } }
      if (path === '/payment_methods/pm_theirs') return { id: 'pm_theirs', customer: 'cus_o', type: 'card', card: {} }
      throw new Error(path)
    }
    const { handler } = require('../netlify/functions/update-autopay-settings.cjs')
    const on = await handler(call('tok-client', { clientId: CLIENT, enabled: true }))
    assert.equal(on.statusCode, 200, on.body)
    assert.equal(fb.table('client_users')[0].auto_pay_enabled, true)
    assert.equal((await handler(call('tok-client', { clientId: CLIENT, enabled: true, paymentMethodId: 'pm_theirs' }))).statusCode, 403)
    assert.equal((await handler(call('tok-client', { clientId: CLIENT, enabled: true, paymentMethodId: 'pm_mine' }))).statusCode, 200)
    assert.equal(fb.table('client_users')[0].default_bank_name, 'Chase')
    assert.equal((await handler(call('tok-ceo', { clientId: CLIENT, enabled: true }))).statusCode, 403, 'staff cannot turn AutoPay on for a client')
  } finally { fb.restore() }
})

// ── AutoPay run ─────────────────────────────────────────────────────────────
test('AutoPay run: one login per client, due invoices only, idempotency key per invoice per day, no invoice writes', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  const fb = new FakeBackend().install()
  try {
    fb.db = {
      client_users: [
        { id: 'cu1', client_id: CLIENT, auto_pay_enabled: true, stripe_customer_id: 'cus_1', default_payment_method_id: 'pm_1', default_payment_method_type: 'card', auto_pay_authorized_at: '2026-11-02' },
        { id: 'cu1b', client_id: CLIENT, auto_pay_enabled: true, stripe_customer_id: 'cus_1b', default_payment_method_id: 'pm_1b', default_payment_method_type: 'card', auto_pay_authorized_at: '2026-10-01' },
      ],
      clients: [{ id: CLIENT, name: 'Acme', email: 'ap@acme.com' }],
      invoices: [
        { id: INV, number: 'ACM0001', client_id: CLIENT, client_name: 'Acme', subtotal: 500, amount_paid: 0, status: 'sent', due_date: '2026-01-09' },
        { id: 'a0000000-0000-4000-8000-000000000002', number: 'ACM0002', client_id: CLIENT, subtotal: 500, amount_paid: 0, status: 'sent', due_date: null },
        { id: 'a0000000-0000-4000-8000-000000000003', number: 'OLD1', client_id: null, client_name: 'Acme', subtotal: 80, amount_paid: 0, status: 'overdue', due_date: '2026-10-01' },
      ],
      payment_attempts: [],
      client_payments: [{ invoice_id: 'a0000000-0000-4000-8000-000000000004', kind: 'refund', amount: -10 }],
    }
    fb.table('invoices').push({ id: 'a0000000-0000-4000-8000-000000000004', number: 'ACM0004', client_id: CLIENT, subtotal: 100, amount_paid: 0, status: 'sent', due_date: '2026-01-02' })
    fb.stripe = (_m, path, form) => {
      if (path === '/payment_intents') return { id: `pi_${form.get('metadata[invoiceNumber]')}`, status: 'succeeded', currency: 'usd' }
      throw new Error(path)
    }
    const { _test } = require('../netlify/functions/run-autopay.cjs')
    const now = Date.now()
    const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' })
    const s = await _test.run({ now })
    assert.equal(s.charged, 1, 'only the due invoice of this client_id')
    assert.equal(s.skipped.no_due_date, 1)
    assert.equal(s.skipped.refunded, 1, 'an invoice that had a refund is left for staff')
    const calls = fb.stripeCalls.filter(c => c.path === '/payment_intents')
    assert.deepEqual(calls.map(c => c.form.get('customer')), ['cus_1'], 'the most recent consent only')
    assert.deepEqual(calls.map(c => c.headers['idempotency-key']), [`autopay-${INV}-50000-${today}`], 'never by client name (OLD1 has no client_id)')
    assert.equal(fb.restCalls.filter(c => c.path.startsWith('invoices') && c.method !== 'GET').length, 0)
    // Next run the same day: the successes are in flight/recent → nothing charged again
    const again = await _test.run({ now: now + 3600_000 })
    assert.equal(again.charged, 0)
  } finally { fb.restore() }
})

// ── pay links ───────────────────────────────────────────────────────────────
test('pay link: staff make it; opening it sends the client to Stripe Checkout for the current balance', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  const fb = new FakeBackend().install()
  try {
    fb.users = { 'tok-acc': { id: 'u-acc', email: 'acc@yva.com' }, 'tok-rec': { id: 'u-rec', email: 'r@yva.com' } }
    fb.db = {
      user_roles: [{ user_id: 'u-acc', role: 'accounting' }, { user_id: 'u-rec', role: 'recruiter' }], role_permissions: [],
      invoices: [{ id: INV, number: 'ACM0001', client_id: CLIENT, client_name: 'Acme', subtotal: 1000, amount_paid: 100, status: 'partial' }],
      clients: [{ id: CLIENT, name: 'Acme', email: 'ap@acme.com' }], payment_attempts: [], settings: [{ id: 1, company_name: 'YVA Staffing' }],
    }
    fb.stripe = (method, path, form) => {
      if (path === '/checkout/sessions' && method === 'POST') return { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', amount_total: Number(form.get('line_items[0][price_data][unit_amount]')), status: 'open' }
      if (path === '/checkout/sessions/cs_1') return { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', amount_total: 90000, status: 'open' }
      throw new Error(path)
    }
    const { handler } = require('../netlify/functions/pay-link.cjs')
    assert.equal((await handler(call('tok-rec', { invoiceId: INV }))).statusCode, 403)
    const made = await handler(call('tok-acc', { invoiceId: INV }))
    assert.equal(made.statusCode, 200, made.body)
    const url = new URL(JSON.parse(made.body).url)
    assert.equal(url.pathname, '/pay')
    const open = (t: string | null) => handler({ httpMethod: 'GET', headers: {}, queryStringParameters: t ? { t } : {} })
    const r = await open(url.searchParams.get('t'))
    assert.equal(r.statusCode, 303)
    assert.equal(r.headers.Location, 'https://checkout.stripe.com/c/cs_1')
    const create = fb.stripeCalls.find(c => c.path === '/checkout/sessions')!
    assert.equal(create.form.get('line_items[0][price_data][unit_amount]'), '90000')
    assert.equal(create.form.get('payment_intent_data[metadata][invoiceId]'), INV)
    assert.equal(create.form.get('adaptive_pricing[enabled]'), 'false', 'always USD — no conversion to the visitor\'s currency')
    assert.equal(create.form.get('payment_method_types[1]'), 'us_bank_account')
    // Opened again (or by an email scanner): same Checkout page, no new session
    await open(url.searchParams.get('t'))
    assert.equal(fb.stripeCalls.filter(c => c.path === '/checkout/sessions' && c.method === 'POST').length, 1)
    // Altered link / paid invoice
    assert.equal((await open('v1.x.1.abc')).statusCode, 400)
    fb.table('invoices')[0].amount_paid = 1000; fb.table('invoices')[0].status = 'paid'
    const paid = await open(url.searchParams.get('t'))
    assert.equal(paid.statusCode, 200)
    assert.match(paid.body, /is paid/)
  } finally { fb.restore() }
})

// ── refunds ─────────────────────────────────────────────────────────────────
test('refund: needs the permission, never more than what is left', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  const fb = new FakeBackend().install()
  try {
    fb.users = { 'tok-ceo': { id: 'u-ceo', email: 'c@yva.com' }, 'tok-acc': { id: 'u-acc', email: 'a@yva.com' } }
    fb.db = {
      user_roles: [{ user_id: 'u-ceo', role: 'ceo' }, { user_id: 'u-acc', role: 'accounting' }], role_permissions: [],
      client_payments: [
        { id: 'b0000000-0000-4000-8000-000000000001', invoice_id: INV, amount: 500, source: 'stripe', kind: 'payment', external_ref: 'pi_1', stripe_charge_id: 'ch_1' },
        { id: 'b0000000-0000-4000-8000-000000000002', invoice_id: INV, amount: -200, source: 'stripe', kind: 'refund', external_ref: 'refund:ch_1:20000', stripe_charge_id: 'ch_1' },
        { id: 'b0000000-0000-4000-8000-000000000003', invoice_id: INV, amount: 100, source: 'manual', kind: 'payment' },
      ],
    }
    fb.stripe = (_m, path, form) => { if (path === '/refunds') return { id: 're_1', status: 'succeeded', amount: Number(form.get('amount')) }; throw new Error(path) }
    const { handler } = require('../netlify/functions/refund-payment.cjs')
    const RID = 'e0000000-0000-4000-8000-000000000001'
    assert.equal((await handler(call('tok-acc', { paymentId: 'b0000000-0000-4000-8000-000000000001', requestId: RID }))).statusCode, 403)
    assert.equal((await handler(call('tok-ceo', { paymentId: 'b0000000-0000-4000-8000-000000000001' }))).statusCode, 400, 'a request id per refund is required')
    assert.equal((await handler(call('tok-ceo', { paymentId: 'b0000000-0000-4000-8000-000000000003', requestId: RID }))).statusCode, 400, 'manual payments are refunded outside Stripe')
    assert.equal((await handler(call('tok-ceo', { paymentId: 'b0000000-0000-4000-8000-000000000001', amount: 300.01, requestId: RID }))).statusCode, 400)
    const ok = await handler(call('tok-ceo', { paymentId: 'b0000000-0000-4000-8000-000000000001', requestId: RID }))
    assert.equal(ok.statusCode, 200, ok.body)
    const refundCall = fb.stripeCalls.find(c => c.path === '/refunds')!
    assert.equal(refundCall.form.get('amount'), '30000')
    assert.equal(refundCall.headers['idempotency-key'], `refund-b0000000-0000-4000-8000-000000000001-${RID}`)
    assert.equal(fb.table('client_payments').length, 3, 'the refund row comes from the webhook, not here')
  } finally { fb.restore() }
})

test('invoice emails: the pay link goes where {payLink} is, or on its own line after the message', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/services/invoiceEmail.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export function withPayLink'), src.indexOf('export function applyInvoiceTemplate'))
  const withPayLink = new Function(`${fn.replace('export function withPayLink(body: string, link: string | null): string', 'function withPayLink(body, link)')}; return withPayLink`)()
  assert.equal(withPayLink('Hi\n\nThanks', 'https://x/pay?t=1'), 'Hi\n\nThanks\n\nPay online (card or bank account): https://x/pay?t=1')
  assert.equal(withPayLink('Hi {payLink} bye', 'https://x/pay?t=1'), 'Hi Pay online (card or bank account): https://x/pay?t=1 bye')
  assert.equal(withPayLink('Hi {payLink} bye', null), 'Hi  bye')
  assert.equal(withPayLink('Hi', null), 'Hi')
})
