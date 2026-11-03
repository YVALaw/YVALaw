/**
 * stripe-fees — POST, CEO only: "Fill missing fees" in Finance → Reports.
 * Looks up Stripe's fee for Stripe payments whose stripe_fee is still empty (payments from before
 * supabase/migrate-expenses-recurring-fees.sql, or bank payments whose fee wasn't known yet).
 * At most 100 per run, newest first, with a time budget; answers how many are still missing so the page can say so.
 * Body: { from?, to? } (YYYY-MM-DD, paid_on range; optional).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */
const { rest, callerFromEvent, roleOf, json } = require('./_lib/supa.cjs')
const F = require('./_lib/stripeFees.cjs')

const ISO = /^\d{4}-\d{2}-\d{2}$/
const MAX = 100
const BUDGET_MS = 20_000

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {})
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const user = await callerFromEvent(event)
    if (!user) return json(401, { error: 'Please sign in again.' })
    if ((await roleOf(user.id)) !== 'ceo') return json(403, { error: 'Only the CEO can fill in Stripe fees.' })
    if (!process.env.STRIPE_SECRET_KEY) return json(503, { error: 'Stripe is not set up (STRIPE_SECRET_KEY is missing in Netlify).' })
    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad request' }) }
    const range = `${ISO.test(body.from || '') ? `&paid_on=gte.${body.from}` : ''}${ISO.test(body.to || '') ? `&paid_on=lte.${body.to}` : ''}`
    const base = `client_payments?source=eq.stripe&kind=eq.payment&stripe_fee=is.null${range}`
    let rows
    try {
      rows = await rest(`${base}&select=id,external_ref,stripe_charge_id&order=paid_on.desc,id&limit=${MAX}`)
    } catch (e) {
      if (/stripe_fee|column|42703/i.test(e.message)) return json(409, { error: 'Run supabase/migrate-expenses-recurring-fees.sql in Supabase first.', notSetUp: true })
      throw e
    }
    const started = Date.now()
    const out = { checked: 0, filled: 0, waiting: 0, failed: 0 }
    for (const r of rows) {
      if (Date.now() - started > BUDGET_MS) break
      out.checked++
      const res = await F.fillFee(r)
      if (res === 'filled') out.filled++
      else if (res === 'pending') out.waiting++
      else if (res === 'failed') out.failed++
    }
    const left = await rest(`${base}&select=id&limit=${MAX + 1}`)
    return json(200, { ...out, missing: left.length > MAX ? `${MAX}+` : left.length })
  } catch (e) {
    console.error('stripe-fees', e)
    return json(500, { error: String(e.message || e).slice(0, 300) })
  }
}
