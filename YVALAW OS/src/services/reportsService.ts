import type { DataSnapshot, Invoice, InvoiceItem } from '../data/types'
import { payrollFromInvoiceItem } from '../utils/payroll'
import { hourLines } from '../utils/invoiceLines'
import { supabase } from '../lib/supabase'
import { loadLeads, type Lead } from './crm'
import { loadTrackerBlocks, loadManualRequests, type TrackerBlock, type ManualRequest } from './trackerStorage'
import { loadTimeOff, type TimeOffRequest } from './workspace'
import { loadStaffRequests } from './storage'
import { loadRuns, loadLines, type PayrollRun, type PayrollLine } from './payroll'
import { loadPlacementRates, type PlacementRate } from './rates'
import { loadWeekCloses, type WeekClose } from './weeklyClose'
import type { StaffRequest } from '../data/types'

export type DateRange = {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
}

export type RevenueRow = {
  name: string
  total: number
  invoiceCount: number
  share: number // 0..1
}

export type ProjectRevenueRow = {
  name: string
  total: number
  invoiceCount: number
  share: number
  hoursBilled: number
}

export type TrendPoint = {
  bucket: string // e.g. 2025-12
  total: number
}

export type EmpPerfRow = {
  name: string
  hours: number
  billed: number
  payroll: number
  margin: number
  invoiceCount: number
}

export type ClientAnalyticsRow = {
  name: string
  projectCount: number
  invoiceCount: number
  total: number
  lastDate: string
}

export type ProjectAnalyticsRow = {
  name: string
  client: string
  invoiceCount: number
  total: number
  hours: number
  lastDate: string
}

export type ReportsResult = {
  range: DateRange
  invoiceCount: number
  paidCount: number
  unpaidCount: number
  totalBilled: number
  totalHours: number
  totalPayroll: number
  totalNetEarnings: number
  byClient: RevenueRow[]
  byProject: ProjectRevenueRow[]
  employeePerformance: EmpPerfRow[]
  allTimeByClient: ClientAnalyticsRow[]
  allTimeByProject: ProjectAnalyticsRow[]
  trend: TrendPoint[]
  insights: string[]
}

function parseISODateLoose(s?: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  if (!Number.isFinite(d.getTime())) return null
  return d
}

function isoDay(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export function makeCurrentMonthRange(now = new Date()): DateRange {
  const from = startOfMonth(now)
  const to = endOfMonth(now)
  return { from: isoDay(from), to: isoDay(to) }
}

export function makeCurrentQuarterRange(now = new Date()): DateRange {
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  const to = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: isoDay(from), to: isoDay(to) }
}

function clampToDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function inRange(d: Date, range: DateRange): boolean {
  const from = parseISODateLoose(range.from)
  const to = parseISODateLoose(range.to)
  if (!from || !to) return false
  const dd = clampToDay(d).getTime()
  return dd >= clampToDay(from).getTime() && dd <= clampToDay(to).getTime()
}

function getInvoiceEffectiveDate(inv: Invoice): Date | null {
  return (
    parseISODateLoose(inv.date) ||
    parseISODateLoose(inv.billingEnd) ||
    parseISODateLoose(inv.billingStart) ||
    null
  )
}

