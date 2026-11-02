/**
 * refund-payment — refund a Stripe card/bank payment, fully or in part, from YVA OS.
 *
 * POST /.netlify/functions/refund-payment   Authorization: Bearer <staff token>
 * Body: { paymentId, requestId (new uuid per click), amount?: number (USD, default = everything still refundable), reason?: string }
 * → { ok, refundId, status, amount }
 *
 * Needs the `payments.refund` permission (CEO always). The amount is checked against what that payment still
 * has (minus earlier refunds and money a dispute took back). The refund row itself is written by
 * stripe-webhook (charge.refunded), so the invoice balance follows the same path as every other money change.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */
const { rest, enc, json, callerFromEvent, hasPermission } = require('./_lib/supa.cjs')
const { stripe } = require('./_lib/stripe.cjs')
const P = require('./_lib/payments.cjs')

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Stripe is not set up yet.' })
  try {
    const user = await callerFromEvent(event)
    if (!user) return json(401, { error: 'Please sign in again.' })
    if (!(await hasPermission(user.id, 'payments.refund'))) return json(403, { error: 'You need the "Refund card/bank payments" permission.' })
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }
    if (!/^[0-9a-f-]{36}$/i.test(String(body.paymentId || ''))) return json(400, { error: 'paymentId is required' })
    // One id per click: a retried request is the same refund; a second, deliberate refund is a new one
    if (!/^[0-9a-f-]{36}$/i.test(String(body.requestId || ''))) return json(400, { error: 'requestId is required' })
    const pay = (await rest(`client_payments?id=eq.${enc(body.paymentId)}&select=id,invoice_id,client_id,amount,source,kind,external_ref,stripe_charge_id&limit=1`))?.[0]
    if (!pay) return json(404, { error: 'Payment not found' })
    if (pay.source !== 'stripe' || (pay.kind && pay.kind !== 'payment') || !/^pi_/.test(pay.external_ref || '')) return json(400, { error: 'Only card or bank payments made through Stripe can be refunded here. Refund other payments the way they were paid.' })
    const taken = pay.stripe_charge_id
      ? await rest(`client_payments?stripe_charge_id=eq.${enc(pay.stripe_charge_id)}&kind=in.(refund,dispute)&select=amount`)
      : []
    const left = P.centsFromUSD(pay.amount) + (taken || []).reduce((s, r) => s + P.centsFromUSD(r.amount), 0)
    const cents = body.amount == null ? left : P.centsFromUSD(body.amount)
    if (!Number.isInteger(cents) || cents <= 0) return json(400, { error: 'Enter an amount above $0.' })
    if (cents > left) return json(400, { error: `Only $${(left / 100).toFixed(2)} of this payment can still be refunded.` })
    const refund = await stripe('POST', '/refunds', {
      payment_intent: pay.external_ref, amount: cents, reason: 'requested_by_customer',
      metadata: { paymentId: pay.id, invoiceId: pay.invoice_id, by: user.id, note: String(body.reason || '').slice(0, 200) },
    }, { idempotencyKey: `refund-${pay.id}-${body.requestId}` })
    // Who did it, in the change history (as the signed-in person, so the actor is stamped by the database)
    const h = event.headers || {}
    await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/log_action`, {
      method: 'POST',
      headers: { Authorization: h.authorization || h.Authorization, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kind: 'payment_refunded', p_label: `Refunded $${(cents / 100).toFixed(2)} of a Stripe payment`, p_table: 'client_payments', p_record: pay.id, p_details: { amount: cents / 100, refund: refund.id, reason: body.reason || null } }),
    }).catch(() => {})
    return json(200, { ok: true, refundId: refund.id, status: refund.status, amount: cents / 100 })
  } catch (err) {
    console.error('refund-payment:', err.message)
    return json(err.name === 'StripeError' && err.status < 500 ? 400 : 500, { error: err.name === 'StripeError' ? `Stripe: ${err.message}` : 'Could not refund the payment.' })
  }
}
