// Rates, pay periods and night premium — the browser copy of netlify/functions/_lib/money.cjs.
// tests/parity.test.ts checks both give the same answers. Change both together.
//
//  • bill = placement (dated) → project rate → client default rate → none   (client-facing only)
//  • pay  = placement (dated) → employee's dated pay rate → employee pay rate → none (employee-facing only)
//  • pay periods: weekly / biweekly / semimonthly (1–15, 16–end) / monthly; payday = the Friday after
//  • night premium: premium start (default 21:00) → midnight in the employee's time zone, +premium %

export const DEFAULT_TZ = 'America/Santo_Domingo'
export type PaySchedule = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'
export const PAY_SCHEDULES: { value: PaySchedule; label: string }[] = [
  { value: 'weekly', label: 'Weekly (Mon–Sun)' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'semimonthly', label: 'Quincena (1–15, 16–end)' },
  { value: 'monthly', label: 'Monthly' },
]

/** Snake_case shapes, as stored (server functions and the browser share these) */
export type RateRow = { employee_id: string; project_id: string | null; position?: string | null; bill_rate?: number | string | null; pay_rate?: number | string | null; effective_from?: string | null }
export type RateEmployee = { id: string; pay_rate?: number | string | null; role?: string | null; premium_enabled?: boolean | null; premium_percent?: number | string | null; premium_start_time?: string | null; timezone?: string | null }
export type RateProject = { id: string; rate?: number | string | null; client_id?: string | null }
export type RateClient = { id: string; default_rate?: number | string | null }
export type BillSource = 'placement' | 'project' | 'client' | 'none'
export type PaySource = 'placement' | 'employee-dated' | 'employee' | 'none'
export type Resolved = { bill: { rate: number; source: BillSource; from?: string }; pay: { rate: number; source: PaySource; from?: string }; position: string }

export const num = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function resolveRates({ employee, project, client, rates = [], day }: {
  employee?: RateEmployee | null; project?: RateProject | null; client?: RateClient | null; rates?: RateRow[]; day: string
}): Resolved {
  const mine = rates.filter(r => r.employee_id === employee?.id && (!r.effective_from || r.effective_from <= day))
    .sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || '')))
  const onProject = project ? mine.filter(r => r.project_id === project.id) : []
  const general = mine.filter(r => !r.project_id)

  let bill: Resolved['bill'] = { rate: 0, source: 'none' }
  const pb = onProject.find(r => num(r.bill_rate) > 0)
  if (pb) bill = { rate: num(pb.bill_rate), source: 'placement', from: pb.effective_from ?? undefined }
  else if (num(project?.rate) > 0) bill = { rate: num(project!.rate), source: 'project' }
  else if (num(client?.default_rate) > 0) bill = { rate: num(client!.default_rate), source: 'client' }

  let pay: Resolved['pay'] = { rate: 0, source: 'none' }
  const pp = onProject.find(r => num(r.pay_rate) > 0)
  const gp = general.find(r => num(r.pay_rate) > 0)
  if (pp) pay = { rate: num(pp.pay_rate), source: 'placement', from: pp.effective_from ?? undefined }
  else if (gp) pay = { rate: num(gp.pay_rate), source: 'employee-dated', from: gp.effective_from ?? undefined }
  else if (num(employee?.pay_rate) > 0) pay = { rate: num(employee!.pay_rate), source: 'employee' }

  return { bill, pay, position: onProject.find(r => r.position)?.position || employee?.role || '' }
}

export const BILL_SOURCE_LABEL: Record<BillSource, string> = {
  placement: 'Set for this person', project: 'Project rate', client: 'Client default', none: 'No bill rate',
}
export const PAY_SOURCE_LABEL: Record<PaySource, string> = {
  placement: 'Set for this project', 'employee-dated': 'Employee pay rate', employee: 'Employee pay rate', none: 'No pay rate',
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** A usable IANA time zone, or `fallback`. Profiles hold free text ("AST / EST"), which Intl rejects with a RangeError. */
const tzCache = new Map<string, boolean>()
export function safeTz(tz: string | null | undefined, fallback = DEFAULT_TZ): string {
  const t = String(tz || '').trim()
  if (!t) return fallback
  if (!tzCache.has(t)) { try { new Intl.DateTimeFormat('en-US', { timeZone: t }); tzCache.set(t, true) } catch { tzCache.set(t, false) } }
  return tzCache.get(t) ? t : fallback
}

export function localParts(ms: number, tz = DEFAULT_TZ) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const m = Object.fromEntries(f.formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  return { date: `${m.year}-${m.month}-${m.day}`, hour: Number(m.hour), minute: Number(m.minute), second: Number(m.second),
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[m.weekday] }
}
export function zonedMidnight(date: string, tz = DEFAULT_TZ): number {
  const [y, mo, d] = date.split('-').map(Number)
  let t = Date.UTC(y, mo - 1, d)
  for (let i = 0; i < 3; i++) {
    const p = localParts(t, tz)
    const [py, pm, pd] = p.date.split('-').map(Number)
    t -= Date.UTC(py, pm - 1, pd, p.hour, p.minute, p.second) - Date.UTC(y, mo - 1, d)
  }
  return t
}
export function addDays(date: string, n: number): string { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
export const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7))
export function lastDayOfMonth(date: string): string { const [y, m] = date.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }

