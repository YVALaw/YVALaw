/**
 * desktop-link-redeem — Netlify Function
 * Step 2 of "Sign in with YVA OS": the YVA Time desktop app exchanges the one-time code
 * (plus its PKCE verifier) for a magic-link token hash, then calls
 * supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) to get its OWN session —
 * separate from the browser's, so signing out of one does not affect the other.
 *
 * POST /.netlify/functions/desktop-link-redeem
 * Body:    { code: string, verifier: string }
 * Returns: { tokenHash, email, supabaseUrl, anonKey }
 *
 * Required Netlify env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) — the public anon key, handed to the app
 *
 * Security:
 *   - Code must exist, be unused and unexpired (5 min); it is marked used atomically
 *   - base64url(sha256(verifier)) must equal the challenge stored with the code
 *   - The login must still be linked to an employee record
 *   - Nothing is emailed: the admin generate_link call only returns the token hash
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

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !anonKey) return json(500, { error: 'Missing required env vars' })

  let code, verifier
  try {
    ({ code, verifier } = JSON.parse(event.body || '{}'))
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
  if (!empRes.ok || !(await empRes.json())?.[0]) {
    return json(403, { error: "This login isn't linked to an employee profile." })
  }

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

  return json(200, { tokenHash, email: authUser.email, supabaseUrl: SUPABASE_URL, anonKey })
}
