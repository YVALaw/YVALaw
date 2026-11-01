/**
 * notifications-dispatch — Netlify scheduled function (every 5 minutes, see netlify.toml)
 * Emails (from the Gmail account chosen in Settings → Notifications) and pushes to phones any
 * notification created since the last run. Server code that creates notifications delivers
 * them right away too; this run catches anything left over (e.g. Gmail briefly down).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_CLIENT_SECRET (for email)
 */
const { dispatchPending } = require('./_lib/notify.cjs')

exports.handler = async function handler() {
  try {
    const r = await dispatchPending()
    return { statusCode: 200, body: JSON.stringify(r) }
  } catch (e) {
    console.error('notifications-dispatch', e)
    return { statusCode: 500, body: String(e.message || e) }
  }
}
