/**
 * payroll — POST, staff with payroll.manage (CEO by default).
 *   { action: 'prepare', payday }   build / refresh the Friday payroll (see _lib/payroll.cjs)
 * Marking people paid uses the payroll_mark_paid SQL function straight from the browser.
 */
const { callerFromEvent, hasPermission, json } = require('./_lib/supa.cjs')
const { preparePayroll } = require('./_lib/payroll.cjs')

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const user = await callerFromEvent(event)
    if (!user) return json(401, { error: 'Please sign in again.' })
    if (!(await hasPermission(user.id, 'payroll.manage'))) return json(403, { error: 'You do not have permission to run payroll.' })
    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request' }) }
    if (body.action !== 'prepare') return json(400, { error: 'Unknown action' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.payday || '')) return json(400, { error: 'payday must be YYYY-MM-DD' })
    return json(200, await preparePayroll(body.payday, { by: user.id }))
  } catch (e) {
    console.error('payroll', e)
    return json(/Friday/.test(e.message) ? 400 : 500, { error: e.message })
  }
}
