/**
 * stripe-webhook — Netlify Function
 *
 * Handles Stripe webhook events to keep invoice status in sync.
 * Verifies the webhook signature before processing.
 *
 * POST /.netlify/functions/stripe-webhook
 * (Called by Stripe — not by the app)
 *
 * Handles:
 *   payment_intent.succeeded → mark invoice paid in Supabase
 *   payment_intent.payment_failed → record failed attempt for internal follow-up
 *
 * Required Netlify env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_WEBHOOK_SECRET  — whsec_xxx from Stripe dashboard webhook settings
 *   STRIPE_SECRET_KEY      — optional here; used to fetch card brand/last4
 */

const crypto = require('crypto')

// ── Stripe signature verification (uses built-in crypto — no stripe npm pkg) ──

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false

  const pairs = {}
  sigHeader.split(',').forEach(part => {
    const eq = part.indexOf('=')
    const k  = part.slice(0, eq).trim()
    const v  = part.slice(eq + 1).trim()
    if (!pairs[k]) pairs[k] = []
    pairs[k].push(v)
  })

  const timestamp  = pairs.t?.[0]
  const signatures = pairs.v1 || []
  if (!timestamp || signatures.length === 0) return false

  const signedPayload = `${timestamp}.${rawBody}`
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex')

  return signatures.some(sig => {
    try {
      const a = Buffer.from(sig,      'hex')
      const b = Buffer.from(expected, 'hex')
      return a.length === b.length && crypto.timingSafeEqual(a, b)
    } catch { return false }
  })
}

// ── Supabase REST helper ──────────────────────────────────────────────────────

async function supabasePatch(table, filter, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${key}`, apikey: key,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  return res.ok
}

function enc(value) {
  return encodeURIComponent(String(value ?? ''))
}

async function supabasePatchRows(table, filter, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return []
  return res.json()
}

async function supabaseInsert(table, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase INSERT ${table} failed: ${res.status}`)
}

async function recordPaymentAttempt(row) {
  try {
    const now = new Date().toISOString()
    const body = { ...row, updated_at: now }
    if (row.stripe_payment_intent_id) {
      const updated = await supabasePatchRows(
        'payment_attempts',
        `stripe_payment_intent_id=eq.${enc(row.stripe_payment_intent_id)}`,
        body
      )
      if (Array.isArray(updated) && updated.length > 0) return
    }
    await supabaseInsert('payment_attempts', {
      ...body,
      attempted_at: row.attempted_at || now,
    })
  } catch (err) {
    console.warn('stripe-webhook: payment_attempts write skipped', err?.message || err)
  }
}

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      Accept: 'application/json',
    },
  })
  if (!res.ok) return []
  return res.json()
}

async function stripeGet(path) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': '2024-06-20',
    },
  })
  if (!res.ok) return null
  return res.json()
}

function paymentActivityNote({ source, status, invoiceNumber, amount, failureReason, paymentIntentId }) {
  const label = source === 'autopay' ? 'AutoPay' : 'Portal payment'
  const invoiceLabel = invoiceNumber ? ` for invoice ${invoiceNumber}` : ''
  const amountLabel = Number.isFinite(Number(amount)) ? ` (${Number(amount).toFixed(2)} USD)` : ''
  const base = status === 'succeeded'
    ? `${label} succeeded${invoiceLabel}${amountLabel}.`
    : `${label} failed${invoiceLabel}${amountLabel}.${failureReason ? ` ${failureReason}` : ''}`
  return paymentIntentId ? `${base} Stripe payment: ${paymentIntentId}` : base
}

async function logPaymentActivity(clientId, note) {
  if (!clientId || !note) return
  try {
    const existing = await supabaseGet(`activity_log?client_id=eq.${enc(clientId)}&note=eq.${enc(note)}&select=id&limit=1`)
    if (Array.isArray(existing) && existing.length > 0) return
    await supabaseInsert('activity_log', {
      id: crypto.randomUUID(),
      client_id: clientId,
      note,
      created_at: Date.now(),
      type: 'system',
      auto: true,
    })
  } catch (err) {
    console.warn('stripe-webhook: activity_log write skipped', err?.message || err)
  }
}

