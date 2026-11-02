/**
 * Stripe API without the npm package (form-encoded REST, pinned API version).
 *
 *   stripe(method, path, body?, { idempotencyKey? })  → parsed JSON, throws StripeError on 4xx/5xx
 *   keyMode(key) → 'live' | 'test' | null
 *
 * Env: STRIPE_SECRET_KEY (sk_live_… / sk_test_… or a restricted rk_… key)
 */
const API_VERSION = '2024-06-20'

class StripeError extends Error {
  constructor(message, { status, error } = {}) {
    super(message)
    this.name = 'StripeError'
    this.status = status
    this.stripeError = error || null
    this.code = error?.code || null
    this.declineCode = error?.decline_code || null
    this.paymentIntent = error?.payment_intent || null
  }
}

/** Nested objects → a[b][c]=v; arrays → a[0]=v, a[1]=w (Stripe's format); null/undefined skipped */
function toForm(obj, prefix) {
  const parts = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') parts.push(...toForm(item, `${key}[${i}]`))
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`)
      })
    } else if (typeof v === 'object') {
      parts.push(...toForm(v, key))
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
    }
  }
  return parts
}
const formBody = obj => toForm(obj).join('&')

function keyMode(key = process.env.STRIPE_SECRET_KEY) {
  if (!key) return null
  if (/^(sk|rk)_live_/.test(key)) return 'live'
  if (/^(sk|rk)_test_/.test(key)) return 'test'
  return null
}

async function stripe(method, path, body, { idempotencyKey } = {}) {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new StripeError('Stripe is not set up (STRIPE_SECRET_KEY is missing in Netlify).', { status: 500 })
  const headers = { Authorization: `Bearer ${key}`, 'Stripe-Version': API_VERSION }
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 255)
  const init = { method, headers }
  if (body && method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = formBody(body)
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new StripeError(data?.error?.message || `Stripe ${method} ${path.split('?')[0]} failed (${res.status})`, { status: res.status, error: data?.error })
  return data
}

module.exports = { API_VERSION, StripeError, stripe, keyMode, formBody, toForm }
