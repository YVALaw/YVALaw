/**
 * desktop-link-create — Netlify Function
 * Step 1 of "Sign in with YVA OS" for the YVA Time desktop app.
 * Called by the /connect-app page while the person is logged in to YVA OS.
 *
 * POST /.netlify/functions/desktop-link-create
 * Headers: Authorization: Bearer <YVA OS access_token>
 * Body:    { challenge: string }   base64url(sha256(verifier)); the verifier never leaves the app
 *
 * Returns: { code, expiresIn }     a one-time code (5 minutes) the page hands to the app
 *                                  through yvatime://auth?code=…
 *
 * Security:
 *   - Only logins linked to an employee record (employees.user_id) can connect the app
 *   - Only sha256(code) is stored; the code is useless without the app's verifier
 *     (checked by desktop-link-redeem), so an intercepted link can't be redeemed
 */

const crypto = require('crypto')

const CODE_TTL_SECONDS = 300

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'Missing required env vars' })

  let challenge
  try {
    challenge = JSON.parse(event.body || '{}').challenge
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return json(400, { error: 'Open this page from the YVA Time app' })
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_SERVICE_ROLE_KEY },
  })
  if (!userRes.ok) return json(401, { error: 'Invalid or expired token' })
  const user = await userRes.json()
  if (!user?.id) return json(401, { error: 'Invalid or expired token' })

  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/employees?user_id=eq.${enc(user.id)}&select=id&limit=1`, {
    headers: serviceHeaders({ Accept: 'application/json' }),
  })
  if (!empRes.ok) return json(500, { error: 'Could not check your employee profile' })
  if (!(await empRes.json())?.[0]) {
    return json(403, { error: "Your login isn't linked to an employee profile yet. Ask YVA to link it." })
  }

  const code = crypto.randomBytes(24).toString('base64url')
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/desktop_link_codes`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({
      code_hash:  crypto.createHash('sha256').update(code).digest('hex'),
      user_id:    user.id,
      challenge,
      expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
    }),
  })
  if (!insertRes.ok) return json(500, { error: 'Could not create a sign-in code' })

  // Housekeeping: drop codes that expired more than a day ago
  await fetch(
    `${SUPABASE_URL}/rest/v1/desktop_link_codes?expires_at=lt.${enc(new Date(Date.now() - 86400000).toISOString())}`,
    { method: 'DELETE', headers: serviceHeaders({ Prefer: 'return=minimal' }) },
  ).catch(() => {})

  return json(200, { code, expiresIn: CODE_TTL_SECONDS })
}
