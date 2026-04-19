/**
 * update-portal-profile — Netlify Function
 *
 * Narrow client-portal profile update endpoint. Portal clients can update only
 * their own allowed profile fields; raw table UPDATE access stays closed by RLS.
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

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing required env vars' })
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })

  let clientId, phone
  try {
    const body = JSON.parse(event.body || '{}')
    clientId = body.clientId
    phone = typeof body.phone === 'string' ? body.phone.trim() : ''
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!clientId) return json(400, { error: 'clientId is required' })
  if (phone.length > 40) return json(400, { error: 'Phone number is too long' })

  const user = await getUserFromToken(authHeader.slice(7))
  if (!user?.id) return json(401, { error: 'Invalid or expired token' })

  const rows = await supabaseGet(
    `client_users?client_id=eq.${enc(clientId)}&auth_id=eq.${enc(user.id)}&select=id`
  )
  if (!Array.isArray(rows) || rows.length === 0) {
    return json(403, { error: 'Access denied' })
  }

  await supabasePatch('clients', `id=eq.${enc(clientId)}`, {
    phone: phone || null,
  })

  return json(200, { ok: true })
}
