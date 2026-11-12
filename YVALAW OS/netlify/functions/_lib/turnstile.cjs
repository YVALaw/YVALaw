/**
 * Cloudflare Turnstile ("are you a person?" check) for the public website forms.
 * The page gets a token from Cloudflare (assets/js/bot-check.js); lead-intake and application-intake send it here.
 * - No TURNSTILE_SECRET_KEY on Netlify: the check is off (everything passes) — it switches on when the key is saved.
 * - No token / a token Cloudflare rejects: not a person (or the check could not run) → the caller drops the submission.
 *   A real visitor's lead or application still reaches YVA by email (EmailJS / Netlify Forms run in the page).
 * - Cloudflare unreachable: let it through (a bot can't cause that) and log it.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

async function verifyTurnstile(token, ip, { fetchImpl = fetch } = {}) {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: true, skipped: true }
  if (!token || typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'no token' }
  try {
    const body = new URLSearchParams({ secret, response: token })
    if (ip) body.set('remoteip', ip)
    const r = await fetchImpl(VERIFY_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(6000) })
    const d = await r.json()
    if (d && d.success) return { ok: true }
    return { ok: false, reason: ((d && d['error-codes']) || []).join(',') || 'rejected' }
  } catch (e) {
    console.warn('turnstile: Cloudflare unreachable, letting it through:', e.message)
    return { ok: true, unavailable: true }
  }
}
module.exports = { verifyTurnstile, VERIFY_URL }
