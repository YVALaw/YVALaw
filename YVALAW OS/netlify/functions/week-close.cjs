/**
 * week-close — POST, staff with the weekly_close.manage permission (CEO by default).
 *   { action: 'prepare', weekStart? }  prepare (or prepare again) a week; default = last finished week
 *   { action: 'approve', weekStart }   approve all the week's hours (week_close_approve, as the caller)
 * Invoices are sent from the browser with the caller's Gmail (Weekly close → Send).
 */
const { callerFromEvent, hasPermission, json } = require('./_lib/supa.cjs')
const { prepareWeek, lastWeekStart } = require('./_lib/weekclose.cjs')

async function rpcAsCaller(event, name, args) {
  const h = event.headers || {}
  const res = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { Authorization: h.authorization || h.Authorization, apikey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `Approve failed (${res.status})`)
  return data
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    const user = await callerFromEvent(event)
    if (!user) return json(401, { error: 'Please sign in again.' })
    if (!(await hasPermission(user.id, 'weekly_close.manage'))) return json(403, { error: 'You do not have permission to run the weekly close.' })
    let body = {}
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request' }) }
    const weekStart = body.weekStart || lastWeekStart()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return json(400, { error: 'weekStart must be YYYY-MM-DD' })
    if (body.action === 'prepare') return json(200, await prepareWeek(weekStart, { by: user.id }))
    if (body.action === 'approve') return json(200, await rpcAsCaller(event, 'week_close_approve', { p_week_start: weekStart }))
    return json(400, { error: 'Unknown action' })
  } catch (e) {
    console.error('week-close', e)
    return json(e.message?.includes('not over') || e.message?.includes('Monday') ? 400 : 500, { error: e.message })
  }
}