function safeSubtotal(inv: Invoice): number {
  const n = Number(inv.subtotal ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** The invoice's hours lines only: fixed-price item lines (kind 'item') are not hours and pay nobody */
function safeItems(inv: Invoice): InvoiceItem[] {
  return hourLines(inv.items)
}

function sumHours(items: InvoiceItem[]): number {
  let total = 0
  for (const it of items) {
    const h = Number(it.hoursTotal ?? 0)
    if (Number.isFinite(h)) total += h
  }
  return total
}

function monthBucket(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function computeReports(store: DataSnapshot, range: DateRange): ReportsResult {
  const rows: Invoice[] = []
  for (const inv of store.invoices) {
    const d = getInvoiceEffectiveDate(inv)
    if (!d) continue
    if (inRange(d, range)) rows.push(inv)
  }

  let totalBilled = 0
  let paidCount = 0
  let unpaidCount = 0

  const byClient  = new Map<string, { total: number; count: number }>()
  const byProject = new Map<string, { total: number; count: number; hours: number }>()
  const trend     = new Map<string, number>()

  // Employee performance (range-scoped)
  const byEmp = new Map<string, { hours: number; billed: number; payroll: number; invIds: Set<string> }>()

  for (const inv of rows) {
    const subtotal = safeSubtotal(inv)
    totalBilled += subtotal

    const status = (inv.status || '').toLowerCase()
    if (status === 'paid') paidCount += 1
    else unpaidCount += 1

    const clientName  = (inv.clientName  || 'Unknown client').trim()  || 'Unknown client'
    const projectName = (inv.projectName || 'No project').trim() || 'No project'

    const c = byClient.get(clientName) || { total: 0, count: 0 }
    c.total += subtotal; c.count += 1
    byClient.set(clientName, c)

    const p = byProject.get(projectName) || { total: 0, count: 0, hours: 0 }
    p.total += subtotal; p.count += 1
    p.hours += sumHours(safeItems(inv))
    byProject.set(projectName, p)

    const d = getInvoiceEffectiveDate(inv)
    if (d) trend.set(monthBucket(d), (trend.get(monthBucket(d)) || 0) + subtotal)

    for (const item of safeItems(inv)) {
      const empName = item.employeeName?.trim() || 'Unknown'
      if (!byEmp.has(empName)) byEmp.set(empName, { hours: 0, billed: 0, payroll: 0, invIds: new Set() })
      const ep = byEmp.get(empName)!
      const h  = Number(item.hoursTotal) || 0
      const emp = store.employees.find(e => (item.employeeId && e.id === item.employeeId) || e.name.toLowerCase() === empName.toLowerCase())
      const payroll = payrollFromInvoiceItem(item, emp)
      ep.hours   += h
      ep.billed  += h * (Number(item.rate) || 0)
      ep.payroll += payroll.totalPay
      ep.invIds.add(inv.id)
    }
  }

  const byClientRows: RevenueRow[] = Array.from(byClient.entries()).map(([name, agg]) => ({
    name, total: agg.total, invoiceCount: agg.count,
    share: totalBilled > 0 ? agg.total / totalBilled : 0,
  })).sort((a, b) => b.total - a.total)

  const byProjectRows: ProjectRevenueRow[] = Array.from(byProject.entries()).map(([name, agg]) => ({
    name, total: agg.total, invoiceCount: agg.count,
    share: totalBilled > 0 ? agg.total / totalBilled : 0,
    hoursBilled: agg.hours,
  })).sort((a, b) => b.total - a.total)

  const employeePerformance: EmpPerfRow[] = Array.from(byEmp.entries()).map(([name, ep]) => ({
    name, hours: ep.hours, billed: ep.billed, payroll: ep.payroll,
    margin: ep.billed - ep.payroll, invoiceCount: ep.invIds.size,
  })).sort((a, b) => b.billed - a.billed)

  const totalHours      = employeePerformance.reduce((s, e) => s + e.hours, 0)
  const totalPayroll    = employeePerformance.reduce((s, e) => s + e.payroll, 0)
  const totalNetEarnings = totalBilled - totalPayroll

  // All-time client analytics
  const atClient = new Map<string, { projects: Set<string>; invoices: number; total: number; lastDate: string }>()
  for (const inv of store.invoices) {
    const name = (inv.clientName || 'Unknown').trim()
    if (!atClient.has(name)) atClient.set(name, { projects: new Set(), invoices: 0, total: 0, lastDate: '' })
    const c = atClient.get(name)!
    c.invoices += 1
    c.total    += safeSubtotal(inv)
    if (inv.projectName) c.projects.add(inv.projectName)
    const d = getInvoiceEffectiveDate(inv)
    if (d) { const ds = isoDay(d); if (!c.lastDate || ds > c.lastDate) c.lastDate = ds }
  }
  const allTimeByClient: ClientAnalyticsRow[] = Array.from(atClient.entries()).map(([name, c]) => ({
    name, projectCount: c.projects.size, invoiceCount: c.invoices, total: c.total, lastDate: c.lastDate,
  })).sort((a, b) => b.total - a.total)

  // All-time project analytics
  const atProject = new Map<string, { client: string; invoices: number; total: number; hours: number; lastDate: string }>()
  for (const inv of store.invoices) {
    const name = (inv.projectName || 'No project').trim()
    if (!atProject.has(name)) atProject.set(name, { client: inv.clientName || '', invoices: 0, total: 0, hours: 0, lastDate: '' })
    const p = atProject.get(name)!
    p.invoices += 1
    p.total    += safeSubtotal(inv)
    p.hours    += sumHours(safeItems(inv))
    const d = getInvoiceEffectiveDate(inv)
    if (d) { const ds = isoDay(d); if (!p.lastDate || ds > p.lastDate) p.lastDate = ds }
  }
  const allTimeByProject: ProjectAnalyticsRow[] = Array.from(atProject.entries()).map(([name, p]) => ({
    name, client: p.client, invoiceCount: p.invoices, total: p.total, hours: p.hours, lastDate: p.lastDate,
  })).sort((a, b) => b.total - a.total)

  const trendPoints: TrendPoint[] = Array.from(trend.entries())
    .map(([bucket, total]) => ({ bucket, total }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : 1))

  const insights: string[] = []
  if (byClientRows.length > 0) {
    const top = byClientRows[0]
    insights.push(`Top billing client in range: ${top.name} (${Math.round(top.share * 100)}% of revenue).`)
  }
  if (byProjectRows.length > 0) {
    const topP = byProjectRows[0]
    insights.push(`Top project in range: ${topP.name} (${Math.round(topP.share * 100)}% of revenue).`)
  }
  if (totalPayroll > 0) {
    insights.push(`Estimated payroll for range: ${totalPayroll.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · Net: ${totalNetEarnings.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}.`)
  }
  if (unpaidCount > 0) {
    insights.push(`Unpaid invoices in range: ${unpaidCount}.`)
  }

  return {
    range,
    invoiceCount: rows.length,
    paidCount,
    unpaidCount,
    totalBilled,
    totalHours,
    totalPayroll,
    totalNetEarnings,
    byClient: byClientRows,
    byProject: byProjectRows,
    employeePerformance,
    allTimeByClient,
    allTimeByProject,
    trend: trendPoints,
    insights,
  }
}


// Backwards-friendly aliases (nicer naming)
export const getCurrentMonthRange = makeCurrentMonthRange
export const getCurrentQuarterRange = makeCurrentQuarterRange

/* ══════════════════════════════════════════════════════════════════════
   Home dashboard + Reports view helpers (redesign 2026-11).
   Pure calculations first (moved out of ReportsPage unchanged), then the
   loader for the extra Home signals. Every loader is allowed to fail:
   RLS hides tables from roles that can't see them.
   ══════════════════════════════════════════════════════════════════════ */

export type Period = 'month' | 'quarter' | 'custom'

export function todayIso(now = new Date()): string { return isoDay(now) }

/** "2026-11-01" + n days (local calendar, no UTC drift) */
export function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + n))
}
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

