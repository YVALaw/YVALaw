/**
 * GET /.netlify/functions/email-status[?check=1]  (staff only)
 * { configured, mailbox, missing[] } — which company mailbox YVA OS sends from. With ?check=1 it also signs in
 * to Microsoft (no email is sent) and adds { ok, problem } so Settings can show "Connected" or the exact reason.
 */
const { STAFF_ROLES, callerFromEvent, roleOf, json } = require('./_lib/supa.cjs')
const { emailConfigured, graphToken } = require('./_lib/outlook.cjs')

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {})
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' })
  try {
    const caller = await callerFromEvent(event)
    if (!caller) return json(401, { error: 'Please sign in again.' })
    if (!STAFF_ROLES.includes(await roleOf(caller.id))) return json(403, { error: 'Staff only.' })
    const status = emailConfigured()
    if (!(event.queryStringParameters || {}).check || !status.configured) return json(200, status)
    try { await graphToken(); return json(200, { ...status, ok: true }) }
    catch (e) { return json(200, { ...status, ok: false, problem: e.message }) }
  } catch (e) {
    console.error('email-status', e)
    return json(500, { error: e.message })
  }
}
