// Home dashboard (route "/", redesign 2026-11): greeting, period, KPI strip per role, Needs attention,
// This week (money cycle), lead pipeline, who is tracking now and the 6-month billed chart.
// All numbers come from real data; the calculations are the ones the old dashboard used (reportsService).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRole, usePermission } from '../context/RoleContext'
import { can, isStaff } from '../lib/roles'
import { canSeePage } from '../lib/nav'
import {
  computeReports, previousRange, outstandingSummary, expensesInRange, invoicesInRangeBySize, lastSixMonths, expiringContracts,
  anniversaries, retentionWatch, upcomingCycle, daysBetween, todayIso, invoiceBalance, invoiceStatus, loadHomeSignals, loadTrackingNow,
  type HomeSignals,
} from '../services/reportsService'
import { findMissingRates } from '../components/MissingRates'
import { sendEmail } from '../services/gmail'
import { logComm } from '../services/storage'
import { applyInvoiceTemplate, DEFAULT_REMINDER_EMAIL } from '../services/invoiceEmail'
import { addDays, DEFAULT_TZ, localParts, mondayOf, zonedMidnight } from '../utils/moneyRules'
import { fmtHoursHM } from '../utils/money'
import { usd, usdShort, dop, hmText, dateShort, weekdayDate } from '../utils/format'
import type { Invoice } from '../data/types'
import { Banner, Card, Dot, KpiStrip, PageHeader, Skel, type Kpi } from '../components/ui'
import {
  useReportsData, usePeriod, PeriodControl, AttentionList, sortAttention, KpiDrillModal, StageBar,
  CandidatePipelineCard, HiringProjectsCard, ContractsCard, RetentionRiskCard,
  type AttnItem, type DrillKind, type Stage,
} from './ReportsPage'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const money = (n: number) => usd(n, { cents: false })
const hoursShort = (h: number) => (h >= 100 ? `${Math.round(h).toLocaleString('en-US')}h` : fmtHoursHM(h))
/** "Ana Pérez" → "Ana P." */
const shortName = (name?: string) => { const p = (name || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || 'Someone' }
const greeting = (h: number) => (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const range2 = (a: string, b: string) => (a === b ? dateShort(a) : a.slice(0, 7) === b.slice(0, 7) ? `${dateShort(a)}–${Number(b.slice(8))}` : `${dateShort(a)} – ${dateShort(b)}`)
const LEAD_STAGES = [{ key: 'new', label: 'New', color: '#cbd5e1' }, { key: 'contacted', label: 'Contacted', color: '#94a3b8' }, { key: 'meeting', label: 'Meeting', color: '#475569' }, { key: 'proposal', label: 'Proposal', color: '#facc15' }]

function linkedEmployeeId(): string | null { try { return sessionStorage.getItem('linkedEmployeeId') } catch { return null } }

export default function HomePage() {
  const { role, userId, email } = useRole()
  const allowed = usePermission()
  const navigate = useNavigate()
  const { period, setPeriod, custom, setCustom, range } = usePeriod()
  const data = useReportsData(role, range)
  const { store, loaded, settings, generalExpenses, candidates } = data
  const computed = useMemo(() => computeReports(store, range), [store, range])
  const prev = useMemo(() => previousRange(period, range), [period, range])
  const prevComputed = useMemo(() => computeReports(store, prev.range), [store, prev.range])
  const [drill, setDrill] = useState<DrillKind | null>(null)
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const today = todayIso()
  const cycle = upcomingCycle(today)

  // ── Who may see what (same rules as the pages they link to) ──
  const owner = can.viewOwnerStats(role)
  const canInvoices = can.viewInvoices(role)
  const canWeekly = canSeePage('weekly-close', role, allowed)
  const canPayroll = canSeePage('payroll', role, allowed)
  const canLeads = canSeePage('leads', role, allowed)
  const leadsAll = allowed('leads.view_all')
  const canTimeOff = allowed('timeoff.approve')
  const canApproveTime = can.approveTime(role)
  const canTracker = can.viewTracker(role)
  const canRates = allowed('rates.manage')
  const canRequests = can.viewClients(role) && role !== 'accounting'
  const canCandidates = can.viewAllCandidates(role)

  // ── Extra signals (YVA Time, approvals, leads, payroll, rates); each may fail on its own ──
  const business = localParts(Date.now(), DEFAULT_TZ).date
  const thisMonday = mondayOf(business)
  const lastMonday = addDays(thisMonday, -7)
  const wantBlocks = canWeekly || canApproveTime
  const [signals, setSignals] = useState<HomeSignals | null>(null)
  useEffect(() => {
    if (!isStaff(role)) return
    let alive = true
    void loadHomeSignals({
      leads: canLeads, blocks: wantBlocks ? { from: zonedMidnight(lastMonday), to: Date.now() + 3600_000 } : null,
      timeOff: canTimeOff, manual: canApproveTime, staffRequests: canRequests, payday: canPayroll ? cycle.friday : null, rates: canRates, weekCloses: canWeekly,
    }).then(s => { if (alive) setSignals(s) })
    return () => { alive = false }
  }, [role, canLeads, wantBlocks, canTimeOff, canApproveTime, canRequests, canPayroll, canRates, canWeekly, cycle.friday, lastMonday])

  const [tracking, setTracking] = useState<string[] | null>(null)
  useEffect(() => {
    if (!canTracker) return
    let alive = true
    const run = () => { void loadTrackingNow().then(ids => { if (alive) setTracking(ids) }) }
    run()
    const t = window.setInterval(run, 60_000)
    return () => { alive = false; window.clearInterval(t) }
  }, [canTracker])

  // ── Derived data ──
  const empById = useMemo(() => new Map(store.employees.map(e => [e.id, e])), [store.employees])
  const out = useMemo(() => outstandingSummary(store.invoices, today), [store.invoices, today])
  const expenses = useMemo(() => expensesInRange(generalExpenses, range.from, range.to), [generalExpenses, range])
  const drafts = useMemo(() => store.invoices.filter(i => (i.status || '').toLowerCase() === 'draft'), [store.invoices])
  const autoDrafts = drafts.filter(i => i.autoGenerated).length
  const visibleLeads = useMemo(() => (signals?.leads ? (leadsAll ? signals.leads : signals.leads.filter(l => l.owner_id === userId)) : null), [signals, leadsAll, userId])
  const openLeads = visibleLeads?.filter(l => l.stage !== 'won' && l.stage !== 'lost') ?? []
  const followUps = openLeads.filter(l => l.next_follow_up && l.next_follow_up <= today).sort((a, b) => (a.next_follow_up! < b.next_follow_up! ? -1 : 1))
  const weekStartMs = zonedMidnight(thisMonday), lastWeekStartMs = zonedMidnight(lastMonday)
  const unapproved = useMemo(() => {
    const b = (signals?.blocks ?? []).filter(x => x.status === 'tracked' && x.blockStart >= lastWeekStartMs && x.blockStart < weekStartMs)
    return { people: new Set(b.map(x => x.employeeId)).size, seconds: b.reduce((s, x) => s + x.seconds, 0) }
  }, [signals, lastWeekStartMs, weekStartMs])
  const draftEstimate = useMemo(() => {
    if (!signals?.blocks) return null
    const clients = new Set<string>()
    for (const b of signals.blocks) {
      if (b.blockStart < weekStartMs || !b.projectId || b.status === 'removed' || b.status === 'rejected') continue
      const p = store.projects.find(x => x.id === b.projectId)
      if (p?.clientId) clients.add(p.clientId)
    }
    return clients.size
  }, [signals, weekStartMs, store.projects])
  const missingRates = useMemo(() => (canRates && signals?.rates && loaded ? findMissingRates(store.projects, store.employees, store.clients, signals.rates) : []), [canRates, signals, loaded, store])
  const appliedThisWeek = candidates.filter(c => {
    const d = (c.appliedAt || (c as { createdAt?: string | number }).createdAt || '') as string | number
    const iso = typeof d === 'number' ? todayIso(new Date(d)) : String(d).slice(0, 10)
    return c.stage === 'applied' && !!iso && iso >= addDays(today, -6)
  })

  // ── Greeting ──
  const linked = linkedEmployeeId()
  const me = linked ? empById.get(linked) : undefined
  const firstName = me?.name?.trim().split(/\s+/)[0] || capital(((email || '').split('@')[0] || '').split(/[._-]/)[0] || 'there')

  // ── Payment reminder (same email + activity entry as Invoices → Remind) ──
  async function remind(inv: Invoice) {
    setFlash(null)
    if (!inv.clientEmail) { setFlash({ tone: 'danger', text: `${inv.number} has no client email. Add one on the invoice, then send the reminder.` }); return }
    setBusy(inv.id)
    try {
      const subject = `Payment Reminder — Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
      const body = applyInvoiceTemplate(settings.reminderEmailTemplate || DEFAULT_REMINDER_EMAIL, inv, settings)
      const r = await sendEmail(inv.clientEmail, subject, body)
      if (r.mode === 'failed') { setFlash({ tone: 'danger', text: `Reminder not sent: ${r.fallbackReason || 'Gmail could not send it.'}` }); return }
      setFlash({ tone: 'success', text: r.mode === 'gmail' ? `Payment reminder sent to ${inv.clientEmail}` : `Reminder for ${inv.number} opened in your mail app` })
      const cId = inv.clientId || store.clients.find(c => c.name === inv.clientName)?.id
      if (cId) void logComm(cId, `Payment reminder sent for Invoice ${inv.number}`, 'email')
    } catch (e) {
      setFlash({ tone: 'danger', text: `Reminder not sent: ${(e as Error).message}` })
    } finally { setBusy(null) }
  }

  // ── Needs attention ──
  const attention = useMemo<AttnItem[]>(() => {
    if (!loaded) return []
    const items: AttnItem[] = []
    const names = (ids: string[]) => ids.map(id => shortName(empById.get(id)?.name))
    if (canInvoices) {
      for (const inv of out.overdue.slice(0, 4)) {
        const days = inv.dueDate ? daysBetween(inv.dueDate.slice(0, 10), today) : 0
        items.push({ key: `ov-${inv.id}`, tone: 'danger', title: days > 0 ? `${inv.number} is ${plural(days, 'day')} overdue` : `${inv.number} is overdue`,
          meta: [inv.clientName || 'No client', inv.dueDate && `due ${dateShort(inv.dueDate)}`, invoiceStatus(inv) === 'viewed' && 'viewed', invoiceStatus(inv) === 'partial' && 'partly paid'].filter(Boolean).join(' · '),
          amount: money(invoiceBalance(inv)), action: 'Remind', busy: busy === inv.id, onAction: () => void remind(inv) })
      }
      if (out.overdue.length > 4) {
        const rest = out.overdue.slice(4)
        items.push({ key: 'ov-more', tone: 'danger', title: `${plural(rest.length, 'more overdue invoice')}`, meta: 'Open the list to remind each client', amount: money(rest.reduce((s, i) => s + invoiceBalance(i), 0)), action: 'View', onAction: () => setDrill('overdue') })
      }
    }
    if (canApproveTime && unapproved.seconds > 0) items.push({ key: 'approve', tone: 'warning', title: 'Approve last week’s hours', meta: `${plural(unapproved.people, 'person', 'people')} · ${hmText(unapproved.seconds)} not approved`, action: 'Review', onAction: () => navigate('/time?tab=approve') })
    const wc = signals?.weekCloses?.find(w => w.weekStart === lastMonday && w.status === 'ready')
    if (canWeekly && wc) items.push({ key: 'wc', tone: 'warning', title: `Week of ${dateShort(wc.weekStart)} is ready to approve`, meta: [wc.summary.invoices != null && plural(wc.summary.invoices, 'draft invoice'), wc.summary.flags ? plural(wc.summary.flags, 'flag') : null].filter(Boolean).join(' · ') || 'Weekly close', action: 'Review', onAction: () => navigate('/weekly-close') })
    if (canInvoices && drafts.length) items.push({ key: 'drafts', tone: 'warning', title: `${plural(drafts.length, 'draft invoice')} to send`, meta: autoDrafts ? `${autoDrafts} from weekly close` : 'Ready to send to clients', action: 'Review', onAction: () => (canWeekly && autoDrafts ? navigate('/weekly-close') : setDrill('drafts')) })
    const pr = signals?.payroll
    if (canPayroll && pr && pr.run.status === 'open' && daysBetween(today, cycle.friday) <= 2) {
      const pending = pr.lines.filter(l => l.status === 'pending')
      if (pending.length) items.push({ key: 'payroll', tone: 'warning', title: `Payroll due ${new Date(`${cycle.friday}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })} ${dateShort(cycle.friday)}`,
        meta: [plural(new Set(pending.map(l => l.employee_id)).size, 'person', 'people'), pr.run.exchange_rate == null ? 'exchange rate not set' : pr.run.flags?.length ? plural(pr.run.flags.length, 'flag') + ' to check' : 'ready to mark paid'].join(' · '),
        action: 'Review', onAction: () => navigate('/payroll') })
    }
    if (canTimeOff && signals?.timeOff?.length) {
      const t = signals.timeOff
      items.push({ key: 'timeoff', tone: 'warning', title: plural(t.length, 'time-off request'), meta: t.slice(0, 2).map(r => `${shortName(empById.get(r.employee_id)?.name)} (${range2(r.start_date, r.end_date)})`).join(' · ') + (t.length > 2 ? ` · +${t.length - 2}` : ''), action: 'Review', onAction: () => navigate('/approvals') })
    }
    if (canApproveTime && signals?.manual?.length) {
      const m = signals.manual
      items.push({ key: 'manual', tone: 'warning', title: plural(m.length, 'missing-time request'), meta: [...new Set(names(m.map(r => r.employeeId)))].slice(0, 3).join(' · '), action: 'Review', onAction: () => navigate('/approvals') })
    }
    if (owner && computed.unpaidCount > 0) {
      const unpaid = invoicesInRangeBySize(store.invoices, range.from, range.to).filter(i => invoiceStatus(i) !== 'paid')
      items.push({ key: 'unpaid', tone: 'muted', title: `${computed.unpaidCount} unpaid in this period`, meta: 'Includes drafts not sent yet', amount: money(unpaid.reduce((s, i) => s + invoiceBalance(i), 0)), action: 'View', onAction: () => setDrill('unpaid') })
    }
    if (canRequests && signals?.staffRequests?.length) {
      const reqs = signals.staffRequests
      for (const r of reqs.slice(0, 3)) {
        const client = r.clientName || store.clients.find(c => c.id === r.clientId)?.name || 'a client'
        items.push({ key: `sr-${r.id}`, tone: 'info', title: `New staff request from ${client}`, meta: [r.type === 'replacement' ? `Replacement${r.employeeName ? ` for ${r.employeeName}` : ''}` : (r.role || 'Additional staff'), r.hoursPerWeek && `${r.hoursPerWeek} h/week`, r.startDate && `start ${dateShort(r.startDate)}`].filter(Boolean).join(' · '), action: 'Open', onAction: () => navigate('/requests') })
      }
      if (reqs.length > 3) items.push({ key: 'sr-more', tone: 'info', title: plural(reqs.length - 3, 'more staff request'), action: 'Open', onAction: () => navigate('/requests') })
    }
    if (canLeads && followUps.length) {
      const oldest = followUps[0], age = daysBetween(oldest.next_follow_up!, today)
      const allToday = followUps.every(l => l.next_follow_up === today)
      items.push({ key: 'leads', tone: 'info', title: `${plural(followUps.length, 'lead follow-up')} due${allToday ? ' today' : ''}`, meta: followUps.length === 1 ? `${oldest.company || oldest.name}${age > 0 ? `, ${plural(age, 'day')} late` : ''}` : `Oldest: ${oldest.company || oldest.name}${age > 0 ? `, ${plural(age, 'day')}` : ''}`, action: 'Open', onAction: () => navigate(followUps.length === 1 ? `/leads?open=${oldest.id}` : '/leads') })
    }
    if (canCandidates && appliedThisWeek.length) items.push({ key: 'apps', tone: 'info', title: `${plural(appliedThisWeek.length, 'new application')} this week`, meta: appliedThisWeek.slice(0, 3).map(c => c.name).join(' · '), action: 'Open', onAction: () => navigate('/candidates') })
    if (can.viewClients(role)) {
      for (const c of expiringContracts(store.clients, today)) {
        const placements = new Set(store.projects.filter(p => p.clientId === c.id).flatMap(p => p.employeeIds || [])).size
        items.push({ key: `ct-${c.id}`, tone: c.daysLeft <= 14 ? 'warning' : 'muted', title: `${c.name} contract ends ${dateShort(c.contractEnd)}`, meta: `${c.daysLeft === 0 ? 'Today' : plural(c.daysLeft, 'day')} · ${plural(placements, 'placement')}`, action: 'View', onAction: () => navigate(`/clients/${c.id}`) })
      }
    }
    if (missingRates.length) {
      const bill = missingRates.filter(m => m.bill).length, pay = missingRates.filter(m => m.pay).length
      const what = bill && pay ? 'bill or pay rate' : bill ? 'bill rate' : 'pay rate'
      const projects = [...new Map(missingRates.map(m => [m.project.id, m.project])).values()]
      items.push({ key: 'rates', tone: 'muted', title: `${plural(missingRates.length, 'placement')} ${missingRates.length === 1 ? 'has' : 'have'} no ${what}`, meta: `${projects.slice(0, 2).map(p => p.name).join(', ')}${projects.length > 2 ? ` +${projects.length - 2}` : ''} · blocks weekly close`, action: 'Fix', onAction: () => navigate(projects.length === 1 ? `/projects/${projects[0].id}` : '/projects') })
    }
    if (can.viewClients(role)) {
      const risk = retentionWatch(store.clients, store.invoices, today)
      if (risk.length) items.push({ key: 'retention', tone: 'muted', title: `${plural(risk.length, 'client')} not invoiced in 60+ days`, meta: risk.slice(0, 3).map(r => r.client.name).join(' · '), action: 'View', onAction: () => navigate(can.viewReports(role) ? '/reports' : '/clients') })
    }
    if (can.viewEmployees(role)) for (const a of anniversaries(store.employees)) items.push({ key: `an-${a.id}`, tone: 'muted', title: `${a.name} — ${plural(a.years, 'year')} with YVA`, meta: `Work anniversary in ${new Date().getFullYear()}`, action: 'View', onAction: () => navigate(`/employees/${a.id}`) })
    return sortAttention(items)
  }, [loaded, store, out, today, canInvoices, canApproveTime, unapproved, signals, canWeekly, lastMonday, drafts, autoDrafts, canPayroll, cycle.friday, canTimeOff, owner, computed.unpaidCount, range, canRequests, canLeads, followUps, canCandidates, appliedThisWeek, role, missingRates, empById, busy]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPI strip per role ──
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null)
  const prevPhrase = period === 'month' ? `in ${prev.label}` : period === 'quarter' ? prev.label : 'in the previous period'
  const kpis: Kpi[] = (() => {
    const hoursPeople = computed.employeePerformance.length
    const net = computed.totalNetEarnings - expenses.total
    if (role === 'ceo') {
      const bp = pct(computed.totalBilled, prevComputed.totalBilled), hp = pct(computed.totalHours, prevComputed.totalHours)
      return [
        { label: 'Billed', value: money(computed.totalBilled), note: bp !== null ? `${bp >= 0 ? '+' : ''}${bp}% vs ${prev.label}` : `nothing billed ${prevPhrase}`, tone: bp !== null ? (bp >= 0 ? 'success' : 'danger') : undefined, onClick: () => setDrill('billed') },
        ...(data.collected === null ? [] : [{ label: 'Collected', value: data.collected === undefined ? '…' : money(data.collected), note: data.collected !== undefined && computed.totalBilled > 0 ? `${Math.round((data.collected / computed.totalBilled) * 100)}% of billed` : 'payments received', onClick: () => setDrill('collected') } as Kpi]),
        { label: 'Outstanding', value: money(out.total), note: out.overdue.length ? `${out.overdue.length} overdue · ${money(out.overdueTotal)}` : plural(out.open.length, 'open invoice'), tone: out.overdue.length ? 'danger' : undefined, onClick: () => setDrill('outstanding') },
        { label: 'Net earnings', value: money(net), note: `after ${money(expenses.total)} expenses`, tone: net < 0 ? 'danger' : undefined, onClick: () => setDrill('net') },
        { label: 'Hours tracked', value: hoursShort(computed.totalHours), note: `${plural(hoursPeople, 'person', 'people')}${hp !== null ? ` · ${hp >= 0 ? '+' : ''}${hp}%` : ''}`, onClick: () => setDrill('hours') },
      ]
    }
    if (role === 'admin') {
      const active = store.projects.filter(p => (p.status || '').toLowerCase() === 'active').length
      const hiring = store.projects.filter(p => (p.status || '').toLowerCase() === 'hiring').length
      const inPipeline = candidates.filter(c => !['hired', 'rejected'].includes(c.stage)).length
      return [
        { label: 'Active projects', value: active, note: missingRates.length ? `${plural(missingRates.length, 'missing rate')}` : plural(store.projects.length, 'project') + ' in all', tone: missingRates.length ? 'warning' : undefined, onClick: () => navigate('/projects') },
        { label: 'Team', value: store.employees.length, note: tracking ? `${tracking.length} tracking now` : undefined, onClick: () => setDrill('team') },
        { label: 'Open candidates', value: inPipeline, note: plural(hiring, 'hiring project'), onClick: () => navigate('/candidates') },
        { label: 'Draft invoices', value: drafts.length, note: drafts.length ? 'ready to send' : 'none waiting', tone: drafts.length ? 'warning' : undefined, onClick: () => setDrill('drafts') },
        { label: 'Overdue', value: out.overdue.length, note: out.overdue.length ? money(out.overdueTotal) : 'all on time', tone: out.overdue.length ? 'danger' : undefined, onClick: () => setDrill('overdue') },
      ]
    }
    if (role === 'accounting') {
      const periodName = period === 'month' ? new Date(`${range.from}T12:00:00`).toLocaleString('en-US', { month: 'long' }) : period === 'quarter' ? 'This quarter' : `${dateShort(range.from)} – ${dateShort(range.to)}`
      return [
        { label: 'Outstanding', value: money(out.total), note: plural(out.open.length, 'invoice'), onClick: () => setDrill('outstanding') },
        { label: 'Overdue', value: money(out.overdueTotal), note: plural(out.overdue.length, 'invoice'), tone: out.overdue.length ? 'danger' : undefined, onClick: () => setDrill('overdue') },
        { label: 'Drafts to send', value: drafts.length, note: autoDrafts ? `${autoDrafts} from weekly close` : drafts.length ? 'ready to send' : 'none waiting', tone: drafts.length ? 'warning' : undefined, onClick: () => (canWeekly && autoDrafts ? navigate('/weekly-close') : setDrill('drafts')) },
        { label: 'Hours tracked', value: hoursShort(computed.totalHours), note: unapproved.seconds ? `${hmText(unapproved.seconds)} not approved` : plural(hoursPeople, 'person', 'people'), tone: unapproved.seconds ? 'warning' : undefined, onClick: () => setDrill('hours') },
        { label: 'Expenses', value: money(expenses.total), note: periodName, onClick: () => setDrill('expenses') },
      ]
    }
    if (role === 'recruiter') {
      const month = today.slice(0, 7)
      const hired = candidates.filter(c => c.stage === 'hired' && todayIso(new Date(c.updatedAt || 0)).startsWith(month)).length
      const hiring = store.projects.filter(p => (p.status || '').toLowerCase() === 'hiring').length
      return [
        { label: 'In pipeline', value: candidates.filter(c => !['hired', 'rejected'].includes(c.stage)).length, note: `${candidates.length} in all`, onClick: () => navigate('/candidates') },
        { label: 'Interviews', value: candidates.filter(c => c.stage === 'interview').length, note: `${candidates.filter(c => c.stage === 'offer').length} at offer`, onClick: () => navigate('/candidates') },
        { label: 'New this week', value: appliedThisWeek.length, note: 'applications', onClick: () => navigate('/candidates') },
        { label: 'Hired this month', value: hired, note: plural(hiring, 'hiring project'), tone: hired ? 'success' : undefined },
        { label: 'Team', value: store.employees.length, onClick: () => navigate('/employees') },
      ]
    }
    // lead_gen (and any other staff role)
    const pipeline = openLeads.reduce((s, l) => s + (Number(l.value_monthly) || 0), 0)
    const newThisWeek = (visibleLeads ?? []).filter(l => l.created_at.slice(0, 10) >= addDays(today, -6)).length
    const overdueFollowUps = followUps.filter(l => l.next_follow_up! < today).length
    const activeClients = new Set(store.invoices.filter(i => (i.date || '').startsWith(today.slice(0, 7))).map(i => i.clientName)).size
    const leadsKnown = visibleLeads !== null
    return [
      { label: 'New leads', value: leadsKnown ? openLeads.filter(l => l.stage === 'new').length : '—', note: leadsKnown ? `${newThisWeek} this week` : undefined, onClick: canLeads ? () => navigate('/leads') : undefined },
      { label: 'Follow-ups due', value: leadsKnown ? followUps.length : '—', note: overdueFollowUps ? `${overdueFollowUps} overdue` : undefined, tone: overdueFollowUps ? 'danger' : followUps.length ? 'warning' : undefined, onClick: canLeads ? () => navigate('/leads') : undefined },
      { label: 'Meetings', value: leadsKnown ? openLeads.filter(l => l.stage === 'meeting').length : '—', onClick: canLeads ? () => navigate('/leads') : undefined },
      { label: 'Open pipeline', value: leadsKnown ? `${usdShort(pipeline)}/mo` : '—', note: leadsKnown ? plural(openLeads.length, 'open lead') : undefined, onClick: canLeads ? () => navigate('/leads') : undefined },
      { label: 'Clients', value: store.clients.length, note: `${activeClients} active this month`, onClick: can.viewClients(role) ? () => navigate('/clients') : undefined },
    ]
  })()

  // ── This week (money cycle) ──
  type WeekRow = { date: string; title: string; meta: string; to: string }
  const week: WeekRow[] = []
  if (canWeekly) week.push({ date: cycle.monday, title: 'Weekly close prepares', to: '/weekly-close',
    meta: `12:05 am · ${draftEstimate === null ? 'draft invoices to review' : draftEstimate ? `about ${plural(draftEstimate, 'draft invoice')} to review` : 'nothing tracked yet this week'}` })
  if (canPayroll) {
    const pr = signals?.payroll
    const flags = pr?.run.flags?.length ?? 0
    week.push({ date: cycle.wednesday, title: 'Payroll reminder', to: '/payroll', meta: `9:07 am · ${flags ? `${plural(flags, 'flag')} to check, set exchange rate` : 'check flags, set exchange rate'}` })
    let payMeta = cycle.wednesday <= cycle.friday ? 'Payroll prepares Wednesday 9:07 am' : 'Not prepared yet'
    if (pr) {
      const people = plural(new Set(pr.lines.map(l => l.employee_id)).size, 'person', 'people')
      if (pr.run.status === 'paid') payMeta = `Paid · ${people}`
      else if (owner) {
        const allDop = pr.lines.length > 0 && pr.lines.every(l => l.net_dop != null)
        payMeta = allDop ? `${people} · est. ${dop(pr.lines.reduce((s, l) => s + (l.net_dop || 0), 0))}` : `${people} · est. ${money(pr.lines.reduce((s, l) => s + (Number(l.net_usd) || 0), 0))} (paid in DOP)`
      } else payMeta = people
    }
    week.push({ date: cycle.friday, title: 'Payday', to: '/payroll', meta: payMeta })
  }
  week.sort((a, b) => (a.date < b.date ? -1 : 1))

  // ── Lead pipeline, live tracking, chart ──
  const showPipeline = canLeads && role !== 'accounting' && visibleLeads !== null
  const leadStages: Stage[] = LEAD_STAGES.map(s => ({ ...s, n: (visibleLeads ?? []).filter(l => l.stage === s.key).length }))
  const openValue = openLeads.reduce((s, l) => s + (Number(l.value_monthly) || 0), 0)
  const trackingNames = (tracking ?? []).map(id => empById.get(id)?.name?.split(/\s+/)[0]).filter(Boolean) as string[]
  const chart = lastSixMonths(store.invoices)
  const goal = Number(settings.monthlyGoal) || 0
  const top = Math.max(goal, ...chart.map(c => c.value), 1)
  const current = chart[chart.length - 1]
  const showPeriod = role === 'ceo' || role === 'accounting'

  const rightCol = week.length > 0 || showPipeline || canTracker

  return (
    <div className="page home">
      <PageHeader keepTitleOnPhone className="home-head"
        title={`${greeting(new Date().getHours())}, ${firstName}`}
        sub={<>{weekdayDate(new Date())}{loaded && <> · {attention.length === 0 ? 'nothing needs you' : `${plural(attention.length, 'thing')} need${attention.length === 1 ? 's' : ''} you`}</>}</>}
        actions={showPeriod ? <PeriodControl period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} /> : undefined} />

      {flash && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}
      {data.loadError && <Banner tone="danger">Couldn't load the dashboard data: {data.loadError}</Banner>}

      {loaded
        ? <KpiStrip items={kpis} />
        : <div className="kpi-strip">{[0, 1, 2, 3, 4].map(i => <div key={i} className="kpi-cell"><Skel w="45%" h={12} /><Skel w="70%" h={26} /><Skel w="55%" h={11} /></div>)}</div>}

      <div className="grid-auto home-grid">
        <AttentionList items={attention} loading={!loaded} />
        {rightCol && (
          <div className="home-col">
            {week.length > 0 && (
              <section className="card card--navy home-week" aria-label="This week">
                <div className="home-week__head"><h2 className="card__title">This week</h2><span className="home-week__range mono">{range2(week[0].date, week[week.length - 1].date).toUpperCase()}</span></div>
                {week.map(w => {
                  const d = new Date(`${w.date}T12:00:00`)
                  return (
                    <button key={w.title} type="button" className="home-week__row" onClick={() => navigate(w.to)}>
                      <span className="home-week__date"><span className="home-week__dow">{d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</span><span className="home-week__day">{d.getDate()}</span></span>
                      <span className="home-week__text"><span className="home-week__title">{w.title}</span><span className="home-week__meta">{w.meta}</span></span>
                    </button>
                  )
                })}
              </section>
            )}
            {showPipeline && (
              <Card pad title="Lead pipeline" meta={`${usdShort(openValue)}/mo open`} onClick={() => navigate('/leads')} className="home-pipe-card">
                <StageBar stages={leadStages} />
              </Card>
            )}
            {canTracker && (
              <div className="card home-live">
                <Dot live={!!tracking?.length} tone="muted" />
                <div className="list-row__main">
                  <span className="list-row__title">{tracking === null ? 'Checking who is tracking…' : `${plural(tracking.length, 'person', 'people')} tracking now`}</span>
                  <span className="list-row__meta">{trackingNames.length ? `${trackingNames.slice(0, 3).join(', ')}${trackingNames.length > 3 ? ` +${trackingNames.length - 3}` : ''} · YVA Time` : 'YVA Time'}</span>
                </div>
                <button type="button" className="link" onClick={() => navigate('/time?tab=live')}>Live →</button>
              </div>
            )}
          </div>
        )}
      </div>

      {owner && loaded && (
        <Card pad title="Billed, last 6 months" meta={goal > 0 ? `Goal ${money(goal)} / month · ${new Date(`${current.bucket}-15T12:00:00`).toLocaleString('en-US', { month: 'long' })} ${Math.round((current.value / goal) * 100)}%` : undefined} className="home-chart-card">
          <div className="home-chart" role="img" aria-label={`Billed per month: ${chart.map(c => `${c.label} ${money(c.value)}`).join(', ')}`}>
            {goal > 0 && <span className="home-chart__goal" style={{ bottom: `${(goal / top) * 85}%` }}><span className="home-chart__goal-tag mono">GOAL</span></span>}
            {chart.map(c => (
              <div key={c.bucket} className="home-chart__col">
                <span className="home-chart__v mono">{c.value > 0 ? usdShort(c.value) : ''}</span>
                <div className={`home-chart__bar${c.current ? ' home-chart__bar--now' : ''}${c.value === 0 ? ' home-chart__bar--zero' : ''}`} style={{ height: `${(c.value / top) * 85}%` }} />
              </div>
            ))}
          </div>
          <div className="home-chart__labels">{chart.map(c => <span key={c.bucket}>{c.label}</span>)}</div>
        </Card>
      )}

      {role === 'recruiter' && loaded && (
        <div className="grid-auto">
          <CandidatePipelineCard candidates={candidates} onOpen={() => navigate('/candidates')} />
          <HiringProjectsCard store={store} onOpen={id => navigate(`/projects/${id}`)} />
        </div>
      )}
      {role === 'lead_gen' && loaded && (
        <div className="grid-auto">
          <ContractsCard store={store} onOpen={id => navigate(`/clients/${id}`)} />
          <RetentionRiskCard store={store} onOpen={id => navigate(`/clients/${id}`)} />
        </div>
      )}

      <KpiDrillModal kind={drill} onClose={() => setDrill(null)} ctx={{ store, computed, range, generalExpenses, payments: data.payments }} />
    </div>
  )
}

