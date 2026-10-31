/**
 * employee-me — Netlify Function
 * Returns the logged-in employee's own profile and assigned projects for the
 * My workspace page (and later the YVA Time desktop app).
 *
 * GET /.netlify/functions/employee-me
 * Headers: Authorization: Bearer <employee_access_token>
 *
 * Returns: { employee: {...}, projects: [{ id, name, clientName, status }] }
 *
 * Security:
 *   - The employee is found by employees.user_id = the caller's login (server-side),
 *     never by anything the browser sends
 *   - Only SAFE_FIELDS are returned — no pay rate, premium settings, internal notes
 *     or attachments (employees have no direct table access; RLS stays staff-only)
 */

const SAFE_FIELDS = [
  'id', 'name', 'employee_number', 'email', 'phone', 'role', 'employment_type',
  'location', 'timezone', 'default_shift_start', 'default_shift_end', 'status',
  'photo_url', 'works_for', 'manual_time_allowed',
].join(',')

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
    const rows = await supabaseGet(`employees?user_id=eq.${enc(user.id)}&select=${SAFE_FIELDS}&limit=1`)
    const e = rows?.[0]
    if (!e) return json(404, { error: 'No employee profile is linked to this login' })

    // Supervisor + instructions (Step 7) when those columns exist; older databases fall back
    const projectRows = await supabaseGet(
      `projects?employee_ids=cs.${enc(JSON.stringify([e.id]))}&select=id,name,client_id,status,supervisor_name,supervisor_email,supervisor_phone,employee_instructions&order=name`,
    ).catch(() => supabaseGet(`projects?employee_ids=cs.${enc(JSON.stringify([e.id]))}&select=id,name,client_id,status&order=name`))
    const clientIds = [...new Set(projectRows.map(p => p.client_id).filter(Boolean))]
    const clientRows = clientIds.length
      ? await supabaseGet(`clients?id=in.(${clientIds.map(enc).join(',')})&select=id,name`)
      : []
    const clientName = Object.fromEntries(clientRows.map(c => [String(c.id), c.name]))

    return json(200, {
      employee: {
        id:                e.id,
        name:              e.name,
        employeeNumber:    e.employee_number ?? null,
        email:             e.email ?? null,
        phone:             e.phone ?? null,
        role:              e.role ?? null,
        employmentType:    e.employment_type ?? null,
        location:          e.location ?? null,
        timezone:          e.timezone ?? null,
        defaultShiftStart: e.default_shift_start ?? null,
        defaultShiftEnd:   e.default_shift_end ?? null,
        status:            e.status ?? null,
        photoUrl:          e.photo_url ?? null,
        worksFor:          e.works_for === 'yva' ? 'yva' : 'client',
        manualTimeAllowed: e.manual_time_allowed === true,
      },
      projects: projectRows.map(p => ({
        id:         p.id,
        name:       p.name,
        clientName: clientName[String(p.client_id)] ?? null,
        status:     p.status ?? null,
        supervisor: p.supervisor_name || p.supervisor_email || p.supervisor_phone
          ? { name: p.supervisor_name ?? null, email: p.supervisor_email ?? null, phone: p.supervisor_phone ?? null } : null,
        instructions: p.employee_instructions ?? null,
      })),
    })
  } catch (err) {
    console.error('employee-me failed', err)
    return json(500, { error: 'Could not load your profile' })
  }
}
