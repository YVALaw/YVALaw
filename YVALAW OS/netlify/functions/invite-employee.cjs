/**
 * invite-employee — Netlify Function
 * Creates a Supabase Auth login for an employee (YVA Time / My workspace) and either:
 *  - mode='email': Supabase sends the invitation email (redirects to redirectTo)
 *  - mode='link': returns a one-time invite link for manual delivery
 *  - mode='reset': the employee already has a login (invite expired, link used on the wrong
 *    site, forgot password) — returns a one-time sign-in link that opens "Choose a new
 *    password" (redirectTo should be <app>/reset-password). Never creates a login.
 *
 * POST /.netlify/functions/invite-employee
 * Headers: Authorization: Bearer <caller_access_token>
 * Body:    { employeeId: string, mode?: 'email' | 'link' | 'reset', redirectTo?: string }
 *
 * Required Netlify env vars:
 *   SUPABASE_URL              — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS, server-only)
 *
 * Security:
 *   - Caller must be staff allowed to manage employees (INVITER_ROLES)
 *   - The invite goes to the email saved on the employee record, never one from the request
 *   - The login gets user_metadata { role: 'employee', employee_id, must_change_password }
 *     (a routing hint only — employee data is served by employee-me, which checks
 *     employees.user_id server-side)
 *   - employees.user_id is set to the new login; the login is deleted if that fails
 */

// Staff who can manage employees (same as can.viewEmployees in the app)
const INVITER_ROLES = new Set(['ceo', 'admin', 'accounting', 'recruiter'])

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

async function deleteAuthUser(userId) {
  await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${enc(userId)}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  })
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars' })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let employeeId, mode, redirectTo
  try {
    const body = JSON.parse(event.body || '{}')
    employeeId = body.employeeId
    mode       = body.mode || 'email'
    redirectTo = body.redirectTo
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (!employeeId) return json(400, { error: 'employeeId is required' })
  if (mode !== 'email' && mode !== 'link' && mode !== 'reset') return json(400, { error: 'mode must be email, link or reset' })

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
  if (!INVITER_ROLES.has(roleRows?.[0]?.role)) {
    return json(403, { error: 'Only YVA staff who manage employees can send invites' })
  }

  // ── Load the employee ─────────────────────────────────────────────────────
  const empRes = await fetch(
    `${supabaseUrl}/rest/v1/employees?id=eq.${enc(employeeId)}&select=id,name,email,user_id`,
    { headers: serviceHeaders({ Accept: 'application/json' }) },
  )
  if (!empRes.ok) return json(500, { error: 'Failed to load employee' })
  const employee = (await empRes.json())?.[0]
  if (!employee) return json(404, { error: 'Employee not found' })

  // ── New sign-in link for an existing login ────────────────────────────────
  if (mode === 'reset') {
    if (!employee.user_id) return json(400, { error: 'This employee has no login yet — send an invite instead' })
    const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${enc(employee.user_id)}`, { headers: serviceHeaders() })
    const authUser = userRes.ok ? await userRes.json().catch(() => null) : null
    if (!authUser?.email) return json(404, { error: 'The login for this employee was not found' })
    const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ type: 'recovery', email: authUser.email, ...(redirectTo ? { redirect_to: redirectTo } : {}) }),
    })
    const linkData = await linkRes.json().catch(() => ({}))
    const resetLink = linkData?.action_link || linkData?.properties?.action_link
    if (!linkRes.ok || !resetLink) return json(500, { error: linkData?.msg || 'Could not create a sign-in link' })
    return json(200, { success: true, mode, email: authUser.email, inviteLink: resetLink,
      message: `New sign-in link created for ${authUser.email}` })
  }

  if (employee.user_id) return json(409, { error: 'This employee already has a login' })

  const email = String(employee.email || '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Add a valid email address to this employee before inviting' })
  }

  // ── Create the login + invitation ─────────────────────────────────────────
  const metadata = {
    must_change_password: true,
    role:                 'employee',
    employee_id:          employee.id,
    full_name:            employee.name,
  }

  let newUserId
  let actionLink
  if (mode === 'email') {
    const inviteUrl = new URL(`${supabaseUrl}/auth/v1/invite`)
    if (redirectTo) inviteUrl.searchParams.set('redirect_to', redirectTo)
    const inviteRes = await fetch(inviteUrl.toString(), {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, data: metadata }),
    })
    const inviteData = await inviteRes.json().catch(() => ({}))
    if (!inviteRes.ok) return json(inviteError(inviteData).status, { error: inviteError(inviteData).message })
    newUserId = inviteData?.user?.id || inviteData?.id
  } else {
    const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        type: 'invite',
        email,
        data: metadata,
        ...(redirectTo ? { redirect_to: redirectTo } : {}),
      }),
    })
    const linkData = await linkRes.json().catch(() => ({}))
    if (!linkRes.ok) return json(inviteError(linkData).status, { error: inviteError(linkData).message })
    newUserId  = linkData?.user?.id || linkData?.id
    actionLink = linkData?.action_link || linkData?.actionLink
  }

  if (!newUserId) return json(500, { error: 'Login created but ID not returned' })
  if (mode === 'link' && !actionLink) {
    await deleteAuthUser(newUserId)
    return json(500, { error: 'Invite link was not returned — invite rolled back' })
  }

  // ── Link the login to the employee record ─────────────────────────────────
  // user_id=is.null guards against a second invite racing this one
  const linkEmpRes = await fetch(
    `${supabaseUrl}/rest/v1/employees?id=eq.${enc(employee.id)}&user_id=is.null`,
    {
      method: 'PATCH',
      headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ user_id: newUserId }),
    },
  )
  const linkedRows = linkEmpRes.ok ? await linkEmpRes.json().catch(() => []) : []
  if (!Array.isArray(linkedRows) || linkedRows.length !== 1) {
    await deleteAuthUser(newUserId)
    return json(500, { error: 'Failed to link the login to this employee — invite rolled back' })
  }

  return json(200, {
    success:    true,
    mode,
    message:    mode === 'link' ? `Invitation link created for ${email}` : `Invitation email sent to ${email}`,
    email,
    userId:     newUserId,
    inviteLink: actionLink,
    emailSent:  mode === 'email',
  })
}

function inviteError(data) {
  const msg  = data?.msg || data?.message || ''
  const code = data?.code || data?.error_code || ''
  if (msg.includes('already registered') || code === 'email_exists' || code === 'user_already_exists') {
    return { status: 409, message: 'A login with this email already exists' }
  }
  return { status: 500, message: msg || 'Failed to create the invitation' }
}
