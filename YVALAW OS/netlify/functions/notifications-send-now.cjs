/**
 * notifications-send-now — POST, any logged-in staff member or employee.
 * Delivers pending notifications immediately (instead of waiting up to 5 minutes).
 * Body { test: true } first creates a test notification for the caller
 * (Settings → Notifications → "Send me a test").
 */
const { callerFromEvent, roleOf, json, STAFF_ROLES } = require('./_lib/supa.cjs')
const { notify, dispatchPending } = require('./_lib/notify.cjs')

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const user = await callerFromEvent(event)
    if (!user) return json(401, { error: 'Please sign in again.' })
    const role = await roleOf(user.id)
    if (!STAFF_ROLES.includes(role) && role !== 'employee') return json(403, { error: 'Not allowed' })
    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch { /* empty */ }
    if (body.test) {
      await notify(user.id, { kind: 'test', title: 'Test notification from YVA OS', body: 'If you can read this, notifications reach you here.', link: role === 'employee' ? '/me' : '/settings' })
    }
    const r = await dispatchPending()
    return json(200, r)
  } catch (e) {
    console.error('notifications-send-now', e)
    return json(500, { error: e.message })
  }
}
