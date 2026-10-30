/**
 * desktop-device-revoke — Netlify Function
 * "Disconnect" on an employee profile (YVA Time Login → Computers): for a lost, sold or
 * shared computer. Marks the computer disconnected and ends that computer's login session.
 * From then on the database refuses time and screenshots from it, and the app signs itself
 * out at its next check-in (about a minute). The employee can sign in again with their
 * YVA OS password, which records a new computer.
 *
 * POST /.netlify/functions/desktop-device-revoke
 * Headers: Authorization: Bearer <caller_access_token>
 * Body:    { deviceId: string }
 * Returns: { revoked: true, session_ended: boolean }
 *
 * Required Netlify env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Security: caller must be CEO, Admin or Accounting (same people who approve time).
 * public.yva_time_disconnect_device can only be run with the service role key.
 */

const REVOKER_ROLES = new Set(['ceo', 'admin', 'accounting'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return { Authorization: `Bearer ${key}`, apikey: key, ...extra }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars' })
  }

  let deviceId
  try {
    ({ deviceId } = JSON.parse(event.body || '{}'))
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (typeof deviceId !== 'string' || !UUID_RE.test(deviceId)) return json(400, { error: 'deviceId is required' })

  // ── Verify the caller ─────────────────────────────────────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY },
  })
  if (!verifyRes.ok) return json(401, { error: 'Invalid or expired authorization token' })
  const caller = await verifyRes.json()
  if (!caller?.id) return json(401, { error: 'Could not identify caller' })

  const roleRes = await fetch(
    `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${enc(caller.id)}&select=role`,
    { headers: serviceHeaders({ Accept: 'application/json' }) },
  )
  if (!roleRes.ok) return json(500, { error: 'Failed to verify caller role' })
  const roleRows = await roleRes.json()
  if (!REVOKER_ROLES.has(roleRows?.[0]?.role)) {
    return json(403, { error: 'Only CEO, Admin or Accounting can disconnect a computer' })
  }

  // ── Disconnect ────────────────────────────────────────────────────────────
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/yva_time_disconnect_device`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({ p_device: deviceId, p_by: caller.id }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (/not found/i.test(data?.message || '')) return json(404, { error: 'Computer not found' })
    return json(500, { error: 'Could not disconnect the computer' })
  }
  return json(200, { revoked: true, session_ended: data?.session_ended === true })
}