export function periodRange(p: Period, custom: DateRange, now = new Date()): DateRange {
  if (p === 'month') return makeCurrentMonthRange(now)
  if (p === 'quarter') return makeCurrentQuarterRange(now)
  const t = todayIso(now)
  return { from: (custom.from || '').slice(0, 10) || t, to: (custom.to || '').slice(0, 10) || t }
}

/** The period right before: previous month / quarter, or the same number of days for a custom range */
export function previousRange(p: Period, r: DateRange): { range: DateRange; label: string } {
  const [y, m] = r.from.split('-').map(Number)
  if (p === 'month') {
    const d = new Date(y, m - 2, 1)
    return { range: makeCurrentMonthRange(d), label: d.toLocaleString('en-US', { month: 'short' }) }
  }
  if (p === 'quarter') return { range: makeCurrentQuarterRange(new Date(y, m - 4, 1)), label: 'last quarter' }
  const len = Math.max(daysBetween(r.from, r.to), 0)
  const to = addDaysIso(r.from, -1)
  return { range: { from: addDaysIso(to, -len), to }, label: 'previous period' }
}

export const invoiceDay = (inv: Invoice) => inv.date || inv.billingEnd || inv.billingStart || ''
export const invoiceStatus = (inv: Invoice) => (inv.status || 'draft').toLowerCase()
export const invoiceBalance = (inv: Invoice) => Math.max(0, safeSubtotal(inv) - (Number(inv.amountPaid) || 0))
export const OPEN_STATUSES = ['sent', 'viewed', 'partial', 'overdue']
export const isOpenInvoice = (inv: Invoice) => OPEN_STATUSES.includes(invoiceStatus(inv))
/** Overdue = marked overdue, or still open after its due date */
export const isOverdueInvoice = (inv: Invoice, today: string) => invoiceStatus(inv) === 'overdue' || (isOpenInvoice(inv) && !!inv.dueDate && inv.dueDate < today)

