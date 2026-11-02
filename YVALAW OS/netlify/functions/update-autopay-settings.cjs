/**
 * update-autopay-settings — portal client saves a payment method and/or turns AutoPay on or off.
 *
 * POST /.netlify/functions/update-autopay-settings   Authorization: Bearer <portal user token>
 * Body: { clientId, enabled: boolean, paymentMethodId? }
 *   enabled false                → AutoPay off (the saved method stays)
 *   enabled true + method id     → that method (must belong to this login's Stripe customer) becomes the saved
 *                                  method and AutoPay is on (the client ticked the consent box)
 *   enabled true, no method id   → AutoPay on with the method already saved
 *   saveOnly: true + method id   → just save the method, AutoPay unchanged
 * → { ok, autoPayEnabled, method }
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */
const { rest, enc, json } = require('./_lib/supa.cjs')
const { stripe } = require('./_lib/stripe.cjs')
const P = require('./_lib/payments.cjs')
const { portalCaller } = require('./_lib/portalBilling.cjs')

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }
  const { clientId, enabled, paymentMethodId } = body
  const saveOnly = body.saveOnly === true
  if (typeof enabled !== 'boolean' && !saveOnly) return json(400, { error: 'enabled is required' })
  try {
    const who = await portalCaller(event, clientId)
    if (who.error) return who.error
    const { row } = who
    const now = new Date().toISOString()

    if (!saveOnly && enabled === false) {
      await rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { auto_pay_enabled: false, auto_pay_disabled_at: now } })
      return json(200, { ok: true, autoPayEnabled: false })
    }

    let method = null
    if (paymentMethodId) {
      if (!/^pm_[A-Za-z0-9]+$/.test(String(paymentMethodId))) return json(400, { error: 'Invalid payment method' })
      if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Online payments are not set up yet.' })
      if (!row.stripe_customer_id) return json(409, { error: 'Add the payment method again — your billing profile was not ready.' })
      const pm = await stripe('GET', `/payment_methods/${enc(paymentMethodId)}`)
      const owner = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
      if (owner !== row.stripe_customer_id) return json(403, { error: 'That payment method does not belong to this login.' })
      if (pm.type !== 'card' && pm.type !== 'us_bank_account') return json(400, { error: 'Use a card or a US bank account.' })
      method = P.methodSummary(pm)
    } else if (!row.default_payment_method_id) {
      return json(400, { error: 'Add a card or bank account first.' })
    }

    const patch = method ? { ...P.savedMethodColumns(method) } : {}
    if (!saveOnly) Object.assign(patch, { auto_pay_enabled: true, auto_pay_authorized_at: now, auto_pay_disabled_at: null, autopay_failures: 0 })
    let out = await rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }).catch(async err => {
      // Before migrate-stripe-secure.sql: cards still work without the new columns
      if (!/Could not find the '/.test(err.message) || method?.type !== 'card') throw err
      const { default_payment_method_type, default_bank_name, autopay_failures, ...old } = patch
      return rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', body: old, prefer: 'return=representation' })
    })
    out = out?.[0] || {}
    return json(200, { ok: true, autoPayEnabled: out.auto_pay_enabled === true, method: method || null })
  } catch (err) {
    console.error('update-autopay-settings:', err.message)
    return json(500, { error: err.name === 'StripeError' ? `Stripe: ${err.message}` : 'Could not update AutoPay.' })
  }
}
