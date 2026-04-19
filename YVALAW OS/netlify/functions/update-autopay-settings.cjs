/**
 * update-autopay-settings — Netlify Function
 *
 * Server-validated AutoPay settings changes for portal clients. The function
 * verifies the caller owns the portal client row and, when enabling AutoPay,
 * verifies the Stripe payment method belongs to that client's Stripe customer.
 */

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function enc(value) {
  return encodeURIComponent(String(value ?? ''))
}

async function getUserFromToken(token) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  })
  if (!res.ok) return null
  return res.json()
}

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status}`)
  return res.json()
}

async function supabasePatch(table, filter, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase PATCH ${table} failed: ${res.status}`)
}

async function stripeGet(path) {
  const key = process.env.STRIPE_SECRET_KEY
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': '2024-06-20',
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Stripe GET ${path} failed`)
  return data
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return json(500, { error: 'Missing required env vars' })
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })

  let clientId, enabled, paymentMethodId
  try {
    const body = JSON.parse(event.body || '{}')
    clientId = body.clientId
    enabled = body.enabled
    paymentMethodId = body.paymentMethodId
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!clientId || typeof enabled !== 'boolean') {
    return json(400, { error: 'clientId and enabled are required' })
  }

  const user = await getUserFromToken(authHeader.slice(7))
  if (!user?.id) return json(401, { error: 'Invalid or expired token' })

  const rows = await supabaseGet(
    `client_users?client_id=eq.${enc(clientId)}&auth_id=eq.${enc(user.id)}&select=id,stripe_customer_id,default_payment_method_id`
  )
  const portalUser = Array.isArray(rows) ? rows[0] : null
  if (!portalUser) return json(403, { error: 'Access denied' })

  if (!enabled) {
    await supabasePatch('client_users', `id=eq.${enc(portalUser.id)}`, {
      auto_pay_enabled: false,
      auto_pay_disabled_at: new Date().toISOString(),
    })
    return json(200, { ok: true, autoPayEnabled: false })
  }

  if (!paymentMethodId) return json(400, { error: 'A saved card is required to enable AutoPay.' })
  if (!portalUser.stripe_customer_id) return json(409, { error: 'Stripe customer is not ready yet.' })

  const pm = await stripeGet(`/payment_methods/${paymentMethodId}`)
  const customerId = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id
  if (customerId !== portalUser.stripe_customer_id) {
    return json(403, { error: 'Payment method does not belong to this client.' })
  }
  if (pm.type !== 'card' || !pm.card) {
    return json(400, { error: 'Only card payment methods can be used for AutoPay.' })
  }

  await supabasePatch('client_users', `id=eq.${enc(portalUser.id)}`, {
    auto_pay_enabled: true,
    default_payment_method_id: paymentMethodId,
    default_card_brand: pm.card.brand || null,
    default_card_last4: pm.card.last4 || null,
    default_card_exp_month: pm.card.exp_month || null,
    default_card_exp_year: pm.card.exp_year || null,
    auto_pay_authorized_at: new Date().toISOString(),
    auto_pay_disabled_at: null,
  })

  return json(200, {
    ok: true,
    autoPayEnabled: true,
    card: {
      brand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
    },
  })
}