export function outstandingSummary(invoices: Invoice[], today: string) {
  const open = invoices.filter(isOpenInvoice).sort((a, b) => ((a.dueDate || invoiceDay(a)) < (b.dueDate || invoiceDay(b)) ? -1 : 1))
  const overdue = open.filter(i => isOverdueInvoice(i, today))
  const sum = (l: Invoice[]) => l.reduce((s, i) => s + invoiceBalance(i), 0)
  return { open, total: sum(open), overdue, overdueTotal: sum(overdue) }
}

/** Same rule as before: expenses without a date always count */
export function expensesInRange<T extends { date?: string; amount: number }>(expenses: T[], from: string, to: string): { rows: T[]; total: number } {
  const rows = expenses.filter(e => {
    if (!e.date) return true
    if (from && e.date < from) return false
    if (to && e.date > to) return false
    return true
  })
  return { rows, total: rows.reduce((s, e) => s + (Number(e.amount) || 0), 0) }
}

export function invoicesInRangeBySize(invoices: Invoice[], from: string, to: string): Invoice[] {
  return invoices.filter(inv => {
    const d = invoiceDay(inv)
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  }).sort((a, b) => safeSubtotal(b) - safeSubtotal(a))
}

/** Billed per month for the last 6 months (all invoices, not the selected range) */
export function lastSixMonths(invoices: Invoice[], now = new Date()): { label: string; bucket: string; value: number; current: boolean }[] {
  const totals: Record<string, number> = {}
  for (const inv of invoices) {
    const d = invoiceDay(inv)
    if (!d) continue
    totals[d.slice(0, 7)] = (totals[d.slice(0, 7)] || 0) + safeSubtotal(inv)
  }
  const out = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const bucket = monthBucket(d)
    out.push({ label: d.toLocaleString('en-US', { month: 'short' }), bucket, value: totals[bucket] || 0, current: i === 0 })
  }
  return out
}

