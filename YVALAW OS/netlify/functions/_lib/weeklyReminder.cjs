/**
 * Weekly reminder email (Settings → Notifications → "Weekly reminder email").
 *
 * Settings live on the one `settings` row (supabase/migrate-weekly-reminder.sql, all nullable):
 *   weekly_reminder_enabled     boolean   NULL/false = off
 *   weekly_reminder_day         smallint  0 = Sunday … 6 = Saturday (NULL = Monday)
 *   weekly_reminder_hour        smallint  0–23 in the business time zone (NULL = 8 am)
 *   weekly_reminder_recipients  text[]    NULL/empty = every CEO login's email
 *   weekly_reminder_include     text[]    which sections (NULL = all of SECTIONS)
 *   weekly_reminder_last_sent   timestamptz  when the scheduled email last went out (tests never set it)
 *
 * Pure part (unit-tested in tests/weeklyReminder.test.ts): normalizeConfig, weekKey, isDue, buildReminder.
 * The rest reads the database (service role) and sends through the company Outlook mailbox.
 */
const M = require('./money.cjs')
const { rest, restAll, enc, APP_URL } = require('./supa.cjs')

const SECTIONS = ['drafts', 'unpaid', 'weekly_close']
const DEFAULT_DAY = 1      // Monday
const DEFAULT_HOUR = 8     // 8 am business time
const UNPAID = ['sent', 'viewed', 'overdue', 'partial']
const MAX_LINES = 10
const EMAIL_RE = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/

const intIn = (v, lo, hi, dflt) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isInteger(n) && n >= lo && n <= hi ? n : dflt }

/** Clean addresses from a stored list (text[] or an old comma string): valid, once each, at most 10 */
function cleanEmails(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/)
  const out = [], seen = new Set()
  for (const raw of parts) {
    const e = String(raw ?? '').trim()
    if (!e || !EMAIL_RE.test(e) || seen.has(e.toLowerCase())) continue
    seen.add(e.toLowerCase()); out.push(e)
  }
  return out.slice(0, 10)
}

/** The settings row → a config with defaults. `ready` = the SQL has run (the columns exist). */
function normalizeConfig(row) {
  const r = row || {}
  const include = Array.isArray(r.weekly_reminder_include) ? SECTIONS.filter(s => r.weekly_reminder_include.includes(s)) : SECTIONS.slice()
  return {
    ready: 'weekly_reminder_enabled' in r,
    enabled: r.weekly_reminder_enabled === true,
    day: intIn(r.weekly_reminder_day, 0, 6, DEFAULT_DAY),
    hour: intIn(r.weekly_reminder_hour, 0, 23, DEFAULT_HOUR),
    recipients: cleanEmails(r.weekly_reminder_recipients),
    include,
    lastSent: r.weekly_reminder_last_sent || null,
  }
}

/** The Monday (YYYY-MM-DD) of the week `ms` falls in, on the clock of `tz` — the same for every hour of that week, DST or not */
function weekKey(ms, tz = M.DEFAULT_TZ) {
  return M.mondayOf(M.localParts(ms, M.safeTz(tz)).date)
}

/**
 * Should the scheduled run send now? Due on the chosen weekday from the chosen hour on (a missed hourly run or a
 * failed send is caught up later the same day), at most once per Monday–Sunday week.
 */
function isDue(cfg, nowMs, tz = M.DEFAULT_TZ) {
  const zone = M.safeTz(tz)
  const wk = weekKey(nowMs, zone)
  if (!cfg.ready) return { due: false, reason: 'not set up (run supabase/migrate-weekly-reminder.sql)', weekKey: wk }
  if (!cfg.enabled) return { due: false, reason: 'turned off', weekKey: wk }
  const last = cfg.lastSent ? Date.parse(cfg.lastSent) : NaN
  if (Number.isFinite(last) && weekKey(last, zone) === wk) return { due: false, reason: 'already sent this week', weekKey: wk }
  const p = M.localParts(nowMs, zone)
  if (p.weekday !== cfg.day) return { due: false, reason: 'not the reminder day', weekKey: wk }
  if (p.hour < cfg.hour) return { due: false, reason: 'not the reminder hour yet', weekKey: wk }
  return { due: true, reason: 'due', weekKey: wk }
}

