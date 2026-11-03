/**
 * weekly-reminder-test — POST, CEO or Admin only. Settings → Notifications → Weekly reminder email → "Email me a test now".
 * Builds the weekly summary from today's data and sends it right away to the signed-in person's own login email
 * (never to the saved recipients). Doesn't touch weekly_reminder_last_sent, so the real weekly email still goes out.
 *
 * Body (optional): { include: ['drafts' | 'unpaid' | 'weekly_close', …] } — the sections ticked on screen (saved or not).
 * → { ok, to, subject, counts } · 401 / 403 · 503 { notSetUp } (Outlook not set up) · 502 (Microsoft refused)
 */
const { callerFromEvent, roleOf, json } = require('./_lib/supa.cjs')
const R = require('./_lib/weeklyReminder.cjs')
const { sendMail, OutlookNotSetUp } = require('./_lib/outlook.cjs')

const ALLOWED = ['ceo', 'admin']

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  let user
  try {
    user = await callerFromEvent(event)
    if (!user) return json(401, { error: 'Please sign in again.' })
    if (!ALLOWED.includes(await roleOf(user.id))) return json(403, { error: 'Only the CEO or an Admin can send the weekly reminder test.' })
  } catch (e) {
    console.error('weekly-reminder-test (auth)', e.message)
    return json(500, { error: 'Could not check who you are. Try again.' })
  }
  const to = R.cleanEmails([user.email])
  if (!to.length) return json(400, { error: 'Your login has no email address to send the test to.' })
  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }
  try {
    const { row, cfg, tz } = await R.loadConfig()
    const include = Array.isArray(body.include) ? R.SECTIONS.filter(s => body.include.includes(s)) : cfg.include
    const data = await R.loadReminderData({ include, tz })
    const mail = R.buildReminder({ include, ...data, companyName: row.company_name || 'YVA Staffing', test: true })
    await sendMail({ to, subject: mail.subject, html: mail.html })
    return json(200, { ok: true, to: to[0], subject: mail.subject, counts: mail.counts })
  } catch (e) {
    console.error('weekly-reminder-test', e.message)
    if (e instanceof OutlookNotSetUp) return json(503, { notSetUp: true, error: e.message })
    if (/^Microsoft/.test(e.message || '')) return json(502, { error: e.message })
    return json(500, { error: `Could not build the summary: ${String(e.message || e).slice(0, 200)}` })
  }
}
