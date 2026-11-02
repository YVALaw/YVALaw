/**
 * setup-payment-method — portal "Add card or bank account" (for AutoPay or faster payments later).
 *
 * POST /.netlify/functions/setup-payment-method   Authorization: Bearer <portal user token>
 * Body: { clientId, autopay?: boolean }   → { clientSecret }
 *
 * Creates a Stripe SetupIntent (card or US bank account, usage off_session) for the caller's own Stripe
 * customer. Nothing is charged. The browser confirms it with Stripe; the method is then stored by
 * update-autopay-settings (which checks it belongs to this customer) and again by the webhook
 * (setup_intent.succeeded) as a backup. AutoPay is turned on only if the client ticked the consent box.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */
const { json } = require('./_lib/supa.cjs')
const { stripe } = require('./_lib/stripe.cjs')
const { portalCaller, ensureCustomer } = require('./_lib/portalBilling.cjs')

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'Online payments are not set up yet. Please contact YVA.' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }
  try {
    const who = await portalCaller(event, body.clientId)
    if (who.error) return who.error
    const { user, row, client } = who
    const customerId = await ensureCustomer(row, user, client)
    const si = await stripe('POST', '/setup_intents', {
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card', 'us_bank_account'],
      payment_method_options: { us_bank_account: { verification_method: 'automatic', financial_connections: { permissions: ['payment_method'] } } },
      metadata: { clientId: client.id, clientUserId: row.id, autopay: body.autopay === true ? 'true' : 'false' },
    })
    return json(200, { clientSecret: si.client_secret })
  } catch (err) {
    console.error('setup-payment-method:', err.message)
    return json(500, { error: err.name === 'StripeError' ? `Stripe: ${err.message}` : 'Could not start adding the payment method.' })
  }
}
