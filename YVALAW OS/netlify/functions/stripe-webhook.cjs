/**
 * stripe-webhook — called by Stripe (POST /.netlify/functions/stripe-webhook), never by the app.
 *
 * Safety rules (2026-11, supabase/migrate-stripe-secure.sql):
 *  - Signature checked (HMAC-SHA256, timing-safe, 5-minute window). Events from the other mode (test vs live
 *    key) are ignored.
 *  - Each event is claimed once in public.stripe_events. If recording fails we answer 500 so Stripe retries
 *    (it retries for 3 days); a retry of an event already processed is answered 200 and skipped.
 *  - Money moves only through public.client_payments (one row per Stripe payment, refund or dispute — unique
 *    external_ref). The database trigger keeps the invoice's amount paid and status in step, so partial
 *    payments, refunds and overpayments stay visible. The invoice is never overwritten here.
 *
 * Events (add them all to the Stripe webhook endpoint — SETUP-AFTER-BUILD.md):
 *   payment_intent.succeeded / processing / payment_failed / requires_action / canceled
 *   charge.refunded
 *   charge.dispute.created / funds_withdrawn / funds_reinstated / closed
 *   setup_intent.succeeded
 *   payment_method.detached / payment_method.automatically_updated / payment_method.updated
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY
 */
const crypto = require('crypto')
const { rest, enc } = require('./_lib/supa.cjs')
const { stripe, keyMode } = require('./_lib/stripe.cjs')
const P = require('./_lib/payments.cjs')
const { notifyPermission } = require('./_lib/notify.cjs')

const SIGNATURE_TOLERANCE_SECONDS = 300
const BUSINESS_TZ = 'America/Santo_Domingo'

function verifyStripeSignature(rawBody, sigHeader, secret, nowMs = Date.now()) {
  if (!sigHeader || !secret || typeof rawBody !== 'string') return false
  let timestamp = ''
  const signatures = []
  for (const part of String(sigHeader).split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 't' && !timestamp) timestamp = v
    else if (k === 'v1') signatures.push(v)
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return false
  const age = Math.abs(nowMs / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  return signatures.some(sig => {
    try {
      const a = Buffer.from(sig, 'hex'), b = Buffer.from(expected, 'hex')
      return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
    } catch { return false }
  })
}

const todayInBusiness = () => new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TZ })
const usd = cents => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const sourceOf = pi => (pi?.metadata?.autoPay === 'true' ? 'autopay' : pi?.metadata?.source === 'pay_link' ? 'pay_link' : 'portal')
const LABEL = { autopay: 'AutoPay', pay_link: 'Pay-link payment', portal: 'Portal payment' }
const missingTable = e => e && (e.status === 404 || /does not exist|Could not find the table|42P01/i.test(e.message || ''))
const missingColumn = e => /Could not find the '([^']+)' column/i.exec(e?.message || '')?.[1]

// ── Small writers (audit trail rows are best effort; money rows must succeed) ────────────────────────────────
async function saveAttempt(row) {
  try {
    const now = new Date().toISOString()
    const body = { ...row, updated_at: now }
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k]
    if (row.stripe_payment_intent_id) {
      const updated = await rest(`payment_attempts?stripe_payment_intent_id=eq.${enc(row.stripe_payment_intent_id)}`, { method: 'PATCH', body, prefer: 'return=representation' })
      if (updated?.length) return
    }
    if (!body.client_id) return
    await rest('payment_attempts', { method: 'POST', body: { ...body, attempted_at: now }, prefer: 'return=minimal' })
  } catch (err) {
    console.warn('stripe-webhook: payment_attempts write skipped —', err.message)
  }
}

async function logActivity(clientId, note) {
  if (!clientId || !note) return
  try {
    const existing = await rest(`activity_log?client_id=eq.${enc(clientId)}&note=eq.${enc(note)}&select=id&limit=1`)
    if (existing?.length) return
    await rest('activity_log', { method: 'POST', prefer: 'return=minimal', body: { id: crypto.randomUUID(), client_id: clientId, note, created_at: Date.now(), type: 'system', auto: true } })
  } catch (err) { console.warn('stripe-webhook: activity_log write skipped —', err.message) }
}

