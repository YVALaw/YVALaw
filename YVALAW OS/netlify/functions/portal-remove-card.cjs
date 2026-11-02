/**
 * portal-remove-card — portal client removes their saved card / bank account.
 *
 * POST /.netlify/functions/portal-remove-card   Authorization: Bearer <portal user token>
 * Body: { clientId }  → { ok }
 *
 * The method is detached in Stripe first (so it can never be charged again), then cleared here and AutoPay is
 * turned off. A method that's already gone from Stripe is simply cleared.
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
  try {
    const who = await portalCaller(event, body.clientId)
    if (who.error) return who.error
    const { row } = who
    const pmId = row.default_payment_method_id
    if (pmId) {
      if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Online payments are not set up yet.' })
      try {
        const pm = await stripe('GET', `/payment_methods/${enc(pmId)}`)
        const owner = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
        if (owner && owner === row.stripe_customer_id) await stripe('POST', `/payment_methods/${enc(pmId)}/detach`, {})
      } catch (err) {
        if (err.status !== 404 && err.code !== 'resource_missing') throw err
      }
    }
    await rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', prefer: 'return=minimal',
      body: { ...P.savedMethodColumns(null), auto_pay_enabled: false, auto_pay_authorized_at: null, auto_pay_disabled_at: new Date().toISOString() } })
      .catch(async err => {
        if (!/Could not find the '/.test(err.message)) throw err
        const { default_payment_method_type, default_bank_name, ...old } = P.savedMethodColumns(null)
        await rest(`client_users?id=eq.${enc(row.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...old, auto_pay_enabled: false, auto_pay_authorized_at: null } })
      })
    return json(200, { ok: true })
  } catch (err) {
    console.error('portal-remove-card:', err.message)
    return json(500, { error: err.name === 'StripeError' ? `Stripe: ${err.message}` : 'Could not remove the payment method.' })
  }
}
