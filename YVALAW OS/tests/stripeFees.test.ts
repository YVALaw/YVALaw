// Stripe fees: recorded by the webhook from the charge's balance transaction, filled later for bank payments,
// never failing the event; the CEO's "Fill missing fees" function; the Reports sums.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { FakeBackend, signedEvent } from './helpers/fakeBackend.ts'
import { feeSummary } from '../src/utils/stripeFees.ts'

const require = createRequire(import.meta.url)
const F = require('../netlify/functions/_lib/stripeFees.cjs')

const INV = 'a0000000-0000-4000-8000-000000000001'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'
const WH = 'whsec_test'
type Charge = { id: string; balance_transaction: unknown } | Error

/** Fake Supabase + Stripe; `charges[id]` is what GET /charges/:id answers (an Error → Stripe error) */
function backend(charges: Record<string, Charge>) {
  process.env.STRIPE_WEBHOOK_SECRET = WH
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'
  const fb = new FakeBackend().install()
  fb.db = {
    stripe_events: [], client_payments: [], payment_attempts: [], activity_log: [], client_users: [], notifications: [],
    role_permissions: [], user_roles: [{ user_id: 'u-ceo', role: 'ceo' }, { user_id: 'u-acc', role: 'accounting' }],
    invoices: [{ id: INV, number: 'ACM0001', client_id: CLIENT, client_name: 'Acme', subtotal: 1000, amount_paid: 0, status: 'sent' }],
  }
  fb.users = { 'tok-ceo': { id: 'u-ceo', email: 'c@yva.com' }, 'tok-acc': { id: 'u-acc', email: 'a@yva.com' } }
  fb.stripe = (method, path) => {
    if (path.startsWith('/payment_methods/')) return { id: path.split('/')[2], type: 'us_bank_account', us_bank_account: { bank_name: 'Chase', last4: '6789' } }
    if (method === 'GET' && path.startsWith('/charges/')) {
      const c = charges[path.split('/')[2]]
      if (c instanceof Error) throw c
      if (c) return { object: 'charge', status: 'succeeded', ...c }
    }
    if (method === 'GET' && path.startsWith('/payment_intents/')) {
      const id = path.split('/')[2], c = charges[`for:${id}`]
      return { id, latest_charge: c && !(c instanceof Error) ? { object: 'charge', ...c } : null }
    }
    if (method === 'GET' && path === '/refunds') return { data: [{ id: 're_1', amount: 10000, status: 'succeeded' }] }
    throw new Error(`unexpected stripe ${method} ${path}`)
  }
  return fb
}
const bt = (fee: number, net: number, currency = 'usd') => ({ id: 'txn_1', object: 'balance_transaction', currency, fee, net })
const pi = (over: Record<string, unknown> = {}) => ({ id: 'pi_1', object: 'payment_intent', amount: 100000, amount_received: 100000, currency: 'usd', customer: 'cus_1',
  payment_method: 'pm_1', latest_charge: 'ch_1', metadata: { invoiceId: INV, clientId: CLIENT, invoiceNumber: 'ACM0001', source: 'portal' }, ...over })
const evt = (id: string, type: string, object: object) => ({ id, type, livemode: false, data: { object } })
const payment = (fb: FakeBackend) => fb.table('client_payments').find(p => p.kind === 'payment')!

test('fee from a balance transaction: cents → dollars; not available / other currency / bad data → none', () => {
  assert.deepEqual(F.feeFromBalanceTransaction(bt(2930, 97070)), { fee: 29.3, net: 970.7 })
  assert.deepEqual(F.feeFromBalanceTransaction(bt(0, 1000)), { fee: 0, net: 10 })
  assert.equal(F.feeFromBalanceTransaction('txn_1'), null, 'not expanded')
  assert.equal(F.feeFromBalanceTransaction(null), null)
  assert.equal(F.feeFromBalanceTransaction(bt(100, 900, 'eur')), null)
  assert.equal(F.feeFromBalanceTransaction({ fee: -5 }), null)
})

