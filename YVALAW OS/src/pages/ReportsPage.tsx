// Reports view (Finance hub) + the building blocks Home reuses: data hook, period control,
// KPI drill-down modal, attention list, responsive table, pipeline bar.
// Redesign 2026-11: same calculations and role views as the old dashboard, new layout (home.css).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllDataSnapshot } from '../services/dataSnapshot'
import {
  computeReports, periodRange, invoicesInRangeBySize, expensesInRange, arAging, revenueForecast,
  retentionWatch, expiringContracts, anniversaries, filterInvoiceHistory, invoiceHistoryCsvRows, payrollCsvRows,
  invoiceHours, invoiceDay, invoiceStatus, invoiceBalance, outstandingSummary, todayIso,
  makeCurrentMonthRange, type DateRange, type Period, type ReportsResult,
} from '../services/reportsService'
import { formatMoney, fmtHoursHM } from '../utils/money'
import { loadSettings, loadGeneralExpenses, loadCandidates } from '../services/storage'
import { fillMissingStripeFees, loadPayments, type ClientPayment } from '../services/payments'
import { feeSummary } from '../utils/stripeFees'
import { useToast } from '../context/ToastContext'
import type { AppSettings, Candidate, DataSnapshot, Expense, Invoice } from '../data/types'
import { useRole } from '../context/RoleContext'
import { can, type AppRole } from '../lib/roles'
import { Banner, Card, Dot, KpiStrip, Modal, PageHeader, Pill, SearchInput, Segmented, Skel, useIsMobile, type Kpi } from '../components/ui'
import { dateShort } from '../utils/format'
import { logAction } from '../services/activityLog'

