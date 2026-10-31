/**
 * Pure money/time rules shared by the weekly close, live earnings and payroll functions.
 * The browser has the same rules in src/utils/rates.ts, src/utils/periods.ts and
 * src/utils/earnings.ts — tests/parity.test.ts runs both on the same cases. Change both together.
 *
 *  • Rates (PLAN.md Step 2): two chains that never cross —
 *      bill = placement (dated) → project rate → client default rate → none
 *      pay  = placement (dated) → employee's dated pay rate → employee pay rate → none
 *  • Pay periods (Step 6): weekly / biweekly (anchor Monday) / semimonthly (1–15, 16–end) / monthly;
 *    payday = the Friday after the period ends.
 *  • Night premium: time after the employee's premium start (default 21:00) until midnight, in
 *    their time zone, is paid (and billed) at +premium %.
 */

const DEFAULT_TZ = 'America/Santo_Domingo'
const num = v => { if (v === null || v === undefined || v === '') return 0; const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 }
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100

// ── Rates ────────────────────────────────────────────────────────────────────

/** rates: [{ employee_id, project_id|null, position, bill_rate, pay_rate, effective_from 'YYYY-MM-DD' }] */
function resolveRates({ employee, project, client, rates = [], day }) {
  const onOrBefore = r => !r.effective_from || r.effective_from <= day
  const newestFirst = (a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || ''))
  const mine = rates.filter(r => r.employee_id === employee?.id && onOrBefore(r)).sort(newestFirst)
  const onProject = project ? mine.filter(r => r.project_id === project.id) : []
  const general = mine.filter(r => !r.project_id)

  let bill = { rate: 0, source: 'none' }
  const pb = onProject.find(r => num(r.bill_rate) > 0)
  if (pb) bill = { rate: num(pb.bill_rate), source: 'placement', from: pb.effective_from }
  else if (num(project?.rate) > 0) bill = { rate: num(project.rate), source: 'project' }
  else if (num(client?.default_rate) > 0) bill = { rate: num(client.default_rate), source: 'client' }

  let pay = { rate: 0, source: 'none' }
  const pp = onProject.find(r => num(r.pay_rate) > 0)
  const gp = general.find(r => num(r.pay_rate) > 0)
  if (pp) pay = { rate: num(pp.pay_rate), source: 'placement', from: pp.effective_from }
  else if (gp) pay = { rate: num(gp.pay_rate), source: 'employee-dated', from: gp.effective_from }
  else if (num(employee?.pay_rate) > 0) pay = { rate: num(employee.pay_rate), source: 'employee' }

  const position = onProject.find(r => r.position)?.position || employee?.role || ''
  return { bill, pay, position }
}

// ── Dates in a time zone ─────────────────────────────────────────────────────

function localParts(ms, tz = DEFAULT_TZ) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const m = Object.fromEntries(f.formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  return { date: `${m.year}-${m.month}-${m.day}`, hour: Number(m.hour), minute: Number(m.minute), second: Number(m.second),
    weekday: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[m.weekday] }
}
/** The UTC instant of local midnight starting `date` in tz */
function zonedMidnight(date, tz = DEFAULT_TZ) {
  const [y, mo, d] = date.split('-').map(Number)
  let t = Date.UTC(y, mo - 1, d)
  for (let i = 0; i < 3; i++) {
    const p = localParts(t, tz)
    const asUtc = Date.UTC(...p.date.split('-').map((x, j) => (j === 1 ? Number(x) - 1 : Number(x))), p.hour, p.minute, p.second)
    t -= asUtc - Date.UTC(y, mo - 1, d)
  }
  return t
}
function addDays(date, n) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function weekdayOf(date) { return new Date(`${date}T12:00:00Z`).getUTCDay() }
function mondayOf(date) { return addDays(date, -((weekdayOf(date) + 6) % 7)) }
function lastDayOfMonth(date) { const [y, m] = date.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

// ── Pay periods ──────────────────────────────────────────────────────────────

const SCHEDULES = ['weekly', 'biweekly', 'semimonthly', 'monthly']

/** The pay period containing `date` (YYYY-MM-DD): { schedule, start, end, payday } */
function payPeriod(date, schedule = 'weekly', anchor = null) {
  let start, end
  if (schedule === 'semimonthly') {
    const d = Number(date.slice(8, 10))
    start = d <= 15 ? `${date.slice(0, 8)}01` : `${date.slice(0, 8)}16`
    end = d <= 15 ? `${date.slice(0, 8)}15` : lastDayOfMonth(date)
  } else if (schedule === 'monthly') {
    start = `${date.slice(0, 8)}01`; end = lastDayOfMonth(date)
  } else if (schedule === 'biweekly') {
    const a = mondayOf(anchor || '2026-01-05')          // any Monday that starts a two-week period
    const weeks = Math.floor((Date.parse(mondayOf(date)) - Date.parse(a)) / (7 * 86_400_000))
    start = addDays(a, (weeks - (((weeks % 2) + 2) % 2)) * 7); end = addDays(start, 13)
  } else {
    schedule = 'weekly'; start = mondayOf(date); end = addDays(start, 6)
  }
  const wd = weekdayOf(end)
  const payday = addDays(end, ((5 - wd + 7) % 7) || 7)   // the Friday after the period ends
  return { schedule, start, end, payday }
}

// ── Night premium split for tracked 10-minute blocks ─────────────────────────

function clockMinutes(v, fallback) {
  const m = String(v || '').trim().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i)
  if (!m) return fallback
  let h = Number(m[1]); const min = Number(m[2] || 0); const s = (m[3] || '').toLowerCase()
  if (s === 'pm' && h < 12) h += 12
  if (s === 'am' && h === 12) h = 0
  return Math.min(23, h) * 60 + Math.min(59, min)
}

