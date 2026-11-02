/**
 * POST /.netlify/functions/send-email  (staff only, Bearer = the person's Supabase session)
 * Body: { to, cc?, subject, text, attachments?: [{ name, contentType: 'application/pdf', base64 }] }
 * Sends from the company Outlook mailbox (_lib/outlook.cjs). Every attempt is written to public.email_log
 * (who, to whom, subject, attachment names, result). Limits: 100 emails per person per hour, 500 per day.
 *
 * Answers: 200 { ok, from } · 400 bad email · 401/403 · 429 limit · 503 { notSetUp, error } · 502 Microsoft error
 */
const { STAFF_ROLES, enc, rest, callerFromEvent, roleOf, json } = require('./_lib/supa.cjs')
const { checkEmail, EmailRuleError } = require('./_lib/emailRules.cjs')
const { sendMail, OutlookNotSetUp } = require('./_lib/outlook.cjs')

const PER_HOUR = 100, PER_DAY = 500

/** How many emails this person sent in the last `ms` (reads at most PER_DAY + 1 ids — cheap) */
async function countSince(userId, ms) {
  const since = new Date(Date.now() - ms).toISOString()
  const rows = await rest(`email_log?sent_by=eq.${enc(userId)}&created_at=gte.${enc(since)}&select=id&limit=${PER_DAY + 1}`)
  return rows.length
}

async function log(row) {
  try { await rest('email_log', { method: 'POST', body: row, prefer: 'return=minimal' }) }
  catch (e) { console.error('send-email: could not write email_log', e.message) }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {})
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  try {
    const caller = await callerFromEvent(event)
    if (!caller) return json(401, { error: 'Please sign in again.' })
    const role = await roleOf(caller.id)
    if (!STAFF_ROLES.includes(role)) return json(403, { error: 'Only YVA staff can send email from YVA OS.' })

    let body
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}')) }
    catch { return json(400, { error: 'The request could not be read.' }) }
    let m
    try { m = checkEmail(body) } catch (e) { if (e instanceof EmailRuleError) return json(400, { error: e.message }); throw e }

    // Limits come from the log; before migrate-outlook-email.sql runs there is no log table → no limit, no log
    let logOn = true, hour = 0, day = 0
    try { [hour, day] = await Promise.all([countSince(caller.id, 3600_000), countSince(caller.id, 86_400_000)]) }
    catch (e) { if (e.status === 404 || /email_log/.test(e.message)) logOn = false; else throw e }
    if (hour >= PER_HOUR) return json(429, { error: `You have sent ${PER_HOUR} emails in the last hour — the limit. Try again in a little while.` })
    if (day >= PER_DAY) return json(429, { error: `You have sent ${PER_DAY} emails today — the daily limit. Try again tomorrow.` })

    const base = {
      sent_by: caller.id, sent_by_email: caller.email || null,
      to_addresses: m.to, cc_addresses: m.cc, subject: m.subject,
      attachments: m.attachments.map(a => ({ name: a.name, size: a.size })),
    }
    try {
      const r = await sendMail({ to: m.to, cc: m.cc, subject: m.subject, text: m.text, attachments: m.attachments })
      if (logOn) await log({ ...base, status: 'sent', from_address: r.from })
      return json(200, { ok: true, from: r.from })
    } catch (e) {
      if (logOn) await log({ ...base, status: 'failed', error: String(e.message).slice(0, 1000) })
      if (e instanceof OutlookNotSetUp) return json(503, { notSetUp: true, error: e.message })
      return json(502, { error: e.message })
    }
  } catch (e) {
    console.error('send-email', e)
    return json(500, { error: `Email could not be sent: ${e.message}` })
  }
}