async function tell(kind, title, body, link = '/invoice') {
  try { await notifyPermission('payments.record', { kind, title, body, link }) } catch (err) { console.warn('stripe-webhook: notify skipped —', err.message) }
}

/** Insert one money row; a Stripe retry of the same thing is ignored (unique external_ref). Returns true if new. */
async function insertMoneyRow(row) {
  let body = { ...row }
  for (let i = 0; i < 4; i++) {
    try {
      const out = await rest('client_payments?on_conflict=external_ref', { method: 'POST', body, prefer: 'resolution=ignore-duplicates,return=representation' })
      return Array.isArray(out) && out.length > 0
    } catch (err) {
      const col = missingColumn(err)
      // Before migrate-stripe-secure.sql: payments still record (refunds/disputes need the script)
      if (col && (col === 'kind' || col === 'stripe_charge_id') && body.kind !== 'refund' && body.kind !== 'dispute') { delete body[col]; continue }
      throw err
    }
  }
  throw new Error('client_payments insert failed')
}

async function loadMethod(pmId) {
  if (!pmId || typeof pmId !== 'string') return null
  try { return P.methodSummary(await stripe('GET', `/payment_methods/${enc(pmId)}`)) } catch { return null }
}

async function portalRowByCustomer(customerId) {
  if (!customerId) return null
  const rows = await rest(`client_users?stripe_customer_id=eq.${enc(customerId)}&select=id,client_id,default_payment_method_id,auto_pay_enabled,autopay_failures&limit=1`).catch(() => [])
  return rows?.[0] || null
}

async function findPayment({ chargeId, paymentIntentId }) {
  const ors = []
  if (chargeId) ors.push(`stripe_charge_id.eq.${chargeId}`)
  if (paymentIntentId) ors.push(`external_ref.eq.${paymentIntentId}`)
  if (!ors.length) return null
  const rows = await rest(`client_payments?source=eq.stripe&kind=eq.payment&or=(${ors.map(o => o.replace(/[(),]/g, '')).join(',')})&select=id,invoice_id,client_id,amount,method,external_ref,stripe_charge_id&limit=1`)
  return rows?.[0] || null
}

// ── PaymentIntents ───────────────────────────────────────────────────────────
async function attemptFromPI(pi, status, extra = {}) {
  const md = pi.metadata || {}
  await saveAttempt({
    invoice_id: md.invoiceId || null,
    client_id: md.clientId || undefined,
    invoice_number: md.invoiceNumber || undefined,
    stripe_payment_intent_id: pi.id,
    stripe_customer_id: typeof pi.customer === 'string' ? pi.customer : undefined,
    stripe_payment_method_id: typeof pi.payment_method === 'string' ? pi.payment_method : undefined,
    amount: (pi.amount_received || pi.amount || 0) / 100,
    currency: pi.currency || 'usd',
    source: sourceOf(pi),
    status,
    ...extra,
  })
}

