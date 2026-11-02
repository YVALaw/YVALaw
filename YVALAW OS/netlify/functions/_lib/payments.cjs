/**
 * Payment rules shared by the Stripe functions — pure (no network), unit-tested in tests/payments.test.ts.
 *
 *   balanceCents(invoice)                     what is still owed, in cents (server side; never trust the browser)
 *   invoiceBelongsToClient(invoice, client)   client_id first; older invoices without one fall back to the name
 *   isPayable(invoice)                        sent / viewed / overdue / partial with ≥ 50¢ owed
 *   autopayDecision({ invoice, attempts, today, now })   charge now? (due date required, no payment in flight,
 *                                             max 3 tries per invoice, 3 days apart)
 *   signPayLink / verifyPayLink               "Pay now" links in invoice emails: HMAC token naming one invoice +
 *                                             expiry; the amount is always worked out again when it's opened
 *   methodSummary(paymentMethod)              card brand/last4/expiry or bank name/last4 for display
 */
const crypto = require('crypto')

const PAYABLE_STATUSES = new Set(['sent', 'viewed', 'overdue', 'partial'])
const MIN_CENTS = 50
const AUTOPAY_MAX_TRIES = 3
const AUTOPAY_RETRY_DAYS = 3
const PAY_LINK_DAYS = 60
/** A payment in one of these states may still take the money — never start another one meanwhile */
const IN_FLIGHT = new Set(['processing', 'requires_action', 'requires_confirmation', 'requires_capture'])

const centsFromUSD = v => Math.round((Number(v) || 0) * 100)
const balanceCents = inv => centsFromUSD(Number(inv?.subtotal) || 0) - centsFromUSD(Number(inv?.amount_paid) || 0)
const statusOf = inv => String(inv?.status || '').toLowerCase()

function invoiceBelongsToClient(inv, client) {
  if (!inv || !client) return false
  if (inv.client_id) return String(inv.client_id) === String(client.id)
  return !!inv.client_name && !!client.name && String(inv.client_name).trim() === String(client.name).trim()
}

const isPayable = inv => PAYABLE_STATUSES.has(statusOf(inv)) && balanceCents(inv) >= MIN_CENTS

const DAY = 86400_000
/**
 * AutoPay decision for one invoice. `attempts` = this invoice's payment_attempts rows (any source).
 * Returns { charge: true, tryNumber } or { charge: false, reason }.
 */
function autopayDecision({ invoice, attempts = [], today, now = Date.now() }) {
  if (!isPayable(invoice)) return { charge: false, reason: 'not_payable' }
  const due = invoice.due_date ? String(invoice.due_date).slice(0, 10) : ''
  if (!due) return { charge: false, reason: 'no_due_date' }
  if (due > today) return { charge: false, reason: 'not_due' }
  const at = a => Date.parse(a.updated_at || a.attempted_at || a.created_at || 0) || 0
  // Money may already be on its way (bank payment clearing, card needing the client's OK, or a success the
  // webhook hasn't recorded yet)
  if (attempts.some(a => IN_FLIGHT.has(a.status) && now - at(a) < 14 * DAY)) return { charge: false, reason: 'in_flight' }
  if (attempts.some(a => a.status === 'succeeded' && now - at(a) < 3 * DAY)) return { charge: false, reason: 'recently_paid' }
  const fails = attempts.filter(a => a.source === 'autopay' && a.status === 'failed')
  if (fails.length >= AUTOPAY_MAX_TRIES) return { charge: false, reason: 'gave_up' }
  const lastFail = Math.max(0, ...fails.map(at))
  if (lastFail && now - lastFail < AUTOPAY_RETRY_DAYS * DAY - 3600_000) return { charge: false, reason: 'waiting_retry' }
  return { charge: true, tryNumber: fails.length + 1 }
}

// ── Pay links ────────────────────────────────────────────────────────────────
function payLinkSecret() {
  if (process.env.PAY_LINK_SECRET) return process.env.PAY_LINK_SECRET
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base) throw new Error('Pay links need SUPABASE_SERVICE_ROLE_KEY (or PAY_LINK_SECRET) in Netlify.')
  return crypto.createHmac('sha256', base).update('yva-pay-link-v1').digest('hex')
}
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const sigFor = (payload, secret) => b64url(crypto.createHmac('sha256', secret).update(payload).digest())

function signPayLink(invoiceId, { secret = payLinkSecret(), now = Date.now(), days = PAY_LINK_DAYS } = {}) {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(String(invoiceId))) throw new Error('Invalid invoice id')
  const exp = Math.floor(now / 1000) + days * 86400
  const payload = `v1.${invoiceId}.${exp}`
  return `${payload}.${sigFor(payload, secret)}`
}

/** → { ok: true, invoiceId } | { ok: false, reason: 'malformed' | 'bad_signature' | 'expired' } */
function verifyPayLink(token, { secret = payLinkSecret(), now = Date.now() } = {}) {
  const m = /^v1\.([A-Za-z0-9-]{1,64})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''))
  if (!m) return { ok: false, reason: 'malformed' }
  const [, invoiceId, exp, sig] = m
  const expected = sigFor(`v1.${invoiceId}.${exp}`, secret)
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }
  if (Number(exp) * 1000 < now) return { ok: false, reason: 'expired', invoiceId }
  return { ok: true, invoiceId }
}

// ── Display ──────────────────────────────────────────────────────────────────
function methodSummary(pm) {
  if (!pm || typeof pm !== 'object') return null
  if (pm.type === 'us_bank_account') {
    const b = pm.us_bank_account || {}
    return { id: pm.id, type: 'us_bank_account', bankName: b.bank_name || 'Bank account', last4: b.last4 || '????', brand: null, expMonth: null, expYear: null }
  }
  const c = pm.card || {}
  return { id: pm.id, type: 'card', brand: c.brand || 'card', last4: c.last4 || '????', expMonth: c.exp_month || null, expYear: c.exp_year || null, bankName: null }
}

/** client_users columns for a saved method (or clearing it) */
function savedMethodColumns(summary) {
  if (!summary) return {
    default_payment_method_id: null, default_payment_method_type: null, default_card_brand: null, default_card_last4: null,
    default_card_exp_month: null, default_card_exp_year: null, default_bank_name: null,
  }
  return {
    default_payment_method_id: summary.id,
    default_payment_method_type: summary.type,
    default_card_brand: summary.type === 'card' ? summary.brand : null,
    default_card_last4: summary.last4,
    default_card_exp_month: summary.expMonth,
    default_card_exp_year: summary.expYear,
    default_bank_name: summary.bankName,
  }
}

const methodWord = type => (type === 'us_bank_account' ? 'ach' : 'card')

module.exports = {
  PAYABLE_STATUSES, MIN_CENTS, AUTOPAY_MAX_TRIES, AUTOPAY_RETRY_DAYS, PAY_LINK_DAYS, IN_FLIGHT,
  centsFromUSD, balanceCents, invoiceBelongsToClient, isPayable, autopayDecision,
  payLinkSecret, signPayLink, verifyPayLink, methodSummary, savedMethodColumns, methodWord,
}
