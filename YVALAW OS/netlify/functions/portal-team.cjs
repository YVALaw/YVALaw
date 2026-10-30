/**
 * portal-team — Netlify Function
 * Returns the employees placed on a client's projects, with client-safe fields only,
 * for the client portal (Dashboard, Team, Projects).
 *
 * GET /.netlify/functions/portal-team?clientId=<id>
 * Headers: Authorization: Bearer <access_token>
 *
 * Returns: { employees: [{ id, name, role, photo_url, email, timezone, status,
 *                          employment_type, default_shift_start, default_shift_end, location }] }
 *
 * Security:
 *   - Portal clients always get their own client (client_users), whatever clientId says
 *   - Staff (preview portal) may pass any clientId
 *   - Employee IDs come from the client's projects server-side, never from the browser
 *   - Clients have no direct SELECT on employees (the portal_client_employees RLS policy
 *     is dropped by migrate-portal-employees-lockdown.sql), so pay rate, notes,
 *     premium settings and attachments can't be read through the API
 */

const SAFE_FIELDS = [
  'id', 'name', 'role', 'photo_url', 'email', 'timezone', 'status',
  'employment_type', 'default_shift_start', 'default_shift_end', 'location',
].join(',')

// Same list as private.is_internal()
const STAFF_ROLES = new Set(['ceo', 'admin', 'accounting', 'recruiter', 'lead_gen'])

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://yvastaffing.agency',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function enc(value) {
  return encodeURIComponent(String(value ?? ''))
}

async function supabaseGet(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Supabase GET ${path.split('?')[0]} failed: ${res.status}`)
  return res.json()
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'Missing required env vars' })

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_ROLE_KEY },
  })
  if (!userRes.ok) return json(401, { error: 'Invalid or expired token' })
  const user = await userRes.json()
  if (!user?.id) return json(401, { error: 'Invalid or expired token' })

  try {
    // Which client? A portal client only ever gets their own.
    let clientId = null
    const portalRows = await supabaseGet(`client_users?auth_id=eq.${enc(user.id)}&select=client_id&limit=1`)
    if (portalRows?.[0]?.client_id) {
      clientId = portalRows[0].client_id
    } else {
      const roleRows = await supabaseGet(`user_roles?user_id=eq.${enc(user.id)}&select=role`)
      if (!STAFF_ROLES.has(roleRows?.[0]?.role)) return json(403, { error: 'Access denied' })
      clientId = event.queryStringParameters?.clientId || null
    }
    if (!clientId) return json(400, { error: 'clientId is required' })

    const projects = await supabaseGet(`projects?client_id=eq.${enc(clientId)}&select=employee_ids`)
    const ids = [...new Set(projects.flatMap(p => (Array.isArray(p.employee_ids) ? p.employee_ids : [])))]
    if (ids.length === 0) return json(200, { employees: [] })

    const employees = await supabaseGet(`employees?id=in.(${ids.map(enc).join(',')})&select=${SAFE_FIELDS}`)
    return json(200, { employees })
  } catch (err) {
    console.error('portal-team failed', err)
    return json(500, { error: 'Could not load your team' })
  }
}