test('Reports sums: fees of Stripe payments (refunded ones too), received = collected − fees, unknown fees counted', () => {
  const s = feeSummary([
    { amount: 1000, source: 'stripe', kind: 'payment', stripeFee: 29.3 },
    { amount: -400, source: 'stripe', kind: 'refund', stripeFee: null },     // the refund doesn't return the fee
    { amount: 500, source: 'stripe', kind: 'payment', stripeFee: 5 },        // ACH: 0.8%
    { amount: 250, source: 'stripe', kind: 'payment', stripeFee: null },     // not known yet
    { amount: 300, source: 'manual', kind: 'payment', stripeFee: null },     // wire: no Stripe fee
  ])
  assert.deepEqual(s, { collected: 1650, fees: 34.3, received: 1615.7, stripePayments: 3, missing: 1 })
  assert.deepEqual(feeSummary([]), { collected: 0, fees: 0, received: 0, stripePayments: 0, missing: 0 })
})

test('webhook: a fee lookup that fails never fails the event — the payment is recorded, the fee left empty', async () => {
  const fb = backend({ ch_1: new Error('Stripe is down') })
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    const r = await handler(signedEvent(evt('evt_f1', 'payment_intent.succeeded', pi()), WH))
    assert.equal(r.statusCode, 200, r.body)
    assert.equal(payment(fb).amount, 1000)
    assert.equal(payment(fb).stripe_fee, undefined)
    assert.ok(fb.table('stripe_events')[0].processed_at)
  } finally { fb.restore() }
})

test('webhook: before the SQL runs (no stripe_fee column) the payment is still recorded', async () => {
  const fb = backend({ ch_1: { id: 'ch_1', balance_transaction: bt(2930, 97070) } })
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(input).includes('/rest/v1/client_payments') && (init.method === 'PATCH' || String(input).includes('stripe_fee')))
      return new Response(JSON.stringify({ code: '42703', message: 'column client_payments.stripe_fee does not exist' }), { status: 400 })
    return inner(input, init)
  }) as typeof fetch
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    const r = await handler(signedEvent(evt('evt_n1', 'payment_intent.succeeded', pi()), WH))
    assert.equal(r.statusCode, 200, r.body)
    assert.equal(fb.table('client_payments').length, 1)
  } finally { globalThis.fetch = inner; fb.restore() }
})

test('webhook: a bank payment whose fee is not known yet is filled when the charge updates (charge.updated)', async () => {
  const charges: Record<string, Charge> = { ch_1: { id: 'ch_1', balance_transaction: null } }
  const fb = backend(charges)
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    await handler(signedEvent(evt('evt_b1', 'payment_intent.succeeded', pi({ payment_method_types: ['us_bank_account'] })), WH))
    assert.equal(payment(fb).stripe_fee, undefined, 'no balance transaction yet → empty')
    charges.ch_1 = { id: 'ch_1', balance_transaction: bt(500, 99500) }
    const r = await handler(signedEvent(evt('evt_b2', 'charge.updated', { id: 'ch_1', object: 'charge', status: 'succeeded', payment_intent: 'pi_1', balance_transaction: 'txn_1' }), WH))
    assert.equal(r.statusCode, 200, r.body)
    assert.match(r.body, /fee filled/)
    assert.deepEqual([payment(fb).stripe_fee, payment(fb).net_amount], [5, 995])
    const n = fb.stripeCalls.filter(c => c.path.startsWith('/charges/')).length
    await handler(signedEvent(evt('evt_b3', 'charge.updated', { id: 'ch_1', object: 'charge', status: 'succeeded', payment_intent: 'pi_1', balance_transaction: 'txn_1' }), WH))
    assert.equal(fb.stripeCalls.filter(c => c.path.startsWith('/charges/')).length, n, 'fee already known: no second lookup')
    const other = await handler(signedEvent(evt('evt_b4', 'charge.updated', { id: 'ch_zz', object: 'charge', status: 'succeeded', balance_transaction: 'txn_9' }), WH))
    assert.match(other.body, /not ours/)
  } finally { fb.restore() }
})