/**
 * Seconds of a block that fall in the premium window (premium start → midnight, local).
 * block: { block_start ISO, seconds, first_offset, last_offset }
 */
function premiumSeconds(block, employee, tz) {
  if (!employee?.premium_enabled || !num(employee.premium_percent)) return 0
  const startMin = clockMinutes(employee.premium_start_time, 21 * 60)
  const bs = Date.parse(block.block_start)
  const first = Number.isInteger(block.first_offset) ? block.first_offset : 0
  const last = Number.isInteger(block.last_offset) ? block.last_offset : 599
  const span = Math.max(1, last - first + 1)
  const p = localParts(bs, tz || employee.timezone || DEFAULT_TZ)
  const localSec = p.hour * 3600 + p.minute * 60 + p.second            // seconds after local midnight at block start
  const winStart = startMin * 60, winEnd = 24 * 3600
  const a = localSec + first, b = localSec + last + 1
  const overlap = Math.max(0, Math.min(b, winEnd) - Math.max(a, winStart)) + Math.max(0, Math.min(b, winEnd + 24 * 3600) - Math.max(a, winStart + 24 * 3600))
  return Math.round((Number(block.seconds) || 0) * Math.min(1, overlap / span))
}

/**
 * Money for a set of blocks of one employee.
 * Returns { seconds, premiumSeconds, amount, byProject: { [projectId|'yva']: {...} } }
 * kind 'pay' or 'bill' (billing uses the bill chain; YVA-team work types are never billed).
 */
function blocksMoney({ blocks, employee, projectsById = {}, clientsById = {}, rates = [], kind = 'pay', tz }) {
  const out = { seconds: 0, premiumSeconds: 0, amount: 0, byProject: {} }
  const pct = employee?.premium_enabled ? num(employee.premium_percent) : 0
  for (const b of blocks) {
    if (b.status === 'removed' || b.status === 'rejected') continue
    const day = localParts(Date.parse(b.block_start), tz || employee?.timezone || DEFAULT_TZ).date
    const project = b.project_id ? projectsById[b.project_id] : null
    if (kind === 'bill' && !project) continue
    const client = project?.client_id ? clientsById[project.client_id] : null
    const r = resolveRates({ employee, project, client, rates, day })
    const rate = kind === 'bill' ? r.bill.rate : r.pay.rate
    const prem = premiumSeconds(b, employee, tz)
    const sec = Number(b.seconds) || 0
    const amount = ((sec - prem) / 3600) * rate + (prem / 3600) * rate * (1 + pct / 100)
    const key = b.project_id || 'yva'
    const g = (out.byProject[key] ||= { seconds: 0, premiumSeconds: 0, amount: 0, rate, rates: new Set(), missingRate: false })
    g.seconds += sec; g.premiumSeconds += prem; g.amount += amount; g.rates.add(rate); if (!rate) g.missingRate = true
    out.seconds += sec; out.premiumSeconds += prem; out.amount += amount
  }
  out.amount = round2(out.amount)
  for (const g of Object.values(out.byProject)) { g.amount = round2(g.amount); g.rates = [...g.rates] }
  return out
}

module.exports = { DEFAULT_TZ, SCHEDULES, num, round2, resolveRates, localParts, zonedMidnight, addDays, mondayOf, weekdayOf, lastDayOfMonth, payPeriod, clockMinutes, premiumSeconds, blocksMoney }
