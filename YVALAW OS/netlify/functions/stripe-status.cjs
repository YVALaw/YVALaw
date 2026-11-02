/**
 * stripe-status — Settings → Integrations → Stripe: is it set up, which mode, is the webhook arriving?
 *
 * GET /.netlify/functions/stripe-status   Authorization: Bearer <CEO / Admin / Accounting>
 * → { secretKey: 'live'|'test'|null, webhookSecret: boolean, account: {...}|null, accountError?,
 *     lastEvent: {...}|null, failedEvents: number }
 * Never returns any key or secret.
 */
const { rest, json, callerFromEvent, roleOf } = require('./_lib/supa.cjs')
const { stripe, keyMode } = require('./_lib/stripe.cjs')

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })
  const user = await callerFromEvent(event).catch(() => null)
  if (!user) return json(401, { error: 'Please sign in again.' })
  if (!['ceo', 'admin', 'accounting'].includes(await roleOf(user.id))) return json(403, { error: 'Not allowed' })
  const out = { secretKey: keyMode(), webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET, account: null, lastEvent: null, failedEvents: 0 }
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const a = await stripe('GET', '/account')
      out.account = { id: a.id, name: a.settings?.dashboard?.display_name || a.business_profile?.name || null, country: a.country || null,
        chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, achEnabled: a.capabilities?.us_bank_account_ach_payments === 'active' }
    } catch (err) { out.accountError = err.message }
  }
  try {
    out.lastEvent = (await rest('stripe_events?select=type,livemode,received_at,processed_at,error&order=received_at.desc&limit=1'))?.[0] || null
    const failed = await rest(`stripe_events?processed_at=is.null&received_at=gte.${new Date(Date.now() - 7 * 86400_000).toISOString()}&select=id`)
    out.failedEvents = failed?.length || 0
  } catch { out.eventsTable = false }
  return json(200, out)
}