test('webhook: a refund fills a missing fee (Stripe keeps it) and the refund row has none', async () => {
  const charges: Record<string, Charge> = { ch_1: new Error('timeout') }
  const fb = backend(charges)
  try {
    const { handler } = require('../netlify/functions/stripe-webhook.cjs')
    await handler(signedEvent(evt('evt_p1', 'payment_intent.succeeded', pi()), WH))
    charges.ch_1 = { id: 'ch_1', balance_transaction: bt(2930, 97070) }
    const r = await handler(signedEvent(evt('evt_r1', 'charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount_refunded: 10000 }), WH))
    assert.equal(r.statusCode, 200, r.body)
    assert.equal(payment(fb).stripe_fee, 29.3)
    const refund = fb.table('client_payments').find(p => p.kind === 'refund')!
    assert.deepEqual([refund.amount, refund.stripe_fee], [-100, undefined])
    assert.equal(feeSummary(fb.table('client_payments').map(p => ({ amount: Number(p.amount), source: String(p.source), kind: String(p.kind), stripeFee: p.stripe_fee as number | undefined }))).fees, 29.3)
  } finally { fb.restore() }
})

const call = (token: string | null, body: object = {}) => ({ httpMethod: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) })

test('stripe-fees ("Fill missing fees"): CEO only; fills empty Stripe fees (by charge, or via the payment intent), leaves the rest', async () => {
  const fb = backend({ ch_a: { id: 'ch_a', balance_transaction: bt(2930, 97070) }, ch_b: { id: 'ch_b', balance_transaction: null }, 'for:pi_c': { id: 'ch_c', balance_transaction: bt(100, 4900) } })
  fb.db.client_payments = [
    { id: 'p1', invoice_id: INV, amount: 1000, source: 'stripe', kind: 'payment', external_ref: 'pi_a', stripe_charge_id: 'ch_a', paid_on: '2026-11-02' },
    { id: 'p2', invoice_id: INV, amount: 1000, source: 'stripe', kind: 'payment', external_ref: 'pi_b', stripe_charge_id: 'ch_b', paid_on: '2026-11-01' },
    { id: 'p3', invoice_id: INV, amount: 50, source: 'stripe', kind: 'payment', external_ref: 'pi_c', stripe_charge_id: null, paid_on: '2026-10-30' },
    { id: 'p4', invoice_id: INV, amount: 10, source: 'stripe', kind: 'payment', external_ref: 'pi_d', stripe_charge_id: 'ch_d', stripe_fee: 0.59, paid_on: '2026-10-29' },
    { id: 'p5', invoice_id: INV, amount: 70, source: 'manual', kind: 'payment', paid_on: '2026-11-02' },
  ]
  try {
    const { handler } = require('../netlify/functions/stripe-fees.cjs')
    assert.equal((await handler(call(null))).statusCode, 401)
    assert.equal((await handler(call('tok-acc'))).statusCode, 403)
    assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 405)
    const r = await handler(call('tok-ceo'))
    assert.equal(r.statusCode, 200, r.body)
    assert.deepEqual(JSON.parse(r.body), { checked: 3, filled: 2, waiting: 1, failed: 0, missing: 1 })
    const by = (id: string) => fb.table('client_payments').find(p => p.id === id)!
    assert.deepEqual([by('p1').stripe_fee, by('p2').stripe_fee, by('p3').stripe_fee, by('p3').stripe_charge_id, by('p4').stripe_fee, by('p5').stripe_fee],
      [29.3, undefined, 1, 'ch_c', 0.59, undefined])
    assert.equal(fb.stripeCalls.some(c => c.path.startsWith('/charges/ch_d')), false, 'a known fee is never looked up')
    const ranged = await handler(call('tok-ceo', { from: '2026-11-02', to: '2026-11-30' }))
    assert.deepEqual(JSON.parse(ranged.body).checked, 0, 'only the period asked for')
  } finally { fb.restore() }
})