async function updateClientCardMetadata(clientId, paymentMethodId) {
  if (!clientId || !paymentMethodId) return
  try {
    const pm = await stripeGet(`/payment_methods/${paymentMethodId}`)
    const card = pm?.card
    if (!card) return
    await supabasePatch('client_users', `client_id=eq.${enc(clientId)}`, {
      default_payment_method_id: paymentMethodId,
      default_card_brand: card.brand || null,
      default_card_last4: card.last4 || null,
      default_card_exp_month: card.exp_month || null,
      default_card_exp_year: card.exp_year || null,
    })
  } catch (err) {
    console.warn('stripe-webhook: card metadata update skipped', err?.message || err)
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_WEBHOOK_SECRET } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error('stripe-webhook: missing env vars')
    return { statusCode: 500, body: 'Missing env vars' }
  }

  // ── Verify signature ──────────────────────────────────────────────────────
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature']
  if (!verifyStripeSignature(event.body, sig, STRIPE_WEBHOOK_SECRET)) {
    console.error('stripe-webhook: invalid signature')
    return { statusCode: 400, body: 'Webhook signature verification failed' }
  }

  // ── Parse event ───────────────────────────────────────────────────────────
  let stripeEvent
  try {
    stripeEvent = JSON.parse(event.body)
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' }
  }

  const type   = stripeEvent.type
  const obj    = stripeEvent.data?.object

  console.log(`stripe-webhook: received ${type}`)

  // ── Handle events ─────────────────────────────────────────────────────────

  if (type === 'payment_intent.succeeded') {
    const invoiceId  = obj?.metadata?.invoiceId
    const clientId   = obj?.metadata?.clientId
    const amountPaid = (obj?.amount_received ?? 0) / 100  // cents → USD

    if (!invoiceId) {
      console.warn('stripe-webhook: payment_intent.succeeded has no invoiceId in metadata')
      return { statusCode: 200, body: JSON.stringify({ received: true }) }
    }

    const invoiceRows = await supabaseGet(`invoices?id=eq.${invoiceId}&select=subtotal,amount_paid,client_name,number`)
    const invoice = Array.isArray(invoiceRows) ? invoiceRows[0] : null
    const totalPaid = invoice?.subtotal != null
      ? Number(invoice.subtotal)
      : amountPaid

    if (clientId) {
      await recordPaymentAttempt({
        invoice_id:               invoiceId,
        client_id:                clientId,
        client_name:              invoice?.client_name || null,
        invoice_number:           obj?.metadata?.invoiceNumber || invoice?.number || null,
        stripe_payment_intent_id: obj?.id || null,
        stripe_customer_id:       obj?.customer || null,
        stripe_payment_method_id: obj?.payment_method || null,
        amount:                   amountPaid,
        currency:                 obj?.currency || 'usd',
        source:                   obj?.metadata?.autoPay === 'true' ? 'autopay' : 'portal',
        status:                   'succeeded',
        failure_reason:           null,
      })
      await updateClientCardMetadata(clientId, obj?.payment_method)
      await logPaymentActivity(clientId, paymentActivityNote({
        source: obj?.metadata?.autoPay === 'true' ? 'autopay' : 'portal',
        status: 'succeeded',
        invoiceNumber: obj?.metadata?.invoiceNumber || invoice?.number || null,
        amount: amountPaid,
        paymentIntentId: obj?.id,
      }))
    }

    const ok = await supabasePatch('invoices', `id=eq.${invoiceId}`, {
      status:      'paid',
      amount_paid: totalPaid,
    })

    if (ok) {
      console.log(`stripe-webhook: marked invoice ${invoiceId} as paid ($${amountPaid})`)
    } else {
      console.error(`stripe-webhook: failed to update invoice ${invoiceId}`)
    }
  }

  if (type === 'payment_intent.payment_failed') {
    const invoiceId = obj?.metadata?.invoiceId
    const clientId  = obj?.metadata?.clientId
    if (invoiceId && clientId) {
      await recordPaymentAttempt({
        invoice_id:               invoiceId,
        client_id:                clientId,
        invoice_number:           obj?.metadata?.invoiceNumber || null,
        stripe_payment_intent_id: obj?.id || null,
        stripe_customer_id:       obj?.customer || null,
        stripe_payment_method_id: obj?.payment_method || null,
        amount:                   (obj?.amount ?? obj?.amount_received ?? 0) / 100,
        currency:                 obj?.currency || 'usd',
        source:                   obj?.metadata?.autoPay === 'true' ? 'autopay' : 'portal',
        status:                   'failed',
        failure_reason:           obj?.last_payment_error?.message || 'Stripe payment failed',
      })
      await logPaymentActivity(clientId, paymentActivityNote({
        source: obj?.metadata?.autoPay === 'true' ? 'autopay' : 'portal',
        status: 'failed',
        invoiceNumber: obj?.metadata?.invoiceNumber || null,
        amount: (obj?.amount ?? obj?.amount_received ?? 0) / 100,
        failureReason: obj?.last_payment_error?.message || 'Stripe payment failed',
        paymentIntentId: obj?.id,
      }))
    }
  }

  // Always return 200 so Stripe doesn't retry
  return { statusCode: 200, body: JSON.stringify({ received: true }) }
}