async function onSucceeded(pi) {
  const md = pi.metadata || {}
  if (!md.invoiceId) return 'not ours'
  const cents = Number(pi.amount_received || 0)
  if (String(pi.currency).toLowerCase() !== 'usd') {
    await tell('payment_problem', `Stripe payment in ${String(pi.currency).toUpperCase()} not applied`, `Payment ${pi.id} for invoice ${md.invoiceNumber || md.invoiceId} was not in USD. Check it in Stripe.`)
    return 'wrong currency'
  }
  const inv = (await rest(`invoices?id=eq.${enc(md.invoiceId)}&select=id,number,client_id,client_name,subtotal,amount_paid,status&limit=1`))?.[0]
  if (!inv) {
    await tell('payment_problem', 'Stripe payment for an invoice that no longer exists', `Payment ${pi.id} (${usd(cents)}) names invoice ${md.invoiceNumber || md.invoiceId}, which isn't in YVA OS. Record it by hand or refund it in Stripe.`)
    return 'invoice missing'
  }
  const method = await loadMethod(pi.payment_method)
  const type = method?.type || (Array.isArray(pi.payment_method_types) && pi.payment_method_types.length === 1 ? pi.payment_method_types[0] : 'card')
  const source = sourceOf(pi)
  const balanceBefore = P.balanceCents(inv)
  const isNew = cents > 0 && await insertMoneyRow({
    invoice_id: inv.id, client_id: inv.client_id || md.clientId || null, amount: cents / 100, method: P.methodWord(type),
    source: 'stripe', kind: 'payment', external_ref: pi.id, reference: pi.id,
    stripe_charge_id: typeof pi.latest_charge === 'string' ? pi.latest_charge : null,
    paid_on: todayInBusiness(), note: LABEL[source], created_by: null,
  })
  await attemptFromPI(pi, 'succeeded', { payment_method_type: type, failure_reason: null, client_id: md.clientId || inv.client_id || undefined })
  if (isNew && cents > balanceBefore) {
    await tell('payment_problem', `Invoice ${inv.number} overpaid by ${usd(cents - Math.max(0, balanceBefore))}`,
      `Stripe collected ${usd(cents)} but only ${usd(Math.max(0, balanceBefore))} was owed (another payment arrived first). Refund the difference in YVA OS → Invoices → Payments, or keep it as credit.`)
  }
  // Save the method for next time only when the payer asked for it, and only if they have none yet
  // (AutoPay never switches to another card or account on its own)
  const row = await portalRowByCustomer(pi.customer)
  if (row) {
    const patch = {}
    if (pi.setup_future_usage && method && !row.default_payment_method_id) Object.assign(patch, P.savedMethodColumns(method))
    if (source === 'autopay' && row.autopay_failures) patch.autopay_failures = 0
    if (Object.keys(patch).length) await rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }).catch(e => console.warn('saved method skipped —', e.message))
  }
  await logActivity(inv.client_id || md.clientId, `${LABEL[source]} received for invoice ${inv.number} (${usd(cents)}${type === 'us_bank_account' ? ', bank' : ''}). Stripe: ${pi.id}`)
  return isNew ? 'recorded' : 'already recorded'
}

async function onProcessing(pi) {
  if (!pi.metadata?.invoiceId) return 'not ours'
  await attemptFromPI(pi, 'processing', { payment_method_type: 'us_bank_account' })
  await logActivity(pi.metadata.clientId, `Bank payment started for invoice ${pi.metadata.invoiceNumber || ''} (${usd(pi.amount || 0)}) — clears in about 4 business days. Stripe: ${pi.id}`)
  return 'processing'
}

async function onFailed(pi) {
  const md = pi.metadata || {}
  if (!md.invoiceId) return 'not ours'
  const reason = pi.last_payment_error?.message || 'The payment was declined.'
  const type = pi.last_payment_error?.payment_method?.type || undefined
  await attemptFromPI(pi, 'failed', { failure_reason: reason.slice(0, 500), payment_method_type: type })
  const source = sourceOf(pi)
  if (source === 'autopay') {
    const row = await portalRowByCustomer(pi.customer)
    if (row) await rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { autopay_failures: (row.autopay_failures || 0) + 1, autopay_last_failed_at: new Date().toISOString() } }).catch(() => {})
  }
  const lastTry = source === 'autopay' && Number(md.try) >= P.AUTOPAY_MAX_TRIES
  if (source === 'autopay' || type === 'us_bank_account') {
    await tell('payment_failed', `${lastTry ? 'AutoPay stopped trying' : source === 'autopay' ? 'AutoPay failed' : 'Bank payment failed'}: invoice ${md.invoiceNumber || ''}`,
      `${usd(pi.amount || 0)} — ${reason}${lastTry ? ` This was try ${md.try}; AutoPay won't charge this invoice again. Ask the client to update their payment method in the portal or send the invoice email with its Pay now link.` : ''}`)
  }
  await logActivity(md.clientId, `${LABEL[source]} failed for invoice ${md.invoiceNumber || ''} (${usd(pi.amount || 0)}). ${reason} Stripe: ${pi.id}`)
  return 'failed'
}

async function onRequiresAction(pi) {
  const md = pi.metadata || {}
  if (!md.invoiceId) return 'not ours'
  await attemptFromPI(pi, 'requires_action', { failure_reason: 'The card needs the client to confirm the payment (bank security check).' })
  if (sourceOf(pi) === 'autopay') {
    await tell('payment_failed', `AutoPay needs the client: invoice ${md.invoiceNumber || ''}`, 'Their bank asked them to confirm this charge. Send them the invoice email (it has a Pay now link) or ask them to pay in the portal.')
  }
  return 'requires_action'
}

