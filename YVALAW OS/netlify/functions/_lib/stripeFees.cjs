/**
 * Stripe fees on client payments (supabase/migrate-expenses-recurring-fees.sql: client_payments.stripe_fee + net_amount).
 *
 * Stripe keeps its fee from each payment; the charge's balance transaction says how much (`fee`, `net`, in cents).
 * A refund doesn't give the fee back, so the fee stays on the payment row. For bank (ACH) payments the balance
 * transaction can be missing for a while — the fee is then left empty and filled later (charge.updated /
 * charge.refunded events, or the CEO's "Fill missing fees" in Reports → stripe-fees function).
 *
 * Nothing here ever throws: a fee lookup must never fail the webhook (it logs and leaves the fee empty).
 */
const { rest, enc } = require('./supa.cjs')
const { stripe } = require('./stripe.cjs')

const cents = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** { fee, net } in dollars from an expanded balance transaction, or null (not available yet / not USD / bad data) */
function feeFromBalanceTransaction(bt) {
  if (!bt || typeof bt !== 'object') return null
  const fee = cents(bt.fee)
  if (fee === null || fee < 0) return null
  if (bt.currency && String(bt.currency).toLowerCase() !== 'usd') return null
  const net = cents(bt.net)
  return { fee: Math.round(fee) / 100, net: net === null ? null : Math.round(net) / 100 }
}

/** Ask Stripe for a charge's fee. Returns { fee, net, chargeId } | { pending: true, chargeId } | { error } */
async function lookupFee({ chargeId, paymentIntentId }) {
  try {
    let charge = null
    if (chargeId) charge = await stripe('GET', `/charges/${enc(chargeId)}?expand[]=balance_transaction`)
    else if (paymentIntentId) {
      const pi = await stripe('GET', `/payment_intents/${enc(paymentIntentId)}?expand[]=latest_charge.balance_transaction`)
      charge = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
    }
    if (!charge) return { pending: true, chargeId: chargeId || null }
    const f = feeFromBalanceTransaction(charge.balance_transaction)
    return f ? { ...f, chargeId: charge.id || chargeId || null } : { pending: true, chargeId: charge.id || chargeId || null }
  } catch (err) {
    return { error: String(err?.message || err).slice(0, 300) }
  }
}

/**
 * Fill the fee of one Stripe payment row if it is still empty. `payment` = { id?, external_ref?, stripe_charge_id? }.
 * `bt` = a balance transaction already in hand (charge events) to skip the lookup.
 * Returns 'filled' | 'pending' | 'skipped' | 'failed' (never throws).
 */
async function fillFee(payment, { bt, chargeId, paymentIntentId } = {}) {
  try {
    const filter = payment.id ? `id=eq.${enc(payment.id)}` : payment.external_ref ? `external_ref=eq.${enc(payment.external_ref)}` : null
    if (!filter) return 'skipped'
    let f = bt && typeof bt === 'object' ? feeFromBalanceTransaction(bt) : null
    let foundCharge = null
    if (!f) {
      const r = await lookupFee({ chargeId: chargeId || payment.stripe_charge_id || null, paymentIntentId: paymentIntentId || (String(payment.external_ref || '').startsWith('pi_') ? payment.external_ref : null) })
      if (r.error) { console.warn('stripe fee lookup failed —', r.error); return 'failed' }
      if (r.pending) return 'pending'
      f = r; foundCharge = r.chargeId
    }
    const body = { stripe_fee: f.fee, net_amount: f.net }
    if (foundCharge && !payment.stripe_charge_id) body.stripe_charge_id = foundCharge
    const out = await rest(`client_payments?${filter}&source=eq.stripe&kind=eq.payment&stripe_fee=is.null`, { method: 'PATCH', body, prefer: 'return=representation' })
    return Array.isArray(out) && out.length ? 'filled' : 'skipped'
  } catch (err) {
    // Before the SQL runs the column doesn't exist — the payment itself is already recorded
    console.warn('stripe fee not saved —', String(err?.message || err).slice(0, 300))
    return 'failed'
  }
}

/** Fill the fee only if the row's fee is still empty (one small read first, so a refund/charge event that arrives
 *  later doesn't cost a Stripe call when the fee is already known). Never throws. */
async function fillFeeIfMissing(payment, opts = {}) {
  try {
    const filter = payment?.id ? `id=eq.${enc(payment.id)}` : payment?.external_ref ? `external_ref=eq.${enc(payment.external_ref)}` : null
    if (!filter) return 'skipped'
    const rows = await rest(`client_payments?${filter}&source=eq.stripe&kind=eq.payment&stripe_fee=is.null&select=id,external_ref,stripe_charge_id&limit=1`)
    if (!rows?.length) return 'skipped'
    return fillFee(rows[0], opts)
  } catch (err) {
    console.warn('stripe fee check skipped —', String(err?.message || err).slice(0, 300))
    return 'failed'
  }
}

module.exports = { feeFromBalanceTransaction, lookupFee, fillFee, fillFeeIfMissing }
