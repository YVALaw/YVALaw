/**
 * weekly-reminder — Netlify scheduled function, every hour at :23 (root netlify.toml).
 * Sends the "Weekly reminder email" (Settings → Notifications) once a week: on the chosen weekday, from the chosen hour
 * on, in the business time zone (settings.business_timezone, default America/Santo_Domingo). A missed run or a failed
 * send is caught up at the next hourly check that same day.
 *
 * Each week is claimed with a conditional update of settings.weekly_reminder_last_sent first, so two runs at the same
 * time can't both send; if the send fails the claim is given back. Failures are logged, never thrown.
 * The "Email me a test now" button uses weekly-reminder-test.cjs (scheduled functions can't be called by URL).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MS_* (company Outlook mailbox)
 */
const { rest, enc } = require('./_lib/supa.cjs')
const M = require('./_lib/money.cjs')
const R = require('./_lib/weeklyReminder.cjs')
const { sendMail } = require('./_lib/outlook.cjs')

const done = (body) => ({ statusCode: 200, body: JSON.stringify(body) })

async function run(now = Date.now()) {
  const { row, cfg, tz } = await R.loadConfig()
  const due = R.isDue(cfg, now, tz)
  if (!due.due) return { sent: false, reason: due.reason }

  const to = cfg.recipients.length ? cfg.recipients : await R.ceoEmails()
  if (!to.length) { console.error('weekly-reminder: no recipients (add one in Settings → Notifications)'); return { sent: false, reason: 'no recipients' } }

  // Claim this week (only if nobody sent since this week's Monday midnight)
  const weekStartIso = new Date(M.zonedMidnight(due.weekKey, tz)).toISOString()
  const stamp = new Date(now).toISOString()
  const claimed = await rest(`settings?id=eq.1&or=(weekly_reminder_last_sent.is.null,weekly_reminder_last_sent.lt.${enc(weekStartIso)})`, {
    method: 'PATCH', prefer: 'return=representation', body: { weekly_reminder_last_sent: stamp },
  })
  if (!claimed?.length) return { sent: false, reason: 'already sent this week' }

  try {
    const data = await R.loadReminderData({ include: cfg.include, tz, now })
    const mail = R.buildReminder({ include: cfg.include, ...data, companyName: row.company_name || 'YVA Staffing' })
    await sendMail({ to, subject: mail.subject, html: mail.html })
    return { sent: true, to, subject: mail.subject, counts: mail.counts }
  } catch (e) {
    // Give the week back so the next hourly check tries again (only if the stamp is still ours)
    await rest(`settings?id=eq.1&weekly_reminder_last_sent=eq.${enc(stamp)}`, { method: 'PATCH', body: { weekly_reminder_last_sent: cfg.lastSent } })
      .catch(err => console.error('weekly-reminder: could not release the week', err.message))
    throw e
  }
}

exports.handler = async function handler() {
  try {
    const r = await run()
    if (r.sent) console.log(`weekly-reminder: sent to ${r.to.join(', ')}`)
    return done(r)
  } catch (e) {
    console.error('weekly-reminder failed:', e.message || e)
    return done({ sent: false, error: String(e.message || e).slice(0, 500) })
  }
}
exports.run = run
