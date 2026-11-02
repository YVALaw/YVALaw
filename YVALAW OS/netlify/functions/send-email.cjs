/**
 * POST /.netlify/functions/send-email  (staff only, Bearer = the person's Supabase session)
 * Body: { to, cc?, subject, text, attachments?: [{ name, contentType: 'application/pdf', base64 }] }
 * Sends from the company Outlook mailbox (_lib/outlook.cjs). Who may send: CEO / Admin / Accounting, or staff granted
 * "Send invoices" (invoices.send) or "Send email from YVA OS" (email.send). Every attempt is written to public.email_log
 * first (status 'sending', so parallel requests are all counted), then marked sent / failed / blocked.
 * Limits: 100 emails per person per hour, 500 per day. Attachments: real PDFs only.
 *
 * Answers: 200 { ok, from } · 400 bad email · 401/403 · 429 limit · 503 { notSetUp, error } · 502 Microsoft error
 */
const { STAFF_ROLES, enc, rest, callerFromEvent, roleOf, hasPermission, json } = require('./_lib/supa.cjs')
const { checkEmail, EmailRuleError } = require('./_lib/emailRules.cjs')
const { sendMail, OutlookNotSetUp } = require('./_lib/outlook.cjs')

const PER_HOUR = 100, PER_DAY = 500

/** How many emails this person sent in the last `ms` (reads at most PER_DAY + 1 ids — cheap) */
async function countSince(userId, ms) {
  const since = new Date(Date.now() - ms).toISOString()
  const rows = await rest(`email_log?sent_by=eq.${enc(userId)}&created_at=gte.${enc(since)}&status=neq.blocked&select=id&limit=${PER_DAY + 2}`)
  return rows.length
}

const SENDER_ROLES = ['ceo', 'admin', 'accounting']
const missingLog = e => e && (e.status === 404 || /email_log/.test(e.message || ''))

async function mark(id, patch) {
  if (!id) return
  try { await rest(`email_log?id=eq.${enc(id)}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }) }
  catch (e) { console.error('send-email: could not update email_log', e.message) }
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {})
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })
  try {
    const caller = await callerFromEvent(event)
    if (!caller) return json(401, { error: 'Please sign in again.' })
    const role = await roleOf(caller.id)
    if (!STAFF_ROLES.includes(role)) return json(403, { error: 'Only YVA staff can send email from YVA OS.' })
    if (!SENDER_ROLES.includes(role) && !(await hasPermission(caller.id, 'invoices.send')) && !(await hasPermission(caller.id, 'email.send'))) {
      return json(403, { error: 'You need the "Send email from YVA OS" permission (Settings → Team Access → Permissions).' })
    }

    let body
    try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '{}')) }
    catch { return json(400, { error: 'The request could not be read.' }) }
    let m
    try { m = checkEmail(body) } catch (e) { if (e instanceof EmailRuleError) return json(400, { error: e.message }); throw e }

    const base = {
      sent_by: caller.id, sent_by_email: caller.email || null,
      to_addresses: m.to, cc_addresses: m.cc, subject: m.subject,
      attachments: m.attachments.map(a => ({ name: a.name, size: a.size })),
    }
    // Write the log row first, then count (it includes this one and any sent at the same moment). Before
    // migrate-outlook-email.sql there is no log table: email still goes, without log or limits. Any other log
    // problem stops the email (no limits = no sending).
    let logId = null
    try {
      const rows = await rest('email_log', { method: 'POST', body: { ...base, status: 'sending' }, prefer: 'return=representation' })
      logId = rows?.[0]?.id || null
      const [hour, day] = await Promise.all([countSince(caller.id, 3600_000), countSince(caller.id, 86_400_000)])
      if (hour > PER_HOUR || day > PER_DAY) {
        await mark(logId, { status: 'blocked', error: 'Sending limit reached' })
        return json(429, { error: hour > PER_HOUR
          ? `You have sent ${PER_HOUR} emails in the last hour — the limit. Try again in a little while.`
          : `You have sent ${PER_DAY} emails today — the daily limit. Try again tomorrow.` })
      }
    } catch (e) {
      if (!missingLog(e)) throw e
    }

    try {
      const r = await sendMail({ to: m.to, cc: m.cc, subject: m.subject, text: m.text, attachments: m.attachments })
      await mark(logId, { status: 'sent', from_address: r.from })
      return json(200, { ok: true, from: r.from })
    } catch (e) {
      await mark(logId, { status: 'failed', error: String(e.message).slice(0, 1000) })
      if (e instanceof OutlookNotSetUp) return json(503, { notSetUp: true, error: e.message })
      return json(502, { error: e.message })
    }
  } catch (e) {
    console.error('send-email', e)
    return json(500, { error: `Email could not be sent: ${e.message}` })
  }
}
