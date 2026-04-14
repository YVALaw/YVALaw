/**
 * invite-client — Netlify Function
 * Creates a Supabase Auth account for a client and sends them an invitation email.
 *
 * POST /.netlify/functions/invite-client
 * Headers: Authorization: Bearer <caller_access_token>
 * Body:    { clientId: string, email: string }
 *
 * Required Netlify env vars:
 *   SUPABASE_URL              — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS, server-only)
 *
 * Security:
 *   - Caller must provide a valid Supabase session token (Authorization header)
 *   - Caller must be an internal user (in user_roles with a non-client role)
 *   - client account is created with must_change_password: true in user_metadata
 *   - client_users row is inserted linking the new auth user to the client record
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

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  // ── Env vars ─────────────────────────────────────────────────────────────
  const supabaseUrl     = process.env.SUPABASE_URL
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars' })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let clientId, email
  try {
    const body = JSON.parse(event.body || '{}')
    clientId = body.clientId
    email    = body.email
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!clientId || !email) {
    return json(400, { error: 'clientId and email are required' })
  }

  // Basic email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Invalid email address' })
  }

  // ── Verify caller is an authenticated internal user ───────────────────────
  const authHeader = event.headers['authorization'] || event.headers['Authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'Authorization token required' })
  }
  const callerToken = authHeader.slice(7)

  // Verify caller token and get their user record
  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${callerToken}`,
      apikey: serviceRoleKey,
    },
  })

  if (!verifyRes.ok) {
    return json(401, { error: 'Invalid or expired authorization token' })
  }

  const callerUser = await verifyRes.json()
  const callerId   = callerUser?.id

  if (!callerId) {
    return json(401, { error: 'Could not identify caller' })
  }

  // Check caller is an internal staff member (in user_roles with non-client role)
  const roleCheckRes = await fetch(
    `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${callerId}&select=role`,
    {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        Accept: 'application/json',
      },
    }
  )

  if (!roleCheckRes.ok) {
    return json(500, { error: 'Failed to verify caller role' })
  }

  const roleRows = await roleCheckRes.json()
  const callerRole = roleRows?.[0]?.role

  if (!callerRole || callerRole === 'client') {
    return json(403, { error: 'Only internal staff can invite clients' })
  }

  // ── Check if client user already exists ──────────────────────────────────
  const existCheckRes = await fetch(
    `${supabaseUrl}/rest/v1/client_users?client_id=eq.${clientId}&select=id,auth_id`,
    {
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        Accept: 'application/json',
      },
    }
  )

  if (existCheckRes.ok) {
    const existing = await existCheckRes.json()
    if (existing?.length > 0) {
      return json(409, { error: 'This client already has a portal account' })
    }
  }

  // ── Create the Supabase auth user via admin inviteUserByEmail ─────────────
  const inviteRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      email_confirm: false,          // triggers invitation email from Supabase
      invite: true,
      user_metadata: {
        must_change_password: true,  // force password change on first login
        client_id:            clientId,
        role:                 'client',
      },
    }),
  })

  if (!inviteRes.ok) {
    const inviteErr = await inviteRes.json().catch(() => ({}))

    // Handle "user already registered" gracefully
    if (inviteErr?.msg?.includes('already registered') || inviteErr?.code === 'email_exists') {
      return json(409, { error: 'A user with this email already exists in the system' })
    }

    return json(500, {
      error: inviteErr?.msg || inviteErr?.message || 'Failed to create client account',
    })
  }

  const newUser = await inviteRes.json()
  const newUserId = newUser?.id

  if (!newUserId) {
    return json(500, { error: 'User created but ID not returned' })
  }

  // ── Insert into client_users table ────────────────────────────────────────
  const clientUserRes = await fetch(`${supabaseUrl}/rest/v1/client_users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      auth_id:    newUserId,
      client_id:  clientId,
      invited_at: new Date().toISOString(),
    }),
  })

  if (!clientUserRes.ok) {
    // Attempt cleanup — delete the auth user we just created
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${newUserId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    })
    return json(500, { error: 'Failed to link client user record — invite rolled back' })
  }

  return json(200, {
    success: true,
    message: `Invitation sent to ${email}`,
    userId:  newUserId,
  })
}