async function onCanceled(pi) {
  if (!pi.metadata?.invoiceId) return 'not ours'
  await attemptFromPI(pi, 'canceled')
  return 'canceled'
}

// ── Refunds and disputes ─────────────────────────────────────────────────────
async function onRefunded(charge) {
  const pay = await findPayment({ chargeId: charge.id, paymentIntentId: typeof charge.payment_intent === 'string' ? charge.payment_intent : null })
  if (!pay) return 'not ours'
  const prior = await rest(`client_payments?stripe_charge_id=eq.${enc(charge.id)}&kind=eq.refund&select=amount`)
  const recordedCents = -(prior || []).reduce((s, r) => s + P.centsFromUSD(r.amount), 0)
  const diff = Number(charge.amount_refunded || 0) - recordedCents
  if (diff <= 0) return 'already recorded'
  await insertMoneyRow({
    invoice_id: pay.invoice_id, client_id: pay.client_id, amount: -diff / 100, method: pay.method, source: 'stripe', kind: 'refund',
    external_ref: `refund:${charge.id}:${charge.amount_refunded}`, reference: charge.id, stripe_charge_id: charge.id,
    paid_on: todayInBusiness(), note: 'Refund (Stripe)', created_by: null,
  })
  await logActivity(pay.client_id, `Refund of ${usd(diff)} sent through Stripe. Charge: ${charge.id}`)
  return 'refund recorded'
}

async function onDispute(type, d) {
  const pay = await findPayment({ chargeId: typeof d.charge === 'string' ? d.charge : null, paymentIntentId: typeof d.payment_intent === 'string' ? d.payment_intent : null })
  if (!pay) {
    if (type === 'charge.dispute.created') await tell('payment_disputed', 'Stripe dispute opened', `Dispute ${d.id} for ${usd(d.amount || 0)}. Answer it in Stripe before the deadline.`)
    return 'not ours'
  }
  const ref = `dispute:${d.id}`
  if (type === 'charge.dispute.created') {
    const due = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'soon'
    await tell('payment_disputed', `Client disputed a payment (${usd(d.amount || 0)})`, `Reason: ${d.reason || 'not given'}. Send your evidence in Stripe → Disputes by ${due}.`)
    await logActivity(pay.client_id, `Client's bank opened a dispute for ${usd(d.amount || 0)} (${d.reason || 'no reason given'}). Stripe: ${d.id}`)
    return 'dispute noted'
  }
  if (type === 'charge.dispute.funds_withdrawn') {
    await insertMoneyRow({
      invoice_id: pay.invoice_id, client_id: pay.client_id, amount: -Number(d.amount || 0) / 100, method: pay.method, source: 'stripe', kind: 'dispute',
      external_ref: ref, reference: d.id, stripe_charge_id: pay.stripe_charge_id || (typeof d.charge === 'string' ? d.charge : null),
      paid_on: todayInBusiness(), note: 'Dispute — money taken back', created_by: null,
    })
    return 'dispute withdrawn'
  }
  if (type === 'charge.dispute.funds_reinstated') {
    await rest(`client_payments?external_ref=eq.${enc(ref)}`, { method: 'DELETE', prefer: 'return=minimal' })
    await logActivity(pay.client_id, `Dispute ${d.id} won — the money came back.`)
    return 'dispute reinstated'
  }
  if (type === 'charge.dispute.closed') {
    await tell('payment_disputed', `Dispute ${d.status === 'won' ? 'won' : d.status === 'lost' ? 'lost' : 'closed'} (${usd(d.amount || 0)})`, `Stripe dispute ${d.id} is ${d.status}.`)
    return 'dispute closed'
  }
  return 'ignored'
}

// ── Saved methods ────────────────────────────────────────────────────────────
async function onSetupSucceeded(si) {
  const md = si.metadata || {}
  if (!md.clientUserId || typeof si.payment_method !== 'string') return 'not ours'
  const row = (await rest(`client_users?id=eq.${enc(md.clientUserId)}&stripe_customer_id=eq.${enc(si.customer)}&select=id&limit=1`))?.[0]
  if (!row) return 'unknown customer'
  const method = await loadMethod(si.payment_method)
  if (!method) throw new Error('Could not read the saved payment method from Stripe')
  const patch = { ...P.savedMethodColumns(method), autopay_failures: 0 }
  if (md.autopay === 'true') Object.assign(patch, { auto_pay_enabled: true, auto_pay_authorized_at: new Date().toISOString(), auto_pay_disabled_at: null })
  await rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' })
  return 'method saved'
}