/* ══ Shared helpers ═══════════════════════════════════════════════════ */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function downloadCSV(filename: string, rows: string[][]): void {
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = rows.map(r => r.map(escape).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const DEFAULT_SETTINGS: AppSettings = { usdToDop: 0, companyName: 'YVA Staffing', companyEmail: '', emailSignature: '' }
const EMPTY_STORE: DataSnapshot = { employees: [], clients: [], projects: [], invoices: [], invoiceCounter: 1 }

/** Everything the dashboard numbers come from. `payments` is undefined while loading, null when the
 *  client_payments table isn't available (Collected is then hidden, as before). CEO only. */
export function useReportsData(role: AppRole, range: DateRange) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [store, setStore] = useState<DataSnapshot>(EMPTY_STORE)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [generalExpenses, setGeneralExpenses] = useState<Expense[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [payments, setPayments] = useState<ClientPayment[] | null | undefined>(undefined)
  const [paymentsTick, setPaymentsTick] = useState(0)

  useEffect(() => {
    void loadSettings().then(setSettings).catch(() => {})
    getAllDataSnapshot().then(s => { setStore(s); setLoaded(true) }).catch(e => { setLoadError((e as Error).message || 'Could not load data'); setLoaded(true) })
    void loadGeneralExpenses().then(setGeneralExpenses).catch(() => {})
    void loadCandidates().then(setCandidates).catch(() => {})
  }, [])

  const isOwner = can.viewOwnerStats(role)
  useEffect(() => {
    if (!isOwner) return
    let alive = true
    setPayments(undefined)
    void loadPayments({ from: range.from || undefined, to: range.to || undefined })
      .then(r => { if (alive) setPayments(r.error ? null : r.rows) })
      .catch(() => { if (alive) setPayments(null) })
    return () => { alive = false }
  }, [range.from, range.to, isOwner, paymentsTick])

  const collected = payments ? payments.reduce((x, p) => x + p.amount, 0) : payments
  const reloadPayments = () => setPaymentsTick(t => t + 1)
  return { settings, store, loaded, loadError, generalExpenses, candidates, payments, collected, reloadPayments }
}

/** This month / Quarter / Custom (Custom reveals the from/to inputs) */
export function usePeriod() {
  const [period, setPeriod] = useState<Period>('month')
  const [custom, setCustom] = useState<DateRange>(() => makeCurrentMonthRange())
  const range = useMemo(() => periodRange(period, custom), [period, custom])
  // Switching to Custom starts from the range that was showing
  const choose = (p: Period) => { if (p === 'custom' && period !== 'custom') setCustom(range); setPeriod(p) }
  return { period, setPeriod: choose, custom, setCustom, range }
}

export function PeriodControl({ period, onPeriod, custom, onCustom }: { period: Period; onPeriod: (p: Period) => void; custom: DateRange; onCustom: (r: DateRange) => void }) {
  return (
    <div className="home-period">
      <Segmented label="Period" value={period} onChange={onPeriod} options={[{ value: 'month', label: 'This month' }, { value: 'quarter', label: 'Quarter' }, { value: 'custom', label: 'Custom' }]} />
      {period === 'custom' && (
        <div className="home-period__dates">
          <input className="input input--sm" type="date" aria-label="From" value={custom.from} onChange={e => onCustom({ ...custom, from: e.target.value })} />
          <span className="muted">–</span>
          <input className="input input--sm" type="date" aria-label="To" value={custom.to} onChange={e => onCustom({ ...custom, to: e.target.value })} />
        </div>
      )}
    </div>
  )
}

/* ── Responsive table: table on desktop, list rows on phones ──────── */

export type RCol<T> = { label: string; cell: (r: T) => ReactNode; num?: boolean; strong?: boolean; phone?: 'title' | 'right' | 'hide' }
export function RTable<T>({ rows, cols, rowKey, empty, size = 'md', onRow }: {
  rows: T[]; cols: RCol<T>[]; rowKey: (r: T, i: number) => string; empty?: ReactNode; size?: 'sm' | 'md' | 'lg'; onRow?: (r: T) => void
}) {
  const mobile = useIsMobile()
  if (rows.length === 0) return <div className="home-empty">{empty ?? 'Nothing to show.'}</div>
  if (mobile) {
    const title = cols.find(c => c.phone === 'title') ?? cols[0]
    const right = cols.find(c => c.phone === 'right') ?? [...cols].reverse().find(c => c.num && c !== title)
    const meta = cols.filter(c => c !== title && c !== right && c.phone !== 'hide')
    return (
      <div className="home-mlist">
        {rows.map((r, i) => {
          const body = <>
            <span className="list-row__main">
              <span className="list-row__title">{title.cell(r)}</span>
              {meta.length > 0 && <span className="list-row__meta">{meta.map((c, j) => <span key={j}>{j > 0 && ' · '}<span className="home-mlist__k">{c.label}</span> {c.cell(r)}</span>)}</span>}
            </span>
            {right && <span className="home-mlist__right num">{right.cell(r)}</span>}
          </>
          return onRow
            ? <button key={rowKey(r, i)} type="button" className="list-row home-mlist__row home-mlist__row--click" onClick={() => onRow(r)}>{body}</button>
            : <div key={rowKey(r, i)} className="list-row home-mlist__row">{body}</div>
        })}
      </div>
    )
  }
  return (
    <div className="home-tablewrap">
      <table className={`table home-t-${size}`}>
        <thead><tr>{cols.map(c => <th key={c.label} className={c.num ? 't-right' : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className={onRow ? 'is-clickable' : undefined} onClick={onRow ? () => onRow(r) : undefined}>
              {cols.map(c => <td key={c.label} className={cx(c.num && 't-num', c.strong && 't-strong')}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Attention list (Home + the role views here) ──────────────────── */

export type AttnTone = 'danger' | 'warning' | 'info' | 'muted'
export type AttnItem = { key: string; tone: AttnTone; title: ReactNode; meta?: ReactNode; amount?: string; action?: string; onAction?: () => void; busy?: boolean }
const TONE_ORDER: Record<AttnTone, number> = { danger: 0, warning: 1, info: 2, muted: 3 }
export const sortAttention = (items: AttnItem[]) => items.map((it, i) => ({ it, i })).sort((a, b) => TONE_ORDER[a.it.tone] - TONE_ORDER[b.it.tone] || a.i - b.i).map(x => x.it)

export function AttentionList({ items, loading, className }: { items: AttnItem[]; loading?: boolean; className?: string }) {
  return (
    <Card title="Needs attention" meta={loading ? undefined : `${items.length} open`} className={cx('home-attn', className)}>
      {loading
        ? [0, 1, 2, 3].map(i => <div key={i} className="card__row"><Skel w={8} h={8} r={4} /><div className="list-row__main"><Skel w="60%" /><Skel w="35%" h={11} /></div><Skel w={70} h={34} r={8} /></div>)
        : items.length === 0
          ? <div className="home-attn__empty">Nothing waiting. Nice.</div>
          : items.map(a => (
            <div key={a.key} className="card__row home-attn__row">
              <Dot tone={a.tone} />
              <div className="list-row__main">
                <span className="list-row__title">{a.title}</span>
                {a.meta && <span className="list-row__meta">{a.meta}</span>}
              </div>
              {a.amount && <span className="home-attn__amt num">{a.amount}</span>}
              {a.action && a.onAction && <button type="button" className="btn btn--sm" onClick={a.onAction} disabled={a.busy}>{a.busy ? 'Sending…' : a.action}</button>}
            </div>
          ))}
    </Card>
  )
}

/* ── Stage bar (lead pipeline, candidate pipeline) ────────────────── */

export type Stage = { key: string; label: string; n: number; color: string }
export function StageBar({ stages }: { stages: Stage[] }) {
  const total = stages.reduce((s, x) => s + x.n, 0)
  return (
    <div className="home-pipe">
      <div className="home-pipe__bar" aria-hidden>
        {total === 0 ? <span className="home-pipe__seg home-pipe__seg--empty" /> : stages.filter(s => s.n > 0).map(s => <span key={s.key} className="home-pipe__seg" style={{ flex: s.n, background: s.color }} />)}
      </div>
      <div className="home-pipe__stats">
        {stages.map(s => <div key={s.key} className="home-pipe__stat"><span className="home-pipe__n num">{s.n}</span><span>{s.label}</span></div>)}
      </div>
    </div>
  )
}
const CANDIDATE_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const
const CANDIDATE_COLORS = ['#cbd5e1', '#94a3b8', '#64748b', '#475569', '#facc15', '#fca5a5']
export function candidateStages(candidates: Candidate[]): Stage[] {
  return CANDIDATE_STAGES.map((k, i) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1), n: candidates.filter(c => c.stage === k).length, color: CANDIDATE_COLORS[i] }))
}

/* ── Role cards reused on Home (recruiter / lead gen) ─────────────── */

export function CandidatePipelineCard({ candidates, onOpen }: { candidates: Candidate[]; onOpen?: () => void }) {
  return <Card pad title="Pipeline by stage" actions={onOpen && <button type="button" className="link" onClick={onOpen}>Candidates →</button>}><StageBar stages={candidateStages(candidates)} /></Card>
}
export function HiringProjectsCard({ store, onOpen }: { store: DataSnapshot; onOpen: (id: string) => void }) {
  const hiring = store.projects.filter(p => (p.status || '').toLowerCase() === 'hiring')
  return (
    <Card title="Projects actively hiring" meta={`${hiring.length}`}>
      {hiring.length === 0 ? <div className="home-empty">No projects in hiring stage.</div> : hiring.map(p => (
        <button key={p.id} type="button" className="list-row home-mlist__row--click" onClick={() => onOpen(p.id)}>
          <span className="list-row__main"><span className="list-row__title">{p.name}</span>{p.projectNeeds && <span className="list-row__meta">{p.projectNeeds}</span>}</span>
        </button>
      ))}
    </Card>
  )
}
export function ContractsCard({ store, onOpen }: { store: DataSnapshot; onOpen: (id: string) => void }) {
  const list = expiringContracts(store.clients, todayIso())
  return (
    <Card title="Contracts expiring (60 days)" meta={`${list.length}`}>
      {list.length === 0 ? <div className="home-empty">No contracts expiring soon.</div> : list.map(c => (
        <button key={c.id} type="button" className="list-row home-mlist__row--click" onClick={() => onOpen(c.id)}>
          <span className="list-row__main"><span className="list-row__title">{c.name}</span><span className="list-row__meta">Ends {dateShort(c.contractEnd)}</span></span>
          <span className={cx('home-mlist__right', c.daysLeft <= 14 ? 't-danger' : 't-warning')}>{c.daysLeft === 0 ? 'Today' : `${c.daysLeft}d left`}</span>
        </button>
      ))}
    </Card>
  )
}
export function RetentionRiskCard({ store, onOpen }: { store: DataSnapshot; onOpen: (id: string) => void }) {
  const list = retentionWatch(store.clients, store.invoices, todayIso(), { includeNeverInvoiced: true })
  return (
    <Card title="Retention risk (60+ days inactive)" meta={`${list.length}`}>
      {list.length === 0 ? <div className="home-empty">All clients are active.</div> : list.map(r => (
        <button key={r.client.id} type="button" className="list-row home-mlist__row--click" onClick={() => onOpen(r.client.id)}>
          <span className="list-row__main"><span className="list-row__title">{r.client.name}</span><span className="list-row__meta">{r.lastDate ? `Last invoice ${dateShort(r.lastDate)} · ${r.days}d ago` : 'Never invoiced'}</span></span>
        </button>
      ))}
    </Card>
  )
}

/* ── KPI drill-down modal ─────────────────────────────────────────── */

export type DrillKind = 'billed' | 'collected' | 'fees' | 'hours' | 'payroll' | 'expenses' | 'net' | 'paid' | 'unpaid' | 'topClient' | 'clients' | 'team' | 'outstanding' | 'overdue' | 'drafts'
export type DrillCtx = { store: DataSnapshot; computed: ReportsResult; range: DateRange; generalExpenses: Expense[]; payments: ClientPayment[] | null | undefined }
type DItem = { label: string; sub?: string; right?: string; status?: string; nav?: string }

export function buildDrill(kind: DrillKind, ctx: DrillCtx): { title: string; items: DItem[] } {
  const { store, computed, range } = ctx
  const today = todayIso()
  const invoicesInRange = invoicesInRangeBySize(store.invoices, range.from, range.to)
  const { rows: rangeExpenses, total: totalExpenses } = expensesInRange(ctx.generalExpenses, range.from, range.to)
  const netAfterExpenses = computed.totalNetEarnings - totalExpenses
  const navInv = (inv: Invoice) => `/invoice?open=${encodeURIComponent(inv.id)}`
  const invRow = (inv: Invoice, sub?: string, right = formatMoney(Number(inv.subtotal) || 0)): DItem => ({ label: `${inv.number} — ${inv.clientName || '—'}`, sub: sub ?? (inv.projectName || inv.date || ''), right, status: inv.status || 'draft', nav: navInv(inv) })
  switch (kind) {
    case 'billed': return { title: 'Total billed — invoices in range', items: invoicesInRange.map(inv => invRow(inv)) }
    case 'collected': {
      const byId = new Map(store.invoices.map(i => [i.id, i]))
      return { title: 'Collected — payments received', items: [...(ctx.payments || [])].sort((a, b) => b.paidOn.localeCompare(a.paidOn)).map(p => {
        const inv = byId.get(p.invoiceId)
        return { label: inv ? `${inv.number} — ${inv.clientName || '—'}` : 'Payment', sub: `${p.paidOn} · ${p.method}${p.reference ? ` · ${p.reference}` : ''}`, right: formatMoney(p.amount), nav: inv ? navInv(inv) : undefined }
      }) }
    }
    case 'fees': {
      const byId = new Map(store.invoices.map(i => [i.id, i]))
      const refunded = new Set((ctx.payments || []).filter(p => p.kind !== 'payment' && p.stripeChargeId).map(p => p.stripeChargeId))
      return { title: 'Card & bank fees — Stripe payments', items: (ctx.payments || []).filter(p => p.source === 'stripe' && p.kind === 'payment')
        .sort((a, b) => b.paidOn.localeCompare(a.paidOn)).map(p => {
          const inv = byId.get(p.invoiceId)
          return { label: inv ? `${inv.number} — ${inv.clientName || '—'}` : 'Stripe payment',
            sub: `${p.paidOn} · ${p.method === 'ach' ? 'bank' : p.method} · ${formatMoney(p.amount)} paid${p.stripeChargeId && refunded.has(p.stripeChargeId) ? ' · refunded (fee not returned)' : ''}`,
            right: p.stripeFee == null ? 'fee not known yet' : `${formatMoney(p.stripeFee)} fee`, nav: inv ? navInv(inv) : undefined }
        }) }
    }
    case 'hours': return { title: 'Hours — by employee', items: [...computed.employeePerformance].sort((a, b) => b.hours - a.hours).map(e => ({ label: e.name, sub: plural(e.invoiceCount, 'invoice'), right: fmtHoursHM(e.hours) })) }
    case 'payroll': return { title: 'Est. payroll — by employee', items: [...computed.employeePerformance].filter(e => e.payroll > 0).sort((a, b) => b.payroll - a.payroll).map(e => ({ label: e.name, sub: `${fmtHoursHM(e.hours)} billed`, right: formatMoney(e.payroll) })) }
    case 'expenses': return { title: 'Business expenses in range', items: [...rangeExpenses].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(e => ({ label: e.description, sub: `${e.date || ''}${e.category ? ` · ${e.category}` : ''}`, right: formatMoney(Number(e.amount) || 0) })) }
    case 'net': return { title: 'Net earnings — breakdown', items: [
      { label: 'Total billed', right: formatMoney(computed.totalBilled) },
      { label: 'Est. payroll', right: `− ${formatMoney(computed.totalPayroll)}` },
      { label: 'Business expenses', right: `− ${formatMoney(totalExpenses)}` },
      { label: 'Net earnings', right: formatMoney(netAfterExpenses), sub: netAfterExpenses >= 0 ? 'Positive' : 'Negative' },
    ] }
    case 'paid': return { title: 'Paid invoices in range', items: invoicesInRange.filter(i => invoiceStatus(i) === 'paid').map(inv => invRow(inv, inv.date || '')) }
    case 'unpaid': return { title: 'Unpaid invoices in range', items: invoicesInRange.filter(i => invoiceStatus(i) !== 'paid').map(inv => invRow(inv, inv.dueDate ? `Due ${inv.dueDate}` : (inv.date || ''))) }
    case 'topClient': return { title: 'Revenue by client', items: computed.byClient.map(c => ({ label: c.name, sub: plural(c.invoiceCount, 'invoice'), right: formatMoney(c.total) })) }
    case 'clients': {
      const byName: Record<string, number> = {}
      for (const c of computed.byClient) byName[c.name] = c.total
      return { title: 'All clients', items: store.clients.map(c => ({ label: c.name, sub: c.company || c.email || '', right: byName[c.name] ? formatMoney(byName[c.name]) : '—', nav: `/clients/${c.id}` })) }
    }
    case 'team': {
      const byName = new Map(computed.employeePerformance.map(e => [e.name, e]))
      return { title: 'Team members', items: store.employees.map(e => { const perf = byName.get(e.name); return { label: e.name, sub: e.role || e.employmentType || '', right: perf ? fmtHoursHM(perf.hours) : '—', nav: `/employees/${e.id}` } }) }
    }
    case 'outstanding': return { title: 'Outstanding — open invoices', items: outstandingSummary(store.invoices, today).open.map(inv => invRow(inv, inv.dueDate ? `Due ${inv.dueDate}` : (inv.date || ''), formatMoney(invoiceBalance(inv)))) }
    case 'overdue': return { title: 'Overdue invoices', items: outstandingSummary(store.invoices, today).overdue.map(inv => invRow(inv, inv.dueDate ? `Due ${inv.dueDate}` : (inv.date || ''), formatMoney(invoiceBalance(inv)))) }
    case 'drafts': return { title: 'Draft invoices to send', items: store.invoices.filter(i => invoiceStatus(i) === 'draft').sort((a, b) => invoiceDay(b).localeCompare(invoiceDay(a))).map(inv => invRow(inv, `${inv.date || ''}${inv.autoGenerated ? ' · from weekly close' : ''}`)) }
  }
}

export function KpiDrillModal({ kind, ctx, onClose }: { kind: DrillKind | null; ctx: DrillCtx; onClose: () => void }) {
  const navigate = useNavigate()
  const d = kind ? buildDrill(kind, ctx) : null
  return (
    <Modal open={!!d} onClose={onClose} title={d?.title ?? ''} size="wide">
      {d && (d.items.length === 0
        ? <div className="home-empty">No data for this period.</div>
        : <div className="home-drill">
          {d.items.map((item, i) => {
            const body = <>
              <span className="list-row__main"><span className="list-row__title home-drill__label">{item.label}</span>{item.sub && <span className="list-row__meta">{item.sub}</span>}</span>
              {item.status && <Pill status={item.status} />}
              {item.right && <span className="home-drill__right num">{item.right}</span>}
              {item.nav && <span className="soft" aria-hidden>→</span>}
            </>
            return item.nav
              ? <button key={i} type="button" className="list-row home-drill__row home-drill__row--click" onClick={() => { navigate(item.nav!); onClose() }}>{body}</button>
              : <div key={i} className="list-row home-drill__row">{body}</div>
          })}
        </div>)}
    </Modal>
  )
}

/* ══ Reports page ═════════════════════════════════════════════════════ */

export default function ReportsPage() {
  const { role } = useRole()
  const navigate = useNavigate()
  const { period, setPeriod, custom, setCustom, range } = usePeriod()
  const data = useReportsData(role, range)
  const { store, loaded, loadError } = data
  const computed = useMemo(() => computeReports(store, range), [store, range])

  const openInvoice = (inv: Invoice) => navigate(`/invoice?open=${encodeURIComponent(inv.id)}`)
  const common = { store, computed, navigate, openInvoice }

  if (role === 'admin') return <AdminReports {...common} candidates={data.candidates} loaded={loaded} loadError={loadError} />
  if (role === 'accounting') return <AccountingReports {...common} loaded={loaded} loadError={loadError} />
  if (role === 'recruiter') return <RecruiterReports store={store} candidates={data.candidates} navigate={navigate} />
  if (role === 'lead_gen') return <LeadGenReports store={store} navigate={navigate} />
  return <CeoReports {...common} role={role} data={data} range={range} period={period} setPeriod={setPeriod} custom={custom} setCustom={setCustom} />
}

type Nav = ReturnType<typeof useNavigate>
type Common = { store: DataSnapshot; computed: ReportsResult; navigate: Nav; openInvoice: (inv: Invoice) => void }

const thisMonth = () => todayIso().slice(0, 7)
const statusOverdue = (inv: Invoice) => (inv.status || '').toLowerCase() === 'overdue'
const statusDraft = (inv: Invoice) => (inv.status || '').toLowerCase() === 'draft'
const sentPendingOf = (invoices: Invoice[]) => invoices.filter(inv => ['sent', 'viewed', 'partial'].includes((inv.status || '').toLowerCase()))
const paidThisMonthOf = (invoices: Invoice[]) => invoices.filter(inv => (inv.status || '').toLowerCase() === 'paid' && (inv.date || inv.billingEnd || '').startsWith(thisMonth()))

/** Overdue / drafts / contracts / anniversaries, as the old role dashboards listed them */
function basicAttention(store: DataSnapshot, navigate: Nav, withAnniversaries: boolean): AttnItem[] {
  const overdue = store.invoices.filter(statusOverdue)
  const drafts = store.invoices.filter(statusDraft)
  const items: AttnItem[] = []
  if (overdue.length) items.push({ key: 'overdue', tone: 'danger', title: plural(overdue.length, 'overdue invoice'), meta: 'Update status in Invoices', action: 'Open', onAction: () => navigate('/invoice') })
  if (drafts.length) items.push({ key: 'drafts', tone: 'warning', title: plural(drafts.length, 'draft invoice'), meta: 'Ready to send to clients', action: 'Review', onAction: () => navigate('/invoice') })
  for (const c of expiringContracts(store.clients, todayIso())) items.push({ key: `c-${c.id}`, tone: c.daysLeft <= 14 ? 'warning' : 'muted', title: `Contract expiring — ${c.name}`, meta: c.daysLeft === 0 ? 'Expires today' : `${plural(c.daysLeft, 'day')} left (${c.contractEnd})`, action: 'View', onAction: () => navigate(`/clients/${c.id}`) })
  if (withAnniversaries) for (const a of anniversaries(store.employees)) items.push({ key: `a-${a.id}`, tone: 'muted', title: `${a.name} — ${plural(a.years, 'year')}`, meta: `${plural(a.years, 'year')} with YVA Staffing`, action: 'View', onAction: () => navigate(`/employees/${a.id}`) })
  return sortAttention(items)
}

function LoadState({ loaded, loadError }: { loaded: boolean; loadError: string | null }) {
  if (loadError) return <Banner tone="danger">Couldn't load the dashboard data: {loadError}</Banner>
  if (!loaded) return <div className="kpi-strip">{[0, 1, 2, 3].map(i => <div key={i} className="kpi-cell"><Skel w="50%" h={12} /><Skel w="70%" h={24} /></div>)}</div>
  return null
}

/* ── CEO: the full finance view ───────────────────────────────────── */

function CeoReports({ store, computed, navigate, openInvoice, role, data, range, period, setPeriod, custom, setCustom }: Common & {
  role: AppRole; data: ReturnType<typeof useReportsData>; range: DateRange; period: Period; setPeriod: (p: Period) => void; custom: DateRange; setCustom: (r: DateRange) => void
}) {
  const owner = can.viewOwnerStats(role)
  const [drill, setDrill] = useState<DrillKind | null>(null)
  const [filling, setFilling] = useState(false)
  const toast = useToast()
  const today = todayIso()
  // Stripe fees in the period (only shown when the period has Stripe payments)
  const fees = owner && data.payments ? feeSummary(data.payments) : null
  const showFees = !!fees && fees.stripePayments > 0
  async function fillFees() {
    setFilling(true)
    try {
      const r = await fillMissingStripeFees({ from: range.from || undefined, to: range.to || undefined })
      const left = Number(r.missing) || (r.missing ? 100 : 0)
      if (r.filled > 0) toast.success(`Filled ${plural(r.filled, 'fee')} from Stripe.${left ? ` ${r.missing} still without a fee${r.waiting ? ' (Stripe hasn\'t settled some bank payments yet)' : ''}.` : ''}`)
      else if (r.waiting > 0) toast.info('Stripe hasn\'t worked out these fees yet (bank payments take a few days). Try again later.')
      else if (r.failed > 0) toast.error('Stripe didn\'t answer for these payments. Try again in a minute.')
      else toast.info('No missing fees.')
      data.reloadPayments()
    } catch (e) {
      toast.error(`Fees not filled: ${(e as Error).message}`)
    } finally { setFilling(false) }
  }
  const topClient = computed.byClient[0] ?? null
  const { total: totalExpenses } = expensesInRange(data.generalExpenses, range.from, range.to)
  const netAfterExpenses = computed.totalNetEarnings - totalExpenses

  const kpis: (Kpi | false)[] = [
    owner && { label: 'Total billed', value: formatMoney(computed.totalBilled), note: plural(computed.invoiceCount, 'invoice'), onClick: () => setDrill('billed') },
    owner && data.collected !== null && { label: 'Collected', value: data.collected === undefined ? '…' : formatMoney(data.collected), note: 'payments received', tone: 'success', onClick: () => setDrill('collected') },
    showFees && { label: 'Card & bank fees', value: formatMoney(fees!.fees), note: fees!.missing ? `${fees!.missing} not known yet` : 'kept by Stripe', tone: fees!.missing ? 'warning' : undefined, onClick: () => setDrill('fees') },
    showFees && { label: 'Received after fees', value: formatMoney(fees!.received), note: 'collected − fees', onClick: () => setDrill('fees') },
    { label: 'Total hours', value: fmtHoursHM(computed.totalHours), note: plural(computed.employeePerformance.length, 'person', 'people'), onClick: () => setDrill('hours') },
    owner && { label: 'Est. payroll', value: formatMoney(computed.totalPayroll), onClick: () => setDrill('payroll') },
    { label: 'Business expenses', value: formatMoney(totalExpenses), onClick: () => setDrill('expenses') },
    owner && { label: 'Net earnings', value: formatMoney(netAfterExpenses), note: `after ${formatMoney(totalExpenses)} expenses`, tone: netAfterExpenses < 0 ? 'danger' : undefined, onClick: () => setDrill('net') },
    { label: 'Paid', value: computed.paidCount, onClick: () => setDrill('paid') },
    { label: 'Unpaid', value: computed.unpaidCount, tone: computed.unpaidCount > 0 ? 'danger' : undefined, note: computed.unpaidCount > 0 ? 'in this period' : undefined, onClick: () => setDrill('unpaid') },
    { label: 'Top client', value: <span className="home-kpi-text">{topClient?.name || '—'}</span>, note: topClient ? formatMoney(topClient.total) : undefined, onClick: () => setDrill('topClient') },
    { label: 'Clients', value: store.clients.length, onClick: () => setDrill('clients') },
    { label: 'Team', value: store.employees.length, onClick: () => setDrill('team') },
  ]

  const aging = useMemo(() => arAging(store.invoices, today), [store.invoices, today])
  const forecast = useMemo(() => revenueForecast(store.invoices), [store.invoices])
  const atRisk = useMemo(() => retentionWatch(store.clients, store.invoices, today), [store.clients, store.invoices, today])
  const activeProjects = store.projects.filter(p => (p.status || '').toLowerCase() === 'active').length

  return (
    <div className="page home-reports">
      <PageHeader title="Reports" sub="Revenue, receivables, forecast and invoice history"
        actions={<PeriodControl period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />} />
      <LoadState loaded={data.loaded} loadError={data.loadError} />
      {data.loaded && <KpiStrip items={kpis.filter(Boolean) as Kpi[]} />}
      {data.loaded && showFees && (fees!.missing > 0
        ? <Banner tone="info" action={<button type="button" className="btn btn--sm" disabled={filling} onClick={() => void fillFees()}>{filling ? 'Filling…' : 'Fill missing fees'}</button>}>
            {plural(fees!.missing, 'Stripe payment')} in this period {fees!.missing === 1 ? "doesn't" : "don't"} show {fees!.missing === 1 ? 'its' : 'their'} fee yet, so card & bank fees may be higher. Stripe keeps its fee; refunds don't return it.
          </Banner>
        : <p className="home-fee-hint">Card & bank fees: Stripe keeps its fee from each payment; refunds don't return it.</p>)}

      {owner && (
        <div className="grid-auto">
          <Card title="Revenue by client" meta={`${dateShort(range.from)} – ${dateShort(range.to)}`}>
            <RTable rows={computed.byClient.slice(0, 8)} rowKey={r => r.name} size="sm" empty="No invoices in range." cols={[
              { label: 'Client', cell: r => r.name, strong: true },
              { label: 'Invoices', cell: r => r.invoiceCount, num: true },
              { label: 'Share', cell: r => `${Math.round(r.share * 100)}%`, num: true },
              { label: 'Total', cell: r => formatMoney(r.total), num: true, strong: true, phone: 'right' },
            ]} />
          </Card>
          <Card title="Revenue by project" meta={`${dateShort(range.from)} – ${dateShort(range.to)}`}>
            <RTable rows={computed.byProject.slice(0, 8)} rowKey={r => r.name} size="sm" empty="No invoices in range." cols={[
              { label: 'Project', cell: r => r.name, strong: true },
              { label: 'Hours', cell: r => r.hoursBilled.toFixed(1), num: true },
              { label: 'Total', cell: r => formatMoney(r.total), num: true, strong: true, phone: 'right' },
            ]} />
          </Card>
        </div>
      )}

      {aging.hasAging && (
        <Card title="Accounts receivable aging" meta={plural(aging.rows.length, 'unpaid invoice')}>
          <div className="home-aging">
            {aging.buckets.map(b => (
              <div key={b.label} className="home-aging__tile">
                <span className="home-aging__label">{b.label}</span>
                <span className={`home-aging__value num ${b.invoices.length ? `home-tone-${b.tone}` : 'soft'}`}>{formatMoney(b.total)}</span>
                <span className="home-aging__count">{plural(b.invoices.length, 'invoice')}</span>
              </div>
            ))}
          </div>
          <RTable rows={aging.rows} rowKey={r => r.inv.id} onRow={r => openInvoice(r.inv)} cols={[
            { label: 'Invoice #', cell: r => <span className="mono">{r.inv.number}</span>, strong: true, phone: 'title' },
            { label: 'Client', cell: r => r.inv.clientName || '—' },
            { label: 'Date', cell: r => r.inv.date || '—', phone: 'hide' },
            { label: 'Due', cell: r => r.inv.dueDate || '—' },
            { label: 'Age', cell: r => <span className={r.age > 60 ? 't-danger' : r.age > 30 ? 't-warning' : r.age > 0 ? 't-gold' : 'muted'}>{r.age > 0 ? `${r.age}d overdue` : 'Current'}</span> },
            { label: 'Balance', cell: r => formatMoney(r.balance), num: true, strong: true, phone: 'right' },
          ]} />
        </Card>
      )}

      <div className="grid-auto">
        <Card pad title="Revenue forecast">
          <div className="home-forecast">
            <span className="section-label">3-month average</span>
            <span className="home-forecast__value num">{formatMoney(forecast.average)}</span>
            <span className="muted">per month based on the last 3 months</span>
          </div>
          <div className="home-kv">
            {forecast.months.map(m => <div key={m.label} className="home-kv__row"><span className="muted">{m.label}</span><span className="num home-strong">{formatMoney(m.total)}</span></div>)}
            <div className="home-kv__row"><span className="muted">Active projects</span><span className="num home-strong">{activeProjects}</span></div>
          </div>
        </Card>
        <Card title="Client retention watch" meta={atRisk.length ? <span className="t-warning">{plural(atRisk.length, 'client')} not invoiced in 60+ days</span> : undefined}>
          <RTable rows={atRisk} rowKey={r => r.client.id} size="sm" empty="All active clients invoiced within 60 days." onRow={r => navigate(`/clients/${r.client.id}`)} cols={[
            { label: 'Client', cell: r => r.client.name, strong: true },
            { label: 'Status', cell: r => <Pill status={r.client.status || 'active'} /> },
            { label: 'Last invoice', cell: r => <span className="t-warning">{r.lastDate}{r.days !== null ? ` (${r.days}d ago)` : ''}</span> },
          ]} />
        </Card>
      </div>

      {computed.employeePerformance.length > 0 && (
        <Card title="Employee performance" meta="in range">
          <RTable rows={computed.employeePerformance} rowKey={e => e.name} size="lg" cols={[
            { label: 'Employee', cell: e => e.name, strong: true },
            { label: 'Hours', cell: e => fmtHoursHM(e.hours), num: true },
            { label: 'Billed', cell: e => formatMoney(e.billed), num: true, strong: true, phone: 'right' },
            ...(owner ? [
              { label: 'Payroll cost', cell: (e: typeof computed.employeePerformance[0]) => e.payroll > 0 ? formatMoney(e.payroll) : <span className="soft">—</span>, num: true },
              { label: 'Margin', cell: (e: typeof computed.employeePerformance[0]) => e.payroll > 0 ? <span className={e.margin >= 0 ? 't-success' : 't-danger'}>{formatMoney(e.margin)}</span> : <span className="soft">—</span>, num: true },
            ] : []),
            { label: 'Invoices', cell: e => e.invoiceCount, num: true },
          ]} />
        </Card>
      )}

      {computed.allTimeByClient.length > 0 && (
        <Card title="Client analytics" meta="all time">
          <RTable rows={computed.allTimeByClient} rowKey={c => c.name} cols={[
            { label: 'Client', cell: c => c.name, strong: true },
            { label: 'Projects', cell: c => c.projectCount, num: true },
            { label: 'Invoices', cell: c => c.invoiceCount, num: true },
            { label: 'Total billed', cell: c => formatMoney(c.total), num: true, strong: true, phone: 'right' },
            { label: 'Last invoice', cell: c => c.lastDate || '—' },
          ]} />
        </Card>
      )}

      {computed.allTimeByProject.length > 0 && (
        <Card title="Project analytics" meta="all time">
          <RTable rows={computed.allTimeByProject} rowKey={p => p.name} size="lg" cols={[
            { label: 'Project', cell: p => p.name, strong: true },
            { label: 'Client', cell: p => p.client || '—' },
            { label: 'Invoices', cell: p => p.invoiceCount, num: true },
            { label: 'Total billed', cell: p => formatMoney(p.total), num: true, strong: true, phone: 'right' },
            { label: 'Hours', cell: p => fmtHoursHM(p.hours), num: true },
            { label: 'Last invoice', cell: p => p.lastDate || '—' },
          ]} />
        </Card>
      )}

      {computed.insights.length > 0 && (
        <Card pad title="Insights">
          <ul className="home-insights">{computed.insights.map(t => <li key={t}>{t}</li>)}</ul>
        </Card>
      )}

      <InvoiceHistory store={store} owner={owner} usdToDop={data.settings.usdToDop || 0} openInvoice={openInvoice} />

      <KpiDrillModal kind={drill} onClose={() => setDrill(null)} ctx={{ store, computed, range, generalExpenses: data.generalExpenses, payments: data.payments }} />
    </div>
  )
}

function InvoiceHistory({ store, owner, usdToDop, openInvoice }: { store: DataSnapshot; owner: boolean; usdToDop: number; openInvoice: (inv: Invoice) => void }) {
  const [hClient, setHClient] = useState('')
  const [hProject, setHProject] = useState('')
  const [hStatus, setHStatus] = useState('')
  const [hFrom, setHFrom] = useState('')
  const [hTo, setHTo] = useState('')
  const allProjects = useMemo(() => [...new Set(store.invoices.map(i => i.projectName || '').filter(Boolean))], [store.invoices])
  const rows = useMemo(() => filterInvoiceHistory(store.invoices, { client: hClient, project: hProject, status: hStatus, from: hFrom, to: hTo }), [store.invoices, hClient, hProject, hStatus, hFrom, hTo])
  const total = rows.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
  const y = new Date().getFullYear()
  const month = makeCurrentMonthRange()

  return (
    <Card title="Invoice history" className="home-history" actions={
      <div className="home-history__actions">
        <button type="button" className="btn btn--sm" onClick={() => { setHFrom(month.from); setHTo(month.to) }}>This month</button>
        <button type="button" className="btn btn--sm" onClick={() => { setHFrom(`${y}-01-01`); setHTo(`${y}-12-31`) }}>This year</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setHFrom(''); setHTo(''); setHClient(''); setHProject(''); setHStatus('') }}>Clear</button>
        <button type="button" className="btn btn--sm" onClick={() => { downloadCSV('invoice-history.csv', invoiceHistoryCsvRows(rows)); void logAction('export', `Exported invoice history CSV (${rows.length} invoices)`) }}>Export CSV</button>
        {owner && <button type="button" className="btn btn--sm" onClick={() => { downloadCSV('payroll-export.csv', payrollCsvRows(rows, store.employees, usdToDop)); void logAction('export', `Exported payroll CSV (${rows.length} invoices)`, { table: 'payroll_runs' }) }}>Payroll CSV</button>}
      </div>
    }>
      <div className="home-filters">
        <SearchInput value={hClient} onChange={setHClient} placeholder="Search client…" />
        <select className="select select--sm" aria-label="Project" value={hProject} onChange={e => setHProject(e.target.value)}>
          <option value="">All projects</option>
          {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="select select--sm" aria-label="Status" value={hStatus} onChange={e => setHStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="viewed">Viewed</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="overdue">Overdue</option>
        </select>
        <div className="home-filters__dates">
          <input className="input input--sm" type="date" aria-label="History from" value={hFrom} onChange={e => setHFrom(e.target.value)} />
          <span className="muted">–</span>
          <input className="input input--sm" type="date" aria-label="History to" value={hTo} onChange={e => setHTo(e.target.value)} />
        </div>
        <span className="home-filters__total">{plural(rows.length, 'invoice')} · <strong className="num">{formatMoney(total)}</strong></span>
      </div>
      <RTable rows={rows.slice(0, 200)} rowKey={i => i.id} size="lg" empty="No invoices match the current filters." onRow={openInvoice} cols={[
        { label: 'Invoice #', cell: i => <span className="mono">{i.number}</span>, strong: true, phone: 'title' },
        { label: 'Date', cell: i => i.date || '—' },
        { label: 'Due date', cell: i => i.dueDate || '—', phone: 'hide' },
        { label: 'Client', cell: i => i.clientName || '—' },
        { label: 'Project', cell: i => i.projectName || '—', phone: 'hide' },
        { label: 'Status', cell: i => <Pill status={i.status || 'draft'} /> },
        { label: 'Hours', cell: i => { const h = invoiceHours(i); return h > 0 ? fmtHoursHM(h) : '—' }, num: true, phone: 'hide' },
        { label: 'Amount', cell: i => formatMoney(Number(i.subtotal) || 0), num: true, strong: true, phone: 'right' },
      ]} />
    </Card>
  )
}

/* ── Admin ────────────────────────────────────────────────────────── */

function AdminReports({ store, navigate, openInvoice, candidates, loaded, loadError }: Common & { candidates: Candidate[]; loaded: boolean; loadError: string | null }) {
  const activeProjects = store.projects.filter(p => (p.status || '').toLowerCase() === 'active').length
  const inPipeline = candidates.filter(c => !['hired', 'rejected'].includes(c.stage))
  const overdue = store.invoices.filter(statusOverdue)
  const drafts = store.invoices.filter(statusDraft)
  const open = store.invoices.filter(inv => (inv.status || 'draft') !== 'paid').sort((a, b) => ((a.dueDate || a.date || '') < (b.dueDate || b.date || '') ? -1 : 1))
  const month = thisMonth()
  const kpis: Kpi[] = [
    { label: 'Active projects', value: activeProjects, onClick: () => navigate('/projects') },
    { label: 'Team members', value: store.employees.length, onClick: () => navigate('/employees') },
    { label: 'Total clients', value: store.clients.length, onClick: () => navigate('/clients') },
    { label: 'Open candidates', value: inPipeline.length, onClick: () => navigate('/candidates') },
    { label: 'Draft invoices', value: drafts.length, tone: drafts.length ? 'warning' : undefined, note: drafts.length ? 'ready to send' : undefined, onClick: () => navigate('/invoice') },
    { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'danger' : undefined, note: overdue.length ? 'needs a reminder' : undefined, onClick: () => navigate('/invoice') },
    { label: 'Sent / pending', value: sentPendingOf(store.invoices).length },
    { label: 'Paid this month', value: paidThisMonthOf(store.invoices).length },
  ]
  return (
    <div className="page home-reports">
      <PageHeader title="Reports" sub="Operations overview" />
      <LoadState loaded={loaded} loadError={loadError} />
      {loaded && <KpiStrip items={kpis} />}
      <div className="grid-auto">
        <div className="home-col">
          <Card title="Invoice status — open">
            <RTable rows={open.slice(0, 10)} rowKey={i => i.id} empty="All invoices paid." onRow={openInvoice} cols={[
              { label: 'Invoice #', cell: i => <span className="mono">{i.number}</span>, strong: true, phone: 'title' },
              { label: 'Client', cell: i => i.clientName || '—' },
              { label: 'Project', cell: i => i.projectName || '—', phone: 'hide' },
              { label: 'Due date', cell: i => i.dueDate || i.date || '—' },
              { label: 'Status', cell: i => <Pill status={i.status || 'draft'} /> },
            ]} />
          </Card>
          <CandidatePipelineCard candidates={candidates} onOpen={() => navigate('/candidates')} />
        </div>
        <AttentionList items={basicAttention(store, navigate, true)} loading={!loaded} />
      </div>
      {store.employees.length > 0 && (
        <Card title="Team capacity">
          <RTable rows={store.employees} rowKey={e => e.id} size="lg" onRow={e => navigate(`/employees/${e.id}`)} cols={[
            { label: 'Employee', cell: e => e.name, strong: true },
            { label: 'Role', cell: e => e.role || '—' },
            { label: 'Status', cell: e => <Pill status={e.status || 'active'} /> },
            { label: 'Assigned projects', cell: e => store.projects.filter(p => (p.employeeIds || []).includes(e.id)).map(p => p.name).join(', ') || '—' },
            { label: 'Hours this month', num: true, phone: 'right', cell: e => {
              const h = store.invoices.filter(inv => (inv.date || inv.billingEnd || '').startsWith(month)).flatMap(inv => inv.items || [])
                .filter(it => it.employeeName?.toLowerCase() === e.name.toLowerCase()).reduce((s, it) => s + (Number(it.hoursTotal) || 0), 0)
              return h > 0 ? fmtHoursHM(h) : '—'
            } },
          ]} />
        </Card>
      )}
    </div>
  )
}

/* ── Accounting ───────────────────────────────────────────────────── */

function AccountingReports({ store, navigate, openInvoice, loaded, loadError }: Common & { loaded: boolean; loadError: string | null }) {
  const overdue = store.invoices.filter(statusOverdue)
  const drafts = store.invoices.filter(statusDraft)
  const outstanding = store.invoices.filter(inv => !['paid', 'draft'].includes((inv.status || 'draft').toLowerCase())).sort((a, b) => ((a.dueDate || a.date || '') < (b.dueDate || b.date || '') ? -1 : 1))
  const month = thisMonth()
  const statements = store.employees.map(emp => {
    const mine = (inv: Invoice) => (inv.items || []).some(it => it.employeeName?.toLowerCase() === emp.name.toLowerCase())
    const empInvs = store.invoices.filter(inv => (inv.date || inv.billingEnd || '').startsWith(month) && mine(inv))
    if (empInvs.length === 0) return null
    const hours = empInvs.flatMap(inv => inv.items || []).filter(it => it.employeeName?.toLowerCase() === emp.name.toLowerCase()).reduce((s, it) => s + (Number(it.hoursTotal) || 0), 0)
    const paid = empInvs.filter(inv => inv.employeePayments?.[emp.id]?.status === 'paid').length
    return { emp, hours, count: empInvs.length, paid, pending: empInvs.length - paid }
  }).filter((x): x is NonNullable<typeof x> => x !== null)
  const kpis: Kpi[] = [
    { label: 'Draft (to send)', value: drafts.length, tone: drafts.length ? 'warning' : undefined, note: drafts.length ? 'ready to send' : undefined, onClick: () => navigate('/invoice') },
    { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'danger' : undefined, note: overdue.length ? 'needs a reminder' : undefined, onClick: () => navigate('/invoice') },
    { label: 'Sent / pending', value: sentPendingOf(store.invoices).length },
    { label: 'Paid this month', value: paidThisMonthOf(store.invoices).length },
  ]
  const invCols: RCol<Invoice>[] = [
    { label: 'Invoice #', cell: i => <span className="mono">{i.number}</span>, strong: true, phone: 'title' },
    { label: 'Client', cell: i => i.clientName || '—' },
    { label: 'Project', cell: i => i.projectName || '—', phone: 'hide' },
    { label: 'Date', cell: i => i.date || '—' },
  ]
  return (
    <div className="page home-reports">
      <PageHeader title="Reports" sub="Invoice & billing overview" />
      <LoadState loaded={loaded} loadError={loadError} />
      {loaded && <KpiStrip items={kpis} />}
      <div className="grid-auto">
        <div className="home-col">
          <Card title="Outstanding invoices" meta={`${outstanding.length}`}>
            <RTable rows={outstanding} rowKey={i => i.id} size="lg" empty="No outstanding invoices." onRow={openInvoice} cols={[...invCols, { label: 'Due', cell: i => i.dueDate || '—' }, { label: 'Status', cell: i => <Pill status={i.status || 'draft'} /> }]} />
          </Card>
          {drafts.length > 0 && (
            <Card title="Drafts to send" meta={`${drafts.length}`}>
              <RTable rows={drafts} rowKey={i => i.id} onRow={openInvoice} cols={invCols} />
            </Card>
          )}
          <Card title="Employee statements this month">
            <RTable rows={statements} rowKey={s => s.emp.id} empty="No employee hours logged this month." onRow={s => navigate(`/employees/${s.emp.id}`)} cols={[
              { label: 'Employee', cell: s => s.emp.name, strong: true },
              { label: 'Hours this month', cell: s => (s.hours > 0 ? fmtHoursHM(s.hours) : '—'), num: true, phone: 'right' },
              { label: 'Invoices', cell: s => s.count, num: true },
              { label: 'Payment status', cell: s => <span className="home-paystat">{s.paid > 0 && <Pill tone="success">{s.paid} paid</Pill>}{s.pending > 0 && <Pill tone="warning">{s.pending} pending</Pill>}</span> },
            ]} />
          </Card>
        </div>
        <AttentionList items={basicAttention(store, navigate, false)} loading={!loaded} />
      </div>
    </div>
  )
}

/* ── Recruiter / Lead gen (also shown on Home for those roles) ────── */

function RecruiterReports({ store, candidates, navigate }: { store: DataSnapshot; candidates: Candidate[]; navigate: Nav }) {
  const month = thisMonth()
  const hiring = store.projects.filter(p => (p.status || '').toLowerCase() === 'hiring')
  const hired = candidates.filter(c => { if (c.stage !== 'hired') return false; const d = new Date(c.updatedAt || 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month })
  const inPipeline = candidates.filter(c => !['hired', 'rejected'].includes(c.stage))
  return (
    <div className="page home-reports">
      <PageHeader title="Reports" sub="Recruiting pipeline overview" />
      <KpiStrip items={[
        { label: 'Total candidates', value: candidates.length, onClick: () => navigate('/candidates') },
        { label: 'In pipeline', value: inPipeline.length, onClick: () => navigate('/candidates') },
        { label: 'Hired this month', value: hired.length, tone: hired.length ? 'success' : undefined },
        { label: 'Hiring projects', value: hiring.length },
      ]} />
      <div className="grid-auto">
        <CandidatePipelineCard candidates={candidates} onOpen={() => navigate('/candidates')} />
        <HiringProjectsCard store={store} onOpen={id => navigate(`/projects/${id}`)} />
      </div>
    </div>
  )
}

function LeadGenReports({ store, navigate }: { store: DataSnapshot; navigate: Nav }) {
  const today = todayIso()
  const expiring = expiringContracts(store.clients, today)
  const risk = retentionWatch(store.clients, store.invoices, today, { includeNeverInvoiced: true })
  const activeClients = new Set(store.invoices.filter(i => (i.date || '').startsWith(thisMonth())).map(i => i.clientName)).size
  return (
    <div className="page home-reports">
      <PageHeader title="Reports" sub="Client pipeline & retention" />
      <KpiStrip items={[
        { label: 'Total clients', value: store.clients.length, onClick: () => navigate('/clients') },
        { label: 'Active this month', value: activeClients },
        { label: 'Contracts expiring', value: expiring.length, tone: expiring.length ? 'warning' : undefined },
        { label: 'Retention alerts', value: risk.length, tone: risk.length ? 'danger' : undefined },
      ]} />
      <div className="grid-auto">
        <ContractsCard store={store} onOpen={id => navigate(`/clients/${id}`)} />
        <RetentionRiskCard store={store} onOpen={id => navigate(`/clients/${id}`)} />
      </div>
    </div>
  )
}
