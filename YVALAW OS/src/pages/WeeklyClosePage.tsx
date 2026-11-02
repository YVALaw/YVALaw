// Finance → Weekly close (PLAN.md Step 4; redesign 2026-11 → designs/Weekly Close.dc.html).
// Review the week, fix time, approve, send. The week-close function prepares/approves; rows are read here (RLS weekly_close.manage).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AppSettings, Employee, Invoice, Project } from '../data/types'
import { loadEmployees, loadProjects, loadSettings } from '../services/storage'
import { usePermission } from '../context/RoleContext'
import { invoiceHtmlFor, sendInvoiceEmail, sentToLabel } from '../services/invoiceEmail'
import { isGmailConnected } from '../services/gmail'
import RecordPaymentModal from '../components/RecordPaymentModal'
import WeekTimeGrid, { type Editing, type GridTarget } from '../components/finance/WeekTimeGrid'
import { Banner, EmptyState, KpiStrip, PageHeader, Pill, Stepper, type Tone } from '../components/ui'
import { Ic, P } from '../components/Icon'
import {
  addAdjustment, callWeekClose, cancelAdjustment, lastFinishedWeek, loadAdjustments, loadWeekBlocks, loadWeekCloses, loadWeekInvoices,
  markInvoiceSent, moveToNextWeek, type Adjustment, type WeekBlock, type WeekClose, type WeekFlag,
} from '../services/weeklyClose'
import { addDays, DEFAULT_TZ, localParts } from '../utils/moneyRules'
import { hmClock, hmText as hm } from '../utils/format'

const usd = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const md = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const rangeLabel = (a: string) => {
  const b = addDays(a, 6)
  return new Date(`${a}T12:00:00`).getMonth() === new Date(`${b}T12:00:00`).getMonth() ? `${md(a)} – ${new Date(`${b}T12:00:00`).getDate()}` : `${md(a)} – ${md(b)}`
}
const FLAG_LABEL: Record<string, string> = {
  missing_rate: 'Missing rate', project_no_client: 'No client', client_no_email: 'No email', invoice_locked: 'Already sent', late: 'Late time',
  manual_pending: 'Waiting request', no_time: 'No time', over_50h: 'Over 50 h', low_activity: 'Low activity', outside_shift: 'Outside shift', missing_screenshots: 'Screenshots',
}
/** Pill colours per flag kind (mockup: Missing rate red · Late / Over 50h amber · Low activity orange · No time grey · Locked indigo · Outside shift violet) */
const FLAG_TONE: Record<string, Tone> = {
  missing_rate: 'danger', project_no_client: 'danger', client_no_email: 'neutral', invoice_locked: 'sent', late: 'warning', manual_pending: 'info',
  no_time: 'neutral', over_50h: 'warning', low_activity: 'partial', outside_shift: 'viewed', missing_screenshots: 'partial',
}