const money = n => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDay = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * Build the email from loaded rows.
 *   invoices: [{ number, client_name, subtotal, amount_paid, status, due_date, date }] (drafts + unpaid statuses)
 *   close:    the week_closes row of last week, null = not prepared, undefined = weekly close not set up (section left out)
 *   today:    YYYY-MM-DD in the business zone; lastWeek: Monday of the finished week
 * Returns { subject, text, html, counts }.
 */
function buildReminder({ include = SECTIONS, invoices = [], close, today, lastWeek, appUrl = APP_URL, companyName = 'YVA Staffing', test = false, tzLabel = 'Dominican Republic time' }) {
  const url = p => `${appUrl}${p}`
  const sections = []
  const counts = {}

  if (include.includes('drafts')) {
    const drafts = invoices.filter(i => String(i.status || 'draft').toLowerCase() === 'draft')
    const total = drafts.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
    counts.drafts = drafts.length
    sections.push({
      title: drafts.length ? `${plural(drafts.length, 'invoice')} still in draft (${money(total)})` : 'No invoices waiting in draft',
      lines: drafts.slice(0, MAX_LINES).map(i => `${i.number || 'Draft'} · ${i.client_name || 'No client'} · ${money(i.subtotal)}${i.date ? ` · dated ${fmtDay(i.date)}` : ''}`),
      more: Math.max(0, drafts.length - MAX_LINES),
      link: drafts.length ? { label: 'Review drafts', href: url('invoice') } : null,
    })
  }

  if (include.includes('unpaid')) {
    const open = invoices
      .filter(i => UNPAID.includes(String(i.status || '').toLowerCase()))
      .map(i => ({ ...i, balance: Math.round(((Number(i.subtotal) || 0) - (Number(i.amount_paid) || 0)) * 100) / 100 }))
      .filter(i => i.balance > 0.004)
      .map(i => ({ ...i, late: String(i.status).toLowerCase() === 'overdue' || (!!i.due_date && i.due_date < today) }))
      .sort((a, b) => Number(b.late) - Number(a.late) || String(a.due_date || a.date || '').localeCompare(String(b.due_date || b.date || '')))
    const owed = open.reduce((s, i) => s + i.balance, 0)
    const late = open.filter(i => i.late)
    counts.unpaid = open.length; counts.overdue = late.length; counts.owed = Math.round(owed * 100) / 100
    sections.push({
      title: open.length
        ? `${plural(open.length, 'unpaid invoice')} · ${money(owed)} owed${late.length ? ` · ${late.length} overdue (${money(late.reduce((s, i) => s + i.balance, 0))})` : ''}`
        : 'No unpaid invoices',
      lines: open.slice(0, MAX_LINES).map(i => {
        const due = i.due_date ? (i.late && i.due_date < today ? `due ${fmtDay(i.due_date)} (${plural(daysBetween(i.due_date, today), 'day')} late)` : `due ${fmtDay(i.due_date)}`) : ''
        return `${i.late ? 'OVERDUE · ' : ''}${i.number || 'Invoice'} · ${i.client_name || 'No client'} · ${money(i.balance)} owed${due ? ` · ${due}` : ''}`
      }),
      more: Math.max(0, open.length - MAX_LINES),
      link: open.length ? { label: 'Open invoices', href: url('invoice') } : null,
    })
  }

  if (include.includes('weekly_close') && close !== undefined) {
    const range = lastWeek ? `${fmtDay(lastWeek)} – ${fmtDay(M.addDays(lastWeek, 6))}` : 'Last week'
    const status = close ? String(close.status || '') : null
    counts.weeklyClose = status || 'not_prepared'
    sections.push({
      title: status === 'approved' ? `Last week's close (${range}) is approved`
        : close ? `Last week's close (${range}) is waiting for approval`
        : `Last week's close (${range}) hasn't been prepared yet`,
      lines: close?.summary && typeof close.summary === 'object' && close.summary.invoices != null
        ? [`${plural(Number(close.summary.invoices) || 0, 'invoice')} · ${money(close.summary.total)}${close.summary.flags ? ` · ${plural(Number(close.summary.flags), 'thing')} to check` : ''}`]
        : [],
      more: 0,
      link: status === 'approved' ? null : { label: 'Open Weekly close', href: url('weekly-close') },
    })
  }

  const bits = []
  if (counts.drafts) bits.push(plural(counts.drafts, 'draft'))
  if (counts.unpaid) bits.push(`${counts.unpaid} unpaid (${money(counts.owed)})`)
  if (counts.weeklyClose && counts.weeklyClose !== 'approved') bits.push('weekly close to approve')
  const subject = `${test ? '[Test] ' : ''}YVA OS weekly summary — ${bits.length ? bits.join(', ') : 'all clear'}`
  const intro = test
    ? 'This is a test of your weekly reminder email. The real one goes out on the day and time set in YVA OS → Settings → Notifications.'
    : `Your weekly summary from YVA OS (${today ? fmtDay(today) : 'this week'}).`
  const foot = `Change the day, time (${tzLabel}), recipients or contents in YVA OS → Settings → Notifications → Weekly reminder email.`

  const text = [
    intro, '',
    ...(sections.length ? sections.flatMap(s => [s.title.toUpperCase(), ...s.lines.map(l => `  • ${l}`), ...(s.more ? [`  • …and ${s.more} more`] : []), ...(s.link ? [`  ${s.link.label}: ${s.link.href}`] : []), '']) : ['Nothing is selected for this email.', '']),
    `Open YVA OS: ${appUrl}`, '', `— ${companyName} · ${foot}`,
  ].join('\n')

  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;color:#1b1e2b;font-size:14px;line-height:1.55">
<div style="border-left:4px solid #facc15;padding:4px 0 4px 14px;margin-bottom:14px"><div style="font-size:18px;font-weight:700">YVA OS weekly summary</div><div style="color:#6b7280;font-size:13px">${escapeHtml(intro)}</div></div>
${sections.length ? sections.map(s => `<div style="margin:0 0 16px">
<div style="font-weight:700;font-size:15px;margin-bottom:4px">${escapeHtml(s.title)}</div>
${s.lines.length || s.more ? `<ul style="margin:4px 0 6px;padding-left:20px">${s.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}${s.more ? `<li style="color:#6b7280">…and ${s.more} more</li>` : ''}</ul>` : ''}
${s.link ? `<a href="${escapeHtml(s.link.href)}" style="color:#1b1e2b;font-weight:600">${escapeHtml(s.link.label)} →</a>` : ''}
</div>`).join('\n') : '<p>Nothing is selected for this email.</p>'}
<p><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#facc15;color:#1b1e2b;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px">Open YVA OS</a></p>
<p style="font-size:12px;color:#6b7280">${escapeHtml(companyName)} · ${escapeHtml(foot)}</p></div>`

  return { subject, text, html, counts }
}

// ── Database (service role) ─────────────────────────────────────────────────

/** The settings row (select=* so it works before the SQL runs), its config and business time zone */
async function loadConfig() {
  const [row] = await rest('settings?id=eq.1&select=*')
  return { row: row || {}, cfg: normalizeConfig(row), tz: M.safeTz(row?.business_timezone) }
}

/** Every CEO login's email — the default recipients */
async function ceoEmails() {
  const rows = await rest('user_roles?role=eq.ceo&select=email')
  return cleanEmails(rows.map(r => r.email))
}

/** Rows the email needs: open invoices (paged), and last week's close (undefined when weekly close isn't set up) */
async function loadReminderData({ include, tz, now = Date.now() }) {
  const today = M.localParts(now, tz).date
  const lastWeek = M.addDays(M.mondayOf(today), -7)
  const wantInvoices = include.includes('drafts') || include.includes('unpaid')
  const statuses = [...(include.includes('drafts') ? ['draft'] : []), ...(include.includes('unpaid') ? UNPAID : [])]
  const [invoices, close] = await Promise.all([
    wantInvoices ? restAll(`invoices?status=in.(${statuses.join(',')})&select=id,number,client_name,subtotal,amount_paid,status,due_date,date&order=date.desc`) : [],
    include.includes('weekly_close')
      ? rest(`week_closes?week_start=eq.${enc(lastWeek)}&select=status,summary&limit=1`).then(r => r[0] || null).catch(e => { if (e.status === 404 || e.status === 400) return undefined; throw e })
      : undefined,
  ])
  return { invoices, close, today, lastWeek }
}

module.exports = { SECTIONS, DEFAULT_DAY, DEFAULT_HOUR, cleanEmails, normalizeConfig, weekKey, isDue, buildReminder, loadConfig, ceoEmails, loadReminderData }