async function onMethodDetached(pm) {
  await rest(`client_users?default_payment_method_id=eq.${enc(pm.id)}`, { method: 'PATCH', prefer: 'return=minimal',
    body: { ...P.savedMethodColumns(null), auto_pay_enabled: false, auto_pay_disabled_at: new Date().toISOString() } })
  return 'method cleared'
}

async function onMethodUpdated(pm) {
  const summary = P.methodSummary(pm)
  if (!summary) return 'ignored'
  await rest(`client_users?default_payment_method_id=eq.${enc(pm.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: P.savedMethodColumns(summary) })
  return 'method updated'
}

async function handle(type, obj) {
  switch (type) {
    case 'payment_intent.succeeded':       return onSucceeded(obj)
    case 'payment_intent.processing':      return onProcessing(obj)
    case 'payment_intent.payment_failed':  return onFailed(obj)
    case 'payment_intent.requires_action': return onRequiresAction(obj)
    case 'payment_intent.canceled':        return onCanceled(obj)
    case 'charge.refunded':                return onRefunded(obj)
    case 'charge.dispute.created':
    case 'charge.dispute.funds_withdrawn':
    case 'charge.dispute.funds_reinstated':
    case 'charge.dispute.closed':          return onDispute(type, obj)
    case 'setup_intent.succeeded':         return onSetupSucceeded(obj)
    case 'payment_method.detached':        return onMethodDetached(obj)
    case 'payment_method.automatically_updated':
    case 'payment_method.updated':         return onMethodUpdated(obj)
    default:                               return 'ignored'
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_WEBHOOK_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error('stripe-webhook: missing env vars')
    return { statusCode: 500, body: 'Missing env vars' }
  }
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '')
  const h = event.headers || {}
  if (!verifyStripeSignature(raw, h['stripe-signature'] || h['Stripe-Signature'], STRIPE_WEBHOOK_SECRET)) {
    return { statusCode: 400, body: 'Webhook signature verification failed' }
  }
  let evt
  try { evt = JSON.parse(raw) } catch { return { statusCode: 400, body: 'Invalid JSON' } }
  if (!evt?.id || !evt.type) return { statusCode: 400, body: 'Not a Stripe event' }

  // A test-mode event must never touch live data (and the other way round)
  const mode = keyMode()
  if (mode && (evt.livemode ? 'live' : 'test') !== mode) return { statusCode: 200, body: JSON.stringify({ ignored: 'other mode' }) }

  const obj = evt.data?.object || {}
  let claimed = true
  try {
    const rows = await rest('stripe_events?on_conflict=id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
      body: { id: evt.id, type: evt.type, livemode: !!evt.livemode, object_id: obj.id || null } })
    if (!rows?.length) {
      const prev = (await rest(`stripe_events?id=eq.${enc(evt.id)}&select=processed_at&limit=1`))?.[0]
      if (prev?.processed_at) return { statusCode: 200, body: JSON.stringify({ duplicate: true }) }
    }
  } catch (err) {
    if (!missingTable(err)) { console.error('stripe-webhook: claim failed —', err.message); return { statusCode: 500, body: 'Try again' } }
    claimed = false   // migrate-stripe-secure.sql not run yet: every handler below is safe to repeat anyway
  }

  try {
    const result = await handle(evt.type, obj)
    if (claimed) await rest(`stripe_events?id=eq.${enc(evt.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { processed_at: new Date().toISOString(), error: null } }).catch(() => {})
    return { statusCode: 200, body: JSON.stringify({ received: true, result }) }
  } catch (err) {
    console.error(`stripe-webhook: ${evt.type} ${evt.id} failed —`, err.message)
    if (claimed) await rest(`stripe_events?id=eq.${enc(evt.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { error: String(err.message).slice(0, 500) } }).catch(() => {})
    return { statusCode: 500, body: 'Processing failed; Stripe will retry' }
  }
}

exports._test = { verifyStripeSignature, handle }
