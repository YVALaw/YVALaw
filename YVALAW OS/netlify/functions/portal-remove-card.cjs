/**
 * portal-remove-card — Netlify Function
 *
 * Removes a client's saved card and disables AutoPay using the Supabase
 * service role key, bypassing the RLS policy that blocks direct client
 * UPDATE access on the client_users table.
 *
 * POST /.netlify/functions/portal-remove-card
 * Headers: Authorization: Bearer <user_access_token>
 * Body:    { clientId: string }
 *
 * Required Netlify env vars:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (server-only, bypasses RLS)
 */

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://yvastaffing.agency',
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

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing required env vars' })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })

  const user = await getUserFromToken(authHeader.slice(7))
  if (!user?.id) return json(401, { error: 'Invalid or expired token' })

  // ── Parse body ────────────────────────────────────────────────────────────
  let clientId
  try {
    const body = JSON.parse(event.body || '{}')
    clientId = body.clientId
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!clientId) return json(400, { error: 'clientId is required' })

  // ── Confirm caller has the portal_client role (owns this client row) ──────
  const rows = await supabaseGet(
    `client_users?client_id=eq.${enc(clientId)}&auth_id=eq.${enc(user.id)}&select=id`
  )
  const portalUser = Array.isArray(rows) ? rows[0] : null
  if (!portalUser) return json(403, { error: 'Access denied' })

  // ── Clear card data using service role key (bypasses RLS) ─────────────────
  await supabasePatch('client_users', `id=eq.${enc(portalUser.id)}`, {
    auto_pay_enabled:           false,
    default_payment_method_id:  null,
    default_card_brand:         null,
    default_card_last4:         null,
    default_card_exp_month:     null,
    default_card_exp_year:      null,
    auto_pay_authorized_at:     null,
  })

  return json(200, { ok: true })
}
