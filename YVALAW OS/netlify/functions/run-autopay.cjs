/**
 * run-autopay — scheduled daily (netlify.toml, 13:00 UTC = 9 am Dominican time).
 *
 * Charges due invoices for clients who turned AutoPay on (explicit consent in the portal), with their saved card
 * or US bank account. Rules (`autopayDecision` in _lib/payments.cjs, unit-tested):
 *   - only invoices with a due date that has arrived (no due date = never charged automatically)
 *   - invoices matched by client_id only (never by name — names aren't unique); invoices that had a refund or
 *     dispute are left for staff to decide
 *   - nothing while a payment for that invoice may still take money (bank payment clearing, card waiting for
 *     the client's confirmation, a success the webhook hasn't recorded yet)
 *   - at most 3 tries per invoice, 3 days apart; staff are told after the last one (stripe-webhook)
 *   - one charge per invoice per day (Stripe idempotency key), one portal login per client (the latest consent)
 * Money is recorded by stripe-webhook when Stripe confirms it — never written here.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */
const { rest, enc } = require('./_lib/supa.cjs')
const { stripe } = require('./_lib/stripe.cjs')
const P = require('./_lib/payments.cjs')

const BUSINESS_TZ = 'America/Santo_Domingo'
const TIME_BUDGET_MS = 22_000   // scheduled functions stop at 30 s; whatever is left runs tomorrow
const INV_FIELDS = 'id,number,status,subtotal,amount_paid,due_date,client_id,client_name'

async function saveAttempt(row) {
  try {
    const now = new Date().toISOString()
    const body = { ...row, updated_at: now }
    if (row.stripe_payment_intent_id) {
      const upd = await rest(`payment_attempts?stripe_payment_intent_id=eq.${enc(row.stripe_payment_intent_id)}`, { method: 'PATCH', body, prefer: 'return=representation' })
      if (upd?.length) return
    }
    await rest('payment_attempts', { method: 'POST', body: { ...body, attempted_at: now }, prefer: 'return=minimal' })
  } catch (err) { console.warn('run-autopay: attempt not recorded —', err.message) }
}

async function invoicesFor(client) {
  return rest(`invoices?client_id=eq.${enc(client.id)}&status=in.(sent,viewed,overdue,partial)&select=${INV_FIELDS}`)
}

async function run({ now = Date.now() } = {}) {
  const started = Date.now()
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ })
  const summary = { clients: 0, charged: 0, processing: 0, needsClient: 0, failed: 0, skipped: {}, unfinished: false }
  const logins = await rest('client_users?auto_pay_enabled=eq.true&default_payment_method_id=not.is.null&stripe_customer_id=not.is.null&select=id,client_id,stripe_customer_id,default_payment_method_id,default_payment_method_type,auto_pay_authorized_at&order=auto_pay_authorized_at.desc.nullslast')
  const seen = new Set()
  for (const login of logins || []) {
    if (seen.has(login.client_id)) continue
    seen.add(login.client_id)
    if (Date.now() - started > TIME_BUDGET_MS) { summary.unfinished = true; break }
    summary.clients++
    let client, invoices, attempts, refunded
    try {
      client = (await rest(`clients?id=eq.${enc(login.client_id)}&select=id,name,email&limit=1`))?.[0]
      if (!client) continue
      invoices = await invoicesFor(client)
      if (!invoices.length) continue
      const ids = invoices.map(i => enc(i.id)).join(',')
      // Fails closed: if the history can't be read, this client is skipped today
      attempts = await rest(`payment_attempts?invoice_id=in.(${ids})&select=invoice_id,status,source,attempted_at,updated_at`)
      refunded = new Set((await rest(`client_payments?invoice_id=in.(${ids})&kind=in.(refund,dispute)&select=invoice_id`).catch(err => {
        if (/kind/.test(err.message)) return []   // before migrate-stripe-secure.sql there are no refunds
        throw err
      })).map(r => String(r.invoice_id)))
    } catch (err) {
      summary.skipped.read_error = (summary.skipped.read_error || 0) + 1
      console.warn(`run-autopay: skipped client ${login.client_id} —`, err.message)
      continue
    }
    for (const inv of invoices) {
      const d = refunded.has(String(inv.id)) ? { charge: false, reason: 'refunded' }
        : P.autopayDecision({ invoice: inv, attempts: attempts.filter(a => a.invoice_id === inv.id), today, now })
      if (!d.charge) {
        summary.skipped[d.reason] = (summary.skipped[d.reason] || 0) + 1
        continue
      }
      const cents = P.balanceCents(inv)
      const type = login.default_payment_method_type === 'us_bank_account' ? 'us_bank_account' : 'card'
      const base = { invoice_id: inv.id, client_id: client.id, client_name: client.name || null, invoice_number: inv.number || null,
        stripe_customer_id: login.stripe_customer_id, stripe_payment_method_id: login.default_payment_method_id, amount: cents / 100,
        currency: 'usd', source: 'autopay', payment_method_type: type, retry_count: d.tryNumber - 1 }
      try {
        const pi = await stripe('POST', '/payment_intents', {
          amount: cents, currency: 'usd', customer: login.stripe_customer_id, payment_method: login.default_payment_method_id,
          payment_method_types: [type], off_session: 'true', confirm: 'true',
          description: `Invoice ${inv.number || inv.id} (AutoPay)`, receipt_email: client.email || undefined,
          metadata: { invoiceId: inv.id, clientId: client.id, clientUserId: login.id, invoiceNumber: inv.number || '', autoPay: 'true', source: 'autopay', try: String(d.tryNumber) },
        }, { idempotencyKey: `autopay-${inv.id}-${cents}-${today}` })
        const status = pi.status === 'succeeded' ? 'succeeded' : pi.status === 'processing' ? 'processing' : pi.status === 'requires_action' ? 'requires_action' : 'failed'
        await saveAttempt({ ...base, stripe_payment_intent_id: pi.id, status, failure_reason: status === 'failed' ? `Stripe status: ${pi.status}` : null })
        if (status === 'succeeded') summary.charged++
        else if (status === 'processing') summary.processing++
        else if (status === 'requires_action') summary.needsClient++
        else summary.failed++
      } catch (err) {
        const needsClient = err.code === 'authentication_required'
        await saveAttempt({ ...base, stripe_payment_intent_id: err.paymentIntent?.id || null, status: needsClient ? 'requires_action' : 'failed',
          failure_reason: String(err.message || 'AutoPay charge failed').slice(0, 500) })
        if (needsClient) summary.needsClient++
        else summary.failed++
      }
    }
  }
  return summary
}

exports.handler = async function handler() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'Missing required env vars' }) }
  try {
    const summary = await run()
    console.log('run-autopay', JSON.stringify(summary))
    return { statusCode: 200, body: JSON.stringify(summary) }
  } catch (err) {
    console.error('run-autopay failed:', err.message)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
exports._test = { run }