/** Contracts ending within `days` (today included), soonest first */
export function expiringContracts<C extends { contractEnd?: string }>(clients: C[], today: string, days = 60): (C & { daysLeft: number })[] {
  const until = addDaysIso(today, days)
  return clients
    .filter(c => !!c.contractEnd && c.contractEnd.slice(0, 10) >= today && c.contractEnd.slice(0, 10) <= until)
    .map(c => ({ ...c, daysLeft: daysBetween(today, c.contractEnd!.slice(0, 10)) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
}

/** Employees hitting a milestone year with YVA this year (1, 2, 3, 5, 10, 15, 20). The hire date's year wins
 *  over the stored hire year when both exist. */
export function anniversaries<E extends { id: string; name: string; startYear?: number | string; hireDate?: string | null }>(employees: E[], year = new Date().getFullYear()) {
  const milestones = new Set([1, 2, 3, 5, 10, 15, 20])
  const startOf = (e: E) => (/^\d{4}-/.test(e.hireDate || '') ? Number(e.hireDate!.slice(0, 4)) : Number(e.startYear))
  return employees
    .filter(e => { const s = startOf(e); return !!s && s < year && milestones.has(year - s) })
    .map(e => ({ id: e.id, name: e.name, years: year - startOf(e) }))
}

function lastInvoiceDayFor(invoices: Invoice[], clientName: string): string {
  return invoices.filter(inv => inv.clientName === clientName).map(invoiceDay).filter(Boolean).sort().pop() || ''
}

/** Client retention watch: not invoiced in 60+ days. CEO view skips churned and never-invoiced clients;
 *  the lead-gen view also counts clients that were never invoiced (both as before). */
export function retentionWatch<C extends { id: string; name: string; status?: string }>(clients: C[], invoices: Invoice[], today: string, opts: { includeNeverInvoiced?: boolean } = {}) {
  const out: { client: C; lastDate: string; days: number | null }[] = []
  for (const c of clients) {
    const last = lastInvoiceDayFor(invoices, c.name)
    if (!last) { if (opts.includeNeverInvoiced) out.push({ client: c, lastDate: '', days: null }); continue }
    if (!opts.includeNeverInvoiced && (c.status || '').toLowerCase() === 'churned') continue
    const days = daysBetween(last.slice(0, 10), today)
    if (days >= 60) out.push({ client: c, lastDate: last, days })
  }
  return out
}

export type AgingBucket = { label: string; min: number; max: number; tone: 'gold' | 'warning' | 'danger' | 'dark'; invoices: Invoice[]; total: number }
/** Accounts receivable aging by days past due date (or invoice date), unpaid non-draft invoices */
export function arAging(invoices: Invoice[], today: string) {
  const unpaid = invoices.filter(inv => { const s = invoiceStatus(inv); return s !== 'paid' && s !== 'draft' })
  const buckets: AgingBucket[] = [
    { label: '0–30 days', min: 0, max: 30, tone: 'gold', invoices: [], total: 0 },
    { label: '31–60 days', min: 31, max: 60, tone: 'warning', invoices: [], total: 0 },
    { label: '61–90 days', min: 61, max: 90, tone: 'danger', invoices: [], total: 0 },
    { label: '90+ days', min: 91, max: 9999, tone: 'dark', invoices: [], total: 0 },
  ]
  const rows = unpaid.map(inv => {
    const ref = (inv.dueDate || inv.date || inv.billingEnd || '').slice(0, 10)
    const age = ref ? daysBetween(ref, today) : 0
    if (ref) { const b = buckets.find(x => age >= x.min && age <= x.max); if (b) { b.invoices.push(inv); b.total += safeSubtotal(inv) } }
    return { inv, age, balance: safeSubtotal(inv) - (Number(inv.amountPaid) || 0) }
  }).sort((a, b) => ((a.inv.dueDate || a.inv.date || '') < (b.inv.dueDate || b.inv.date || '') ? -1 : 1))
  return { buckets, rows, hasAging: buckets.some(b => b.invoices.length > 0) }
}

/** Last 3 full months and their average */
export function revenueForecast(invoices: Invoice[], now = new Date()) {
  const months: { label: string; total: number }[] = []
  for (let i = 3; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const bucket = monthBucket(d)
    months.push({ label: d.toLocaleString('en-US', { month: 'long', year: 'numeric' }), total: invoices.filter(inv => invoiceDay(inv).startsWith(bucket)).reduce((s, inv) => s + safeSubtotal(inv), 0) })
  }
  return { months, average: months.reduce((s, m) => s + m.total, 0) / 3 }
}

export type HistoryFilter = { client: string; project: string; status: string; from: string; to: string }
export function filterInvoiceHistory(invoices: Invoice[], opts: HistoryFilter): Invoice[] {
  return invoices.filter(inv => {
    if (opts.client && !(inv.clientName || '').toLowerCase().includes(opts.client.toLowerCase())) return false
    if (opts.project && inv.projectName !== opts.project) return false
    if (opts.status && (inv.status || 'draft') !== opts.status) return false
    const d = invoiceDay(inv)
    if (opts.from && d < opts.from) return false
    if (opts.to && d > opts.to) return false
    return true
  })
}
export const invoiceHours = (inv: Invoice) => safeItems(inv).reduce((s, it) => s + (Number(it.hoursTotal) || 0), 0)

export function invoiceHistoryCsvRows(rows: Invoice[]): string[][] {
  const headers = ['Invoice #', 'Date', 'Due Date', 'Client', 'Project', 'Status', 'Amount (USD)', 'Hours']
  return [headers, ...rows.map(inv => [inv.number || '', inv.date || '', inv.dueDate || '', inv.clientName || '', inv.projectName || '', inv.status || '', String(Number(inv.subtotal) || 0), String(invoiceHours(inv))])]
}

export function payrollCsvRows(rows: Invoice[], employees: DataSnapshot['employees'], dopRate: number): string[][] {
  const headers = ['Employee', 'Hours', 'Pay Rate (USD)', 'Amount (USD)', 'Amount (DOP)', 'Invoice #', 'Date']
  const out: string[][] = [headers]
  for (const inv of rows) {
    for (const item of safeItems(inv)) {
      const emp = employees.find(e => (item.employeeId && e.id === item.employeeId) || e.name.toLowerCase() === item.employeeName.toLowerCase())
      const payroll = payrollFromInvoiceItem(item, emp)
      const usdAmount = payroll.totalPay
      const dop = dopRate > 0 ? String((usdAmount * dopRate).toFixed(0)) : ''
      out.push([item.employeeName, String(payroll.totalHours), String(Number(emp?.payRate) || 0), String(usdAmount.toFixed(2)), dop, inv.number || '', inv.date || ''])
    }
  }
  return out
}

/** Upcoming money-cycle dates: the next Monday close (12:05 am, so today's already ran), and this or next Wed / Fri */
export function upcomingCycle(today: string) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const ahead = (target: number, includeToday: boolean) => { const n = (target - dow + 7) % 7; return addDaysIso(today, n === 0 && !includeToday ? 7 : n) }
  return { monday: ahead(1, false), wednesday: ahead(3, true), friday: ahead(5, true) }
}

/* ── Extra Home signals ─────────────────────────────────────────────── */

export type HomeSignals = {
  leads: Lead[] | null
  blocks: TrackerBlock[] | null          // last week + this week (YVA Time)
  timeOff: TimeOffRequest[] | null       // pending
  manual: ManualRequest[] | null         // pending
  staffRequests: StaffRequest[] | null   // pending
  payroll: { run: PayrollRun; lines: PayrollLine[] } | null   // the upcoming Friday, when prepared
  rates: PlacementRate[] | null
  weekCloses: WeekClose[] | null
}
export type HomeSignalWants = { leads?: boolean; blocks?: { from: number; to: number } | null; timeOff?: boolean; manual?: boolean; staffRequests?: boolean; payday?: string | null; rates?: boolean; weekCloses?: boolean }

const quiet = async <T,>(fn: () => Promise<T>): Promise<T | null> => { try { return await fn() } catch { return null } }

export async function loadHomeSignals(w: HomeSignalWants): Promise<HomeSignals> {
  const [leads, blocks, timeOff, manual, staffRequests, payroll, rates, weekCloses] = await Promise.all([
    w.leads ? quiet(async () => { const r = await loadLeads(); return r.error ? null : r.rows }) : null,
    w.blocks ? quiet(() => loadTrackerBlocks(w.blocks!.from, w.blocks!.to)) : null,
    w.timeOff ? quiet(async () => { const r = await loadTimeOff({ status: 'pending' }); return r.error ? null : r.rows }) : null,
    w.manual ? quiet(() => loadManualRequests('pending')) : null,
    w.staffRequests ? quiet(async () => (await loadStaffRequests()).filter(r => r.status === 'pending')) : null,
    w.payday ? quiet(async () => {
      const r = await loadRuns()
      const run = r.rows.find(x => x.payday === w.payday)
      return run ? { run, lines: await loadLines(run.id) } : null
    }) : null,
    w.rates ? quiet(async () => { const r = await loadPlacementRates(); return r.error ? null : r.rows }) : null,
    w.weekCloses ? quiet(async () => { const r = await loadWeekCloses(); return r.error ? null : r.rows }) : null,
  ])
  return { leads, blocks, timeOff, manual, staffRequests, payroll, rates, weekCloses }
}

/** Who is tracking right now: YVA Time uploads about once a minute, same 3-minute window as Time → Live */
export async function loadTrackingNow(): Promise<string[] | null> {
  return quiet(async () => {
    const since = new Date(Date.now() - 3 * 60_000).toISOString()
    const { data, error } = await supabase.from('tracker_blocks').select('employee_id').gte('updated_at', since).limit(500)
    if (error) throw error
    return [...new Set((data || []).map(r => (r as { employee_id: string }).employee_id))]
  })
}
