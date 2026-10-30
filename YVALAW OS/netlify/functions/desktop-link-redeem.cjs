/**
 * desktop-link-redeem — Netlify Function
 * Step 2 of "Sign in with YVA OS": the YVA Time desktop app exchanges the one-time code
 * (plus its PKCE verifier) for its OWN Supabase session — separate from the browser's, so
 * signing out of one does not affect the other — and the computer is recorded in
 * desktop_devices. Desktop time is only accepted from a recorded computer that YVA has not
 * disconnected (see supabase/migrate-yva-time-phase3.sql).
 *
 * POST /.netlify/functions/desktop-link-redeem
 * Body:    { code: string, verifier: string, device?: { name, platform, appVersion } }
 * Returns: { session: { access_token, refresh_token, expires_in, expires_at, token_type },
 *            deviceId, email, supabaseUrl, anonKey }
 *
 * Required Netlify env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) — the public anon key, handed to the app
 *
 * Security:
 *   - Code must exist, be unused and unexpired (5 min); it is marked used atomically
 *   - base64url(sha256(verifier)) must equal the challenge stored with the code
 *   - The login must still be linked to an employee record
 *   - Nothing is emailed: the admin generate_link call only returns the token hash, which
 *     is exchanged for a session right here
 *   - If the computer can't be recorded, that session is ended again
 */

const crypto = require('crypto')

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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

const INVALID = 'This sign-in code is invalid or has expired. Start again from the YVA Time app.'

/** Claims of a JWT that GoTrue just issued to us (so no signature check is needed here) */
function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

/** Computer name etc. from the app: plain text, short */
function clean(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !anonKey) return json(500, { error: 'Missing required env vars' })

  let code, verifier, device
  try {
    ({ code, verifier, device } = JSON.parse(event.body || '{}'))
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(code)) return json(400, { error: INVALID })
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return json(400, { error: INVALID })

  const codeHash = crypto.createHash('sha256').update(code).digest('hex')
  const nowIso = new Date().toISOString()
  const rowRes = await fetch(
    `${SUPABASE_URL}/rest/v1/desktop_link_codes?code_hash=eq.${codeHash}&used_at=is.null&expires_at=gt.${enc(nowIso)}&select=user_id,challenge`,
    { headers: serviceHeaders({ Accept: 'application/json' }) },
  )
  if (!rowRes.ok) return json(500, { error: 'Could not check the sign-in code' })
  const row = (await rowRes.json())?.[0]
  if (!row) return json(400, { error: INVALID })

  const expected = Buffer.from(row.challenge)
  const actual   = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'))
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return json(400, { error: INVALID })
  }

  // Single use: only the request that flips used_at from null wins
  const useRes = await fetch(`${SUPABASE_URL}/rest/v1/desktop_link_codes?code_hash=eq.${codeHash}&used_at=is.null`, {
    method: 'PATCH',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ used_at: nowIso }),
  })
  const used = useRes.ok ? await useRes.json().catch(() => []) : []
  if (!Array.isArray(used) || used.length !== 1) return json(400, { error: INVALID })

  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?user_id=eq.${enc(row.user_id)}&select=id&limit=1`, {
    headers: serviceHeaders({ Accept: 'application/json' }),
  })
  const employee = empRes.ok ? (await empRes.json())?.[0] : null
  if (!employee) return json(403, { error: "This login isn't linked to an employee profile." })

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${enc(row.user_id)}`, { headers: serviceHeaders() })
  const authUser = userRes.ok ? await userRes.json() : null
  if (!authUser?.email) return json(400, { error: INVALID })

  const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ type: 'magiclink', email: authUser.email }),
  })
  const link = linkRes.ok ? await linkRes.json().catch(() => null) : null
  const tokenHash = link?.hashed_token || link?.properties?.hashed_token
  if (!tokenHash) return json(500, { error: 'Could not start your session' })

  // Exchange the token hash for the app's own session (what verifyOtp does in a browser)
  const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
  })
  const session = verifyRes.ok ? await verifyRes.json().catch(() => null) : null
  const claims = jwtClaims(session?.access_token)
  if (!session?.access_token || !session?.refresh_token || claims.sub !== row.user_id || !claims.session_id) {
    return json(500, { error: 'Could not start your session' })
  }

  const devRes = await fetch(`${SUPABASE_URL}/rest/v1/desktop_devices`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({
      employee_id: employee.id,
      user_id:     row.user_id,
      session_id:  claims.session_id,
      name:        clean(device?.name, 80) || 'Computer',
      platform:    clean(device?.platform, 20) || null,
      app_version: clean(device?.appVersion, 40) || null,
    }),
  })
  const deviceRow = devRes.ok ? (await devRes.json().catch(() => []))?.[0] : null
  if (!deviceRow?.id) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {})
    return json(500, { error: 'Could not register this computer. Try again in a moment.' })
  }

  return json(200, {
    session: {
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
      expires_in:    session.expires_in,
      expires_at:    session.expires_at,
      token_type:    session.token_type || 'bearer',
    },
    deviceId: deviceRow.id,
    email: authUser.email,
    supabaseUrl: SUPABASE_URL,
    anonKey,
  })
}
