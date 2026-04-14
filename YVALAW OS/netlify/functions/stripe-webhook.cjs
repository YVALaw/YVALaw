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
 *   payment_intent.payment_failed → no action (user sees error in modal)
 *
 * Required Netlify env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_WEBHOOK_SECRET  — whsec_xxx from Stripe dashboard webhook settings
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
    const amountPaid = (obj?.amount_received ?? 0) / 100  // cents → USD

    if (!invoiceId) {
      console.warn('stripe-webhook: payment_intent.succeeded has no invoiceId in metadata')
      return { statusCode: 200, body: JSON.stringify({ received: true }) }
    }

    const ok = await supabasePatch('invoices', `id=eq.${invoiceId}`, {
      status:      'paid',
      amount_paid: amountPaid,
    })

    if (ok) {
      console.log(`stripe-webhook: marked invoice ${invoiceId} as paid ($${amountPaid})`)
    } else {
      console.error(`stripe-webhook: failed to update invoice ${invoiceId}`)
    }
  }

  // Always return 200 so Stripe doesn't retry
  return { statusCode: 200, body: JSON.stringify({ received: true }) }
}