export function payPeriod(date: string, schedule: PaySchedule | string = 'weekly', anchor: string | null = null) {
  let start: string, end: string, s = schedule
  if (s === 'semimonthly') {
    const d = Number(date.slice(8, 10))
    start = d <= 15 ? `${date.slice(0, 8)}01` : `${date.slice(0, 8)}16`
    end = d <= 15 ? `${date.slice(0, 8)}15` : lastDayOfMonth(date)
  } else if (s === 'monthly') {
    start = `${date.slice(0, 8)}01`; end = lastDayOfMonth(date)
  } else if (s === 'biweekly') {
    const a = mondayOf(anchor || '2026-01-05')
    const weeks = Math.floor((Date.parse(mondayOf(date)) - Date.parse(a)) / (7 * 86_400_000))
    start = addDays(a, (weeks - (((weeks % 2) + 2) % 2)) * 7); end = addDays(start, 13)
  } else {
    s = 'weekly'; start = mondayOf(date); end = addDays(start, 6)
  }
  const payday = addDays(end, ((5 - weekdayOf(end) + 7) % 7) || 7)
  return { schedule: s as PaySchedule, start, end, payday }
}

// ── Night premium ────────────────────────────────────────────────────────────

export function clockMinutes(v: string | null | undefined, fallback: number): number {
  const m = String(v || '').trim().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i)
  if (!m) return fallback
  let h = Number(m[1]); const min = Number(m[2] || 0); const s = (m[3] || '').toLowerCase()
  if (s === 'pm' && h < 12) h += 12
  if (s === 'am' && h === 12) h = 0
  return Math.min(23, h) * 60 + Math.min(59, min)
}

export type MoneyBlock = { block_start: string; seconds: number; first_offset?: number | null; last_offset?: number | null; project_id?: string | null; status?: string }

export function premiumSeconds(block: MoneyBlock, employee?: RateEmployee | null, tz?: string): number {
  if (!employee?.premium_enabled || !num(employee.premium_percent)) return 0
  const startMin = clockMinutes(employee.premium_start_time, 21 * 60)
  const bs = Date.parse(block.block_start)
  const first = Number.isInteger(block.first_offset) ? block.first_offset! : 0
  const last = Number.isInteger(block.last_offset) ? block.last_offset! : 599
  const span = Math.max(1, last - first + 1)
  const p = localParts(bs, safeTz(employee.timezone, safeTz(tz)))     // the employee's clock (business zone if theirs isn't valid)
  const localSec = p.hour * 3600 + p.minute * 60 + p.second
  const winStart = startMin * 60, winEnd = 24 * 3600
  const a = localSec + first, b = localSec + last + 1
  const overlap = Math.max(0, Math.min(b, winEnd) - Math.max(a, winStart)) + Math.max(0, Math.min(b, winEnd + 24 * 3600) - Math.max(a, winStart + 24 * 3600))
  return Math.round((Number(block.seconds) || 0) * Math.min(1, overlap / span))
}

export type MoneyGroup = { seconds: number; premiumSeconds: number; amount: number; rate: number; rates: number[]; missingRate: boolean }

/** Days in the business zone `tz`; negative blocks (YVA removing time) come off regular time first, then premium. */
export function blocksMoney({ blocks, employee, projectsById = {}, clientsById = {}, rates = [], kind = 'pay', tz }: {
  blocks: MoneyBlock[]; employee?: RateEmployee | null; projectsById?: Record<string, RateProject>; clientsById?: Record<string, RateClient>
  rates?: RateRow[]; kind?: 'pay' | 'bill'; tz?: string
}) {
  const out = { seconds: 0, premiumSeconds: 0, amount: 0, byProject: {} as Record<string, MoneyGroup> }
  const pct = employee?.premium_enabled ? num(employee.premium_percent) : 0
  const zone = safeTz(tz, safeTz(employee?.timezone))
  type Cell = { key: string; reg: number; prem: number; rate: number }
  const cells = new Map<string, Cell>()
  const rateSets: Record<string, Set<number>> = {}
  const removals: [Cell, number][] = []
  for (const b of blocks) {
    if (b.status === 'removed' || b.status === 'rejected') continue
    const day = localParts(Date.parse(b.block_start), zone).date
    const project = b.project_id ? projectsById[b.project_id] : null
    if (kind === 'bill' && !project) continue
    const client = project?.client_id ? clientsById[project.client_id] : null
    const r = resolveRates({ employee, project, client, rates, day })
    const rate = kind === 'bill' ? r.bill.rate : r.pay.rate
    const key = b.project_id || 'yva'
    ;(rateSets[key] ||= new Set()).add(rate)
    const c = cells.get(`${key}|${day}`) || { key, reg: 0, prem: 0, rate }
    cells.set(`${key}|${day}`, c)
    const sec = Number(b.seconds) || 0
    if (sec < 0) { removals.push([c, -sec]); continue }
    const prem = premiumSeconds(b, employee, zone)
    c.reg += sec - prem; c.prem += prem
  }
  for (const [c, take] of removals) {
    const fromReg = Math.min(c.reg, take)
    c.reg -= fromReg
    c.prem -= Math.min(c.prem, take - fromReg)
  }
  for (const c of cells.values()) {
    const g = (out.byProject[c.key] ||= { seconds: 0, premiumSeconds: 0, amount: 0, rate: c.rate, rates: [], missingRate: false })
    const amount = (c.reg / 3600) * c.rate + (c.prem / 3600) * c.rate * (1 + pct / 100)
    g.seconds += c.reg + c.prem; g.premiumSeconds += c.prem; g.amount += amount; if (!c.rate) g.missingRate = true
    out.seconds += c.reg + c.prem; out.premiumSeconds += c.prem; out.amount += amount
  }
  out.amount = round2(out.amount)
  for (const [k, g] of Object.entries(out.byProject)) { g.amount = round2(g.amount); g.rates = [...rateSets[k]] }
  return out
}