/** Finance → Weekly close: review the week, fix time, approve, send (PLAN.md Step 4) */
export default function WeeklyClosePage() {
  const allowed = usePermission()
  const navigate = useNavigate()
  const [closes, setCloses] = useState<WeekClose[]>([])
  const [weekStart, setWeekStart] = useState(lastFinishedWeek())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [blocks, setBlocks] = useState<WeekBlock[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [showTime, setShowTime] = useState(false)
  const [allPay, setAllPay] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // The week in progress can be previewed (nothing saved); it closes for real on Monday 12:05 am
  const thisWeek = addDays(lastFinishedWeek(), 7)
  const isCurrent = weekStart === thisWeek
  const [previewData, setPreviewData] = useState<{ close: WeekClose; invoices: Invoice[] } | null>(null)
  const close = isCurrent ? previewData?.close ?? null : closes.find(c => c.weekStart === weekStart) ?? null
  async function loadAll() {
    const r = await loadWeekCloses()
    setCloses(r.rows); setError(e => r.error ?? e)
    const c = r.rows.find(x => x.weekStart === weekStart)
    const [inv, b, a] = await Promise.all([c ? loadWeekInvoices(c.id) : Promise.resolve([]), loadWeekBlocks(weekStart), loadAdjustments(weekStart)])
    setInvoices(inv); setBlocks(b); setAdjustments(a); setLoaded(true)
  }
  useEffect(() => { void loadEmployees().then(setEmployees); void loadProjects().then(setProjects); void loadSettings().then(setSettings) }, [])
  useEffect(() => { setPreviewData(null); setOpen(new Set()); void loadAll() }, [weekStart])   // eslint-disable-line react-hooks/exhaustive-deps
  // First draft opens by default (mockup), once per week
  useEffect(() => { if (invoices[0] && open.size === 0) setOpen(new Set([invoices[0].id])) }, [invoices])   // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: 'prepare' | 'approve') {
    setBusy(action); setMsg(null); setError(null)
    if (isCurrent) {
      try {
        const r = await callWeekClose('preview', weekStart) as { summary: WeekClose['summary']; flags: WeekFlag[]; payroll: WeekClose['payroll']
          invoices: { clientName: string; projectName: string; subtotal: number; items: Invoice['items'] }[] }
        setPreviewData({
          close: { id: 'preview', weekStart, weekEnd: addDays(weekStart, 6), status: 'ready', preparedAt: new Date().toISOString(), approvedAt: null, summary: r.summary, flags: r.flags, payroll: r.payroll },
          invoices: r.invoices.map((inv, i) => ({ id: `preview-${i}`, number: '(not created yet)', clientName: inv.clientName, projectName: inv.projectName, subtotal: inv.subtotal, items: inv.items, status: 'draft' } as unknown as Invoice)),
        })
        await loadAll()
      } catch (e) { setError((e as Error).message) }
      setBusy(null)
      return
    }
    try {
      await callWeekClose(action, weekStart)
      setMsg(action === 'prepare' ? 'Prepared — invoices and flags are up to date.' : 'Week approved. Hours are final; invoices are ready to send.')
      await loadAll()
    } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  /** 'sent' only when Gmail delivered it; 'mailto' = handed to the mail app, which we can't confirm */
  const sentTo = new Map<string, string>()   // invoice id → "to (cc …)" of its last send, for the message
  async function send(inv: Invoice): Promise<'sent' | 'mailto' | 'failed'> {
    if (!settings) return 'failed'
    if (!inv.clientEmail) { setError(`${inv.number}: ${inv.clientName} has no email address. Add it on the client's profile and prepare again.`); return 'failed' }
    const r = await sendInvoiceEmail(inv, settings)
    if (r.mode === 'failed') { setError(`${inv.number} was not sent: ${r.fallbackReason}`); return 'failed' }
    sentTo.set(inv.id, sentToLabel(r))
    if (r.mode !== 'gmail') return 'mailto'
    await markInvoiceSent(inv)
    return 'sent'
  }
  async function sendOne(inv: Invoice) {
    setBusy(`send-${inv.id}`); setError(null); setMsg(null)
    try {
      const r = await send(inv)
      if (r === 'sent') setMsg(`${inv.number} sent to ${sentTo.get(inv.id) ?? inv.clientEmail}.`)
      else if (r === 'mailto' && window.confirm(`${inv.number} was opened in your email app. Mark it as sent? Only say OK once you have actually sent the email.`)) {
        await markInvoiceSent(inv)
        setMsg(`${inv.number} marked as sent.`)
      }
    } catch (e) { setError((e as Error).message) }
    await loadAll(); setBusy(null)
  }
  async function sendAll() {
    const drafts = invoices.filter(i => (i.status || 'draft') === 'draft')
    const gmailReady = await isGmailConnected().catch(() => false)
    if (!gmailReady) {
      setError('"Send all" needs Gmail connected (Settings → Integrations). Without it, send the invoices one at a time with each row\'s Send button.')
      return
    }
    if (!window.confirm(`Email ${drafts.length} invoice${drafts.length === 1 ? '' : 's'} to the clients now?`)) return
    setBusy('send-all'); setError(null); setMsg(null)
    let ok = 0
    let stopped = false
    for (const inv of drafts) {
      try {
        const r = await send(inv)
        if (r === 'sent') ok++
        // Gmail dropped mid-run and the user chose the mail app: stop instead of opening one mail window per invoice
        if (r === 'mailto') { stopped = true; break }
      } catch (e) { setError((e as Error).message) }
    }
    setMsg(stopped
      ? `${ok} of ${drafts.length} invoices sent through Gmail. Stopped: Gmail isn't sending, so the rest were not sent — reconnect Gmail (Settings → Integrations) or send them one at a time. The invoice opened in your email app is still a draft; use its Send button to mark it sent.`
      : `${ok} of ${drafts.length} invoices sent.`)
    await loadAll(); setBusy(null)
  }
  function preview(inv: Invoice) {
    if (!settings) return
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(invoiceHtmlFor(inv, settings)); w.document.close()
  }

  // ── Time grid: person → target → day seconds (tracked + adjustments)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const tz = DEFAULT_TZ
  const empName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown'
  const projName = (id: string | null) => (id ? projects.find(p => p.id === id)?.name ?? 'Project' : '')
  const grid = useMemo(() => {
    const m = new Map<string, Map<string, GridTarget>>()
    const row = (emp: string, projectId: string | null, workType: string | null) => {
      const key = projectId ? `p:${projectId}` : `w:${workType || 'Other'}`
      if (!m.has(emp)) m.set(emp, new Map())
      const em = m.get(emp)!
      if (!em.has(key)) em.set(key, { projectId, workType, tracked: {}, adj: {} })
      return em.get(key)!
    }
    for (const b of blocks) { const r = row(b.employee_id, b.project_id, b.work_type); const d = localParts(Date.parse(b.block_start), tz).date; r.tracked[d] = (r.tracked[d] || 0) + b.seconds }
    for (const a of adjustments) if (a.status === 'applied' && a.day <= days[6]) { const r = row(a.employee_id, a.project_id, a.work_type); r.adj[a.day] = (r.adj[a.day] || 0) + a.seconds_delta }
    return m
  }, [blocks, adjustments, weekStart])   // eslint-disable-line react-hooks/exhaustive-deps
  const lateCount = close?.summary.firstPreparedAt ? blocks.filter(b => Date.parse(b.created_at) > Date.parse(close.preparedAt || close.summary.firstPreparedAt!)).length : 0

  async function saveAdjustment(editing: Editing, minutes: string, note: string, target: GridTarget | undefined): Promise<boolean> {
    // Accept "-15", "−15" (the hint's minus sign), "+30" and a comma decimal
    const mins = Number(minutes.trim().replace(/[−–]/g, '-').replace(',', '.'))
    if (!mins || note.trim().length < 2) { setError('Enter minutes (use − to remove time) and a short note — the employee will see it.'); return false }
    try {
      const args = { employeeId: editing.employeeId, projectId: target?.projectId ?? null, workType: target?.workType ?? null, day: editing.day, seconds: Math.abs(mins) * 60 * (editing.mode === 'move' ? 1 : Math.sign(mins)), note }
      if (editing.mode === 'move') await moveToNextWeek({ ...args, weekStart })
      else await addAdjustment(args)
      setError(null); setMsg('Saved. Press "Re-prepare" to update the invoices.')
      setAdjustments(await loadAdjustments(weekStart))
      return true
    } catch (e) { setError((e as Error).message); return false }
  }
  async function moveLate(f: WeekFlag) {
    if (!f.employeeId || !f.byDay) return
    if (!window.confirm(`Move ${hm(f.seconds || 0)} of ${f.employeeName}'s late time to next week?`)) return
    try {
      for (const [day, sec] of Object.entries(f.byDay)) await moveToNextWeek({ employeeId: f.employeeId, projectId: f.projectId ?? null, workType: f.workType ?? null, day, seconds: sec, note: 'Uploaded after the week closed — moved to next week', weekStart })
      setMsg('Moved. Press "Re-prepare" to update the invoices.'); setAdjustments(await loadAdjustments(weekStart))
    } catch (e) { setError((e as Error).message) }
  }

  // After every hook: permissions arrive asynchronously for non-CEO roles, so an earlier return changes the hook count
  if (!allowed('weekly_close.manage')) {
    return <div className="page"><PageHeader title="Weekly close" /><EmptyState>The weekly close needs the "Run the weekly close" permission (Settings → Team Access → Permissions).</EmptyState></div>
  }

  const s = close?.summary ?? {}
  const shown = isCurrent ? previewData?.invoices ?? [] : invoices
  const drafts = isCurrent ? [] : invoices.filter(i => (i.status || 'draft') === 'draft')
  const canSend = allowed('invoices.send')
  const latest = lastFinishedWeek()

  // Three-step status: Preparing → Ready to review → Approved
  const idx = isCurrent ? 0 : !close ? 0 : close.status === 'approved' ? 2 : close.status === 'ready' ? 1 : 0
  const preparedAt = close?.preparedAt ? new Date(close.preparedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const steps = [
    { label: 'Preparing', sub: isCurrent ? 'Week in progress' : close ? `Prepared ${preparedAt ?? ''}` : 'Mon 12:05 am · not prepared yet' },
    { label: 'Ready to review', sub: 'Check flags and drafts' },
    { label: 'Approved', sub: close?.approvedAt ? `Approved ${new Date(close.approvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Hours locked into time entries' },
  ]
  const stepDone = (i: number) => (!isCurrent && close) ? (i < idx || idx === 2) : false

  function flagAction(f: WeekFlag): { label: string; onClick: () => void } | null {
    switch (f.kind) {
      case 'late': return f.employeeId && f.byDay ? { label: 'Move to next week', onClick: () => void moveLate(f) } : null
      case 'missing_rate': return { label: 'Set rate', onClick: () => navigate(f.projectId ? `/projects/${f.projectId}` : '/projects') }
      case 'project_no_client': return f.projectId ? { label: 'Fix project', onClick: () => navigate(`/projects/${f.projectId}?edit=1`) } : null
      case 'client_no_email': return f.clientId ? { label: 'Add email', onClick: () => navigate(`/clients/${f.clientId}`) } : null
      case 'over_50h': case 'manual_pending': return { label: 'Review', onClick: () => navigate('/time?tab=approve') }
      case 'outside_shift': case 'no_time': return { label: 'Schedule', onClick: () => navigate('/time?tab=schedule') }
      case 'low_activity': case 'missing_screenshots':
        return { label: 'Screenshots', onClick: () => navigate(`/time?tab=screens${f.employeeId ? `&employee=${f.employeeId}` : ''}${f.days?.[0] ? `&day=${f.days[0]}` : ''}`) }
      default: return null
    }
  }
  const flagMeta = (f: WeekFlag) => [f.employeeName && !f.message.includes(f.employeeName) ? f.employeeName : '', f.projectId ? projName(f.projectId) : f.workType || '', f.seconds ? hm(f.seconds) : ''].filter(Boolean).join(' · ')

  const invoiceStatus = (inv: Invoice) => {
    const st = (inv.status || 'draft').toLowerCase()
    return st === 'draft' ? <Pill status="draft" /> : st === 'sent' ? <Pill tone="warning">Sent · locked</Pill> : <Pill status={st} />
  }
  const payRows = close?.payroll ?? []
  const payShown = allPay ? payRows : payRows.slice(0, 5)
  const payRest = payRows.slice(5)

  return (
    <div className="page">
      <PageHeader title="Weekly close"
        sub="Approved hours become one draft invoice per client. Prepares automatically every Monday at 12:05 am."
        actions={<>
          <div className="fin-stepper">
            <Stepper label={isCurrent ? `${md(weekStart)} – today` : rangeLabel(weekStart)} prevLabel="Previous week" nextLabel="Next week"
              onPrev={() => setWeekStart(addDays(weekStart, -7))} onNext={() => setWeekStart(isCurrent ? weekStart : addDays(weekStart, 7) > latest ? latest : addDays(weekStart, 7))}
              nextDisabled={isCurrent || weekStart >= latest} />
          </div>
          <button type="button" className={`btn${isCurrent ? ' btn--primary' : ''}`} aria-pressed={isCurrent} onClick={() => setWeekStart(isCurrent ? latest : thisWeek)}>This week so far</button>
        </>} />

      {isCurrent && <Banner tone="info">Preview of the week in progress ({md(weekStart)} – today). Computed live, nothing is saved: no invoices are created and nothing can be approved or sent. The week closes automatically on Monday at 12:05 am (Dominican time).</Banner>}
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      {msg && <Banner tone="success" onClose={() => setMsg(null)}>{msg}</Banner>}
      {lateCount > 0 && !isCurrent && <Banner tone="warning" action={<button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => void run('prepare')}>Re-prepare</button>}>
        {lateCount} block{lateCount === 1 ? '' : 's'} of time arrived after this week was prepared.</Banner>}

      <section className="card fin-wc-status">
        <ol className="fin-steps">
          {steps.map((st, i) => {
            const done = stepDone(i)
            const current = !done && i === idx
            return (
              <li key={st.label} className={`fin-step${done ? ' fin-step--done' : current ? ' fin-step--current' : ''}`}>
                <span className="fin-step__mark">{done ? <Ic d={P.check} size={14} stroke={3} /> : i + 1}</span>
                <span className="fin-step__text"><span className="fin-step__label">{st.label}</span><span className="fin-step__sub">{st.sub}</span></span>
                {i < 2 && <span className="fin-step__line" aria-hidden />}
              </li>
            )
          })}
        </ol>
        <div className="fin-wc-status__actions">
          <button type="button" className="btn" disabled={!!busy} onClick={() => void run('prepare')}>
            {busy === 'prepare' ? (isCurrent ? 'Loading…' : 'Preparing…') : isCurrent ? (close ? 'Refresh preview' : 'Preview this week') : close ? 'Re-prepare' : 'Prepare this week'}
          </button>
          {close && !isCurrent && (close.status === 'approved'
            ? <span className="btn fin-approved" aria-disabled="true"><Ic d={P.check} size={14} stroke={2.6} /> Week approved</span>
            : <button type="button" className="btn btn--gold" disabled={!!busy} onClick={() => void run('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve week'}</button>)}
        </div>
      </section>

      {!close ? (
        <EmptyState>{!loaded ? 'Loading…' : isCurrent
          ? <>Press <strong>Preview this week</strong> to see the invoices, flags and payroll so far.</>
          : <>This week hasn't been prepared. It happens automatically every Monday at 12:05 am (Dominican time), or press <strong>Prepare this week</strong>.</>}</EmptyState>
      ) : (
        <>
          <KpiStrip compact items={[
            { label: 'Hours', value: hm(s.billableSeconds || 0), note: `${s.people || 0} people tracked` },
            { label: 'Draft invoices', value: String(isCurrent ? shown.length : drafts.length), note: `${s.invoices || 0} client${s.invoices === 1 ? '' : 's'}` },
            { label: 'To bill', value: usd(s.total || 0) },
            { label: 'Payroll preview', value: usd(s.payrollTotal || 0), note: "paid on each project's schedule" },
            { label: 'Flags', value: <span className={close.flags.length ? 't-warning' : 't-success'}>{close.flags.length}</span>, note: 'flags never block anything' },
          ]} />

          <section className="card fin-wc-drafts">
            <div className="card__head">
              <h2 className="card__title">{isCurrent ? 'Invoices so far' : 'Draft invoices'}</h2>
              {drafts.length > 0 && canSend && <button type="button" className="btn btn--sm" disabled={!!busy} onClick={() => void sendAll()}>{busy === 'send-all' ? 'Sending…' : `Send all ready (${drafts.length})`}</button>}
            </div>
            {shown.length === 0 && <div className="card-empty">No billable client time this week.</div>}
            {shown.map(inv => {
              const items = inv.items || []
              const hours = items.reduce((x, it) => x + (Number(it.hoursTotal) || 0), 0)
              const isOpen = open.has(inv.id)
              const amount = Number(inv.subtotal) || 0
              return (
                <div key={inv.id} className={`fin-wc-inv${isOpen ? ' fin-wc-inv--open' : ''}`} data-invoice={inv.number}>
                  <button type="button" className="fin-wc-inv__row" aria-expanded={isOpen} onClick={() => setOpen(o => { const n = new Set(o); if (n.has(inv.id)) n.delete(inv.id); else n.add(inv.id); return n })}>
                    <Ic d={isOpen ? P.chevD : P.chevR} size={14} />
                    <span className="fin-wc-inv__client"><span className="t-strong">{inv.clientName}</span><span className="t-sub">{inv.projectName ? `${inv.projectName} · ` : ''}{items.length} line{items.length === 1 ? '' : 's'}</span></span>
                    <span className="fin-wc-inv__num mono">{inv.number}</span>
                    <span className="fin-wc-inv__hours">{hm(hours * 3600)}</span>
                    <span className="fin-wc-inv__amt num">{amount ? usd(amount) : 'Needs rate'}</span>
                    <span className="fin-wc-inv__status">{invoiceStatus(inv)}</span>
                  </button>
                  {isOpen && (
                    <div className="fin-wc-inv__detail">
                      <div className="fin-wc-lines">
                        <table className="fin-wc-lines__table">
                          <thead><tr><th>Employee</th><th>Project</th><th>Hours</th><th>Rate</th><th className="t-right">Amount</th></tr></thead>
                          <tbody>
                            {items.map((it, i) => {
                              const premium = /premium/i.test(it.position || '')
                              return (
                                <tr key={i}>
                                  <td>{it.employeeName}</td>
                                  <td className={premium ? 'fin-premium' : 'muted'}>{it.position || inv.projectName || '—'}</td>
                                  <td className="mono">{hmClock((Number(it.hoursTotal) || 0) * 3600)}</td>
                                  <td>{Number(it.rate) ? usd(Number(it.rate)) : <span className="t-danger">— missing</span>}</td>
                                  <td className="t-right fin-strong">{usd((Number(it.hoursTotal) || 0) * (Number(it.rate) || 0))}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      {!isCurrent && (
                        <div className="fin-wc-inv__actions">
                          <button type="button" className="btn btn--sm" onClick={() => navigate(`/invoice?edit=${encodeURIComponent(inv.id)}`)}>Open in builder</button>
                          <button type="button" className="btn btn--sm" onClick={() => preview(inv)}>Preview</button>
                          {(inv.status || 'draft') === 'draft' && canSend && <button type="button" className="btn btn--sm btn--primary" disabled={!!busy} onClick={() => void sendOne(inv)}>{busy === `send-${inv.id}` ? 'Sending…' : 'Send invoice'}</button>}
                          {inv.status && inv.status !== 'draft' && <button type="button" className="btn btn--sm" onClick={() => setPaying(inv)}>Payments</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          <div className="fin-wc-grid">
            <section className="card fin-wc-flags">
              <div className="card__head"><h2 className="card__title">Flags</h2><span className="card__meta">{close.flags.length} to check</span></div>
              {close.flags.length === 0 && <div className="card-empty">Nothing to check this week.</div>}
              {close.flags.map((f, i) => {
                const act = flagAction(f)
                const meta = flagMeta(f)
                return (
                  <div key={i} className="fin-flag">
                    <Pill tone={FLAG_TONE[f.kind] ?? 'warning'} className="fin-flag__kind">{FLAG_LABEL[f.kind] ?? f.kind}</Pill>
                    <span className="fin-flag__text"><span className="fin-flag__title">{f.message}</span>{meta && <span className="fin-flag__meta">{meta}</span>}</span>
                    {act && <button type="button" className="btn btn--xs fin-flag__btn" onClick={act.onClick}>{act.label}</button>}
                  </div>
                )
              })}
            </section>

            <section className="card fin-wc-pay">
              <div className="card__head fin-wc-pay__head"><h2 className="card__title">Payroll preview</h2><span className="card__meta">What these hours add to Friday's payroll</span></div>
              {payRows.length === 0 && <div className="card-empty">No pay for these hours.</div>}
              {payShown.map(p => (
                <div key={p.employeeId} className="fin-pay-row">
                  <span>{p.employeeName} <span className="muted">· {hm(p.seconds)}{p.premiumSeconds ? ` (${hm(p.premiumSeconds)} night)` : ''}</span>{p.missingRate && <Pill tone="danger" className="fin-pay-row__pill">No pay rate</Pill>}</span>
                  <span className="fin-strong num">{usd(p.amount)}</span>
                </div>
              ))}
              {!allPay && payRest.length > 0 && (
                <button type="button" className="fin-pay-row fin-pay-row--more" onClick={() => setAllPay(true)}>
                  <span>+ {payRest.length} more <span className="muted">· {hm(payRest.reduce((x, p) => x + p.seconds, 0))}</span></span>
                  <span className="fin-strong num">{usd(payRest.reduce((x, p) => x + p.amount, 0))}</span>
                </button>
              )}
              {payRows.length > 0 && <div className="fin-pay-row fin-pay-row--total"><span>Total</span><span className="num">{usd(s.payrollTotal || 0)}</span></div>}
              <button type="button" className="fin-card-link" onClick={() => navigate('/payroll')}>Open payroll →</button>
            </section>
          </div>

          <section className="card fin-wc-time">
            <div className="card__head">
              <div className="fin-wc-time__title"><h2 className="card__title">Time by person</h2>
                <span className="card__meta">Tap a day to add or remove minutes, or move time to next week. Employees see every change with your note.</span></div>
              <button type="button" className="btn btn--sm" aria-expanded={showTime} onClick={() => setShowTime(v => !v)}>{showTime ? 'Hide time' : `Show time (${grid.size} ${grid.size === 1 ? 'person' : 'people'})`}</button>
            </div>
            {showTime && <div className="card__body"><WeekTimeGrid grid={grid} days={days} empName={empName} projName={projName} adjustments={adjustments}
              onSave={saveAdjustment} onUndo={a => void cancelAdjustment(a).then(async () => setAdjustments(await loadAdjustments(weekStart))).catch(e => setError(`Could not undo: ${(e as Error).message}`))} /></div>}
          </section>
        </>
      )}
      {paying && <RecordPaymentModal invoice={{ ...paying, subtotal: Number(paying.subtotal) || 0, clientId: paying.clientId ?? null }}
        onClose={() => setPaying(null)} onChanged={() => void loadAll()} />}
    </div>
  )
}
