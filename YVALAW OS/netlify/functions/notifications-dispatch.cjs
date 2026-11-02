/**
 * notifications-dispatch — Netlify scheduled function (every 5 minutes, see netlify.toml)
 * Emails (from the company Outlook mailbox, _lib/outlook.cjs) and pushes to phones any
 * notification created since the last run. Server code that creates notifications delivers
 * them right away too; this run catches anything left over (e.g. Microsoft briefly down).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_MAILBOX (for email)
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
