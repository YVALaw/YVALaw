import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, Employee, Invoice, Project } from '../data/types'
import { loadEmployees, loadProjects, loadSettings } from '../services/storage'
import { usePermission } from '../context/RoleContext'
import { invoiceHtmlFor, sendInvoiceEmail } from '../services/invoiceEmail'
import RecordPaymentModal from '../components/RecordPaymentModal'
import {
  addAdjustment, callWeekClose, cancelAdjustment, lastFinishedWeek, loadAdjustments, loadWeekBlocks, loadWeekCloses, loadWeekInvoices,
  markInvoiceSent, moveToNextWeek, type Adjustment, type WeekBlock, type WeekClose, type WeekFlag,
} from '../services/weeklyClose'
import { addDays, DEFAULT_TZ, localParts } from '../utils/moneyRules'

type Tab = 'summary' | 'invoices' | 'time' | 'flags' | 'payroll'
const usd = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const hm = (s: number) => { const neg = s < 0; const m = Math.round(Math.abs(s) / 60); return `${neg ? '−' : ''}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
const rangeLabel = (a: string) => `${new Date(`${a}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(`${addDays(a, 6)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
const FLAG_LABEL: Record<string, string> = {
  missing_rate: 'Missing rate', project_no_client: 'No client', client_no_email: 'No email', invoice_locked: 'Already sent', late: 'Late time',
  manual_pending: 'Waiting request', no_time: 'No time', over_50h: 'Over 50 h', low_activity: 'Low activity', outside_shift: 'Outside shift', missing_screenshots: 'Screenshots',
}

/** Finance → Weekly close: review the week, fix time, approve, send (PLAN.md Step 4) */
export default function WeeklyClosePage() {
  const allowed = usePermission()
  const [closes, setCloses] = useState<WeekClose[]>([])
  const [weekStart, setWeekStart] = useState(lastFinishedWeek())
  const [tab, setTab] = useState<Tab>('summary')
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
  const [editing, setEditing] = useState<{ employeeId: string; target: string; day: string; mode: 'edit' | 'move' } | null>(null)
  const [adjForm, setAdjForm] = useState({ minutes: '', note: '' })

  const close = closes.find(c => c.weekStart === weekStart) ?? null
  async function loadAll() {
    const r = await loadWeekCloses()
    setCloses(r.rows); setError(r.error)
    const c = r.rows.find(x => x.weekStart === weekStart)
    const [inv, b, a] = await Promise.all([c ? loadWeekInvoices(c.id) : Promise.resolve([]), loadWeekBlocks(weekStart), loadAdjustments(weekStart)])
    setInvoices(inv); setBlocks(b); setAdjustments(a)
  }
  useEffect(() => { void loadEmployees().then(setEmployees); void loadProjects().then(setProjects); void loadSettings().then(setSettings) }, [])
  useEffect(() => { void loadAll() }, [weekStart])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!allowed('weekly_close.manage')) {
    return <div className="page-wrap"><div className="data-card" style={{ color: 'var(--muted)' }}>The weekly close needs the "Run the weekly close" permission (Settings → Team Access → Permissions).</div></div>
  }

  async function run(action: 'prepare' | 'approve') {
    setBusy(action); setMsg(null); setError(null)
    try {
      await callWeekClose(action, weekStart)
      setMsg(action === 'prepare' ? 'Prepared — invoices and flags are up to date.' : 'Week approved. Hours are final; invoices are ready to send.')
      await loadAll()
    } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  async function send(inv: Invoice) {
    if (!settings) return false
    if (!inv.clientEmail) { setError(`${inv.number}: ${inv.clientName} has no email address. Add it on the client's profile and prepare again.`); return false }
    const r = await sendInvoiceEmail(inv, settings)
    if (r.mode === 'failed') { setError(`${inv.number} was not sent: ${r.fallbackReason}`); return false }
    await markInvoiceSent(inv)
    return true
  }
  async function sendOne(inv: Invoice) {
    setBusy(`send-${inv.id}`); setError(null)
    try { if (await send(inv)) setMsg(`${inv.number} sent to ${inv.clientEmail}.`) } catch (e) { setError((e as Error).message) }
    await loadAll(); setBusy(null)
  }
  async function sendAll() {
    const drafts = invoices.filter(i => (i.status || 'draft') === 'draft')
    if (!window.confirm(`Email ${drafts.length} invoice${drafts.length === 1 ? '' : 's'} to the clients now?`)) return
    setBusy('send-all'); setError(null)
    let ok = 0
    for (const inv of drafts) { try { if (await send(inv)) ok++ } catch (e) { setError((e as Error).message) } }
    setMsg(`${ok} of ${drafts.length} invoices sent.`)
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
    const m = new Map<string, Map<string, { projectId: string | null; workType: string | null; tracked: Record<string, number>; adj: Record<string, number> }>>()
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

  async function saveAdjustment() {
    if (!editing) return
    const mins = Number(adjForm.minutes.replace(',', '.'))
    if (!mins || adjForm.note.trim().length < 2) { setError('Enter minutes (use − to remove time) and a short note — the employee will see it.'); return }
    const target = grid.get(editing.employeeId)?.get(editing.target)
    try {
      const args = { employeeId: editing.employeeId, projectId: target?.projectId ?? null, workType: target?.workType ?? null, day: editing.day, seconds: Math.abs(mins) * 60 * (editing.mode === 'move' ? 1 : Math.sign(mins)), note: adjForm.note }
      if (editing.mode === 'move') await moveToNextWeek({ ...args, weekStart })
      else await addAdjustment(args)
      setEditing(null); setAdjForm({ minutes: '', note: '' })
      setMsg('Saved. Press "Prepare again" to update the invoices.')
      setAdjustments(await loadAdjustments(weekStart))
    } catch (e) { setError((e as Error).message) }
  }
  async function moveLate(f: WeekFlag) {
    if (!f.employeeId || !f.byDay) return
    if (!window.confirm(`Move ${hm(f.seconds || 0)} of ${f.employeeName}'s late time to next week?`)) return
    try {
      for (const [day, sec] of Object.entries(f.byDay)) await moveToNextWeek({ employeeId: f.employeeId, projectId: f.projectId ?? null, workType: f.workType ?? null, day, seconds: sec, note: 'Uploaded after the week closed — moved to next week', weekStart })
      setMsg('Moved. Press "Prepare again" to update the invoices.'); setAdjustments(await loadAdjustments(weekStart))
    } catch (e) { setError((e as Error).message) }
  }

  const s = close?.summary ?? {}
  const drafts = invoices.filter(i => (i.status || 'draft') === 'draft')
  const weekOptions = [...new Set([lastFinishedWeek(), ...closes.map(c => c.weekStart)])].sort().reverse()

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Weekly close</h1>
          <p className="page-sub">{rangeLabel(weekStart)} · {close ? (close.status === 'approved' ? 'Approved' : 'Ready for review') : 'Not prepared yet'}{close?.preparedAt ? ` · prepared ${new Date(close.preparedAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</p>
        </div>
        <div className="page-header-actions" style={{ flexWrap: 'wrap' }}>
          <select className="form-select" aria-label="Week" value={weekStart} onChange={e => setWeekStart(e.target.value)} style={{ width: 'auto' }}>
            {weekOptions.map(w => <option key={w} value={w}>{rangeLabel(w)}</option>)}
          </select>
          <button className="btn-ghost" disabled={!!busy} onClick={() => void run('prepare')}>{busy === 'prepare' ? 'Preparing…' : close ? 'Prepare again' : 'Prepare this week'}</button>
          {close && close.status !== 'approved' && <button className="btn-primary" disabled={!!busy} onClick={() => void run('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve week'}</button>}
          {close && drafts.length > 0 && allowed('invoices.send') && <button className="btn-primary" disabled={!!busy} onClick={() => void sendAll()}>{busy === 'send-all' ? 'Sending…' : `Send all (${drafts.length})`}</button>}
        </div>
      </div>

      {error && <div className="portal-message portal-message-error" style={{ marginBottom: 12 }}>{error}</div>}
      {msg && <div className="portal-message" style={{ marginBottom: 12, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 10, padding: '10px 14px' }}>{msg}</div>}
      {lateCount > 0 && <div className="data-card" style={{ borderLeft: '4px solid #d97706', marginBottom: 12, fontSize: 14 }}>{lateCount} block{lateCount === 1 ? '' : 's'} of time arrived after this week was prepared. <button className="btn-ghost btn-sm" onClick={() => void run('prepare')}>Prepare again</button></div>}

      {!close ? (
        <div className="data-card" style={{ fontSize: 14, color: 'var(--muted)' }}>
          This week hasn't been prepared. It happens automatically every Monday at 12:05 am (Dominican time), or press <strong>Prepare this week</strong>.
        </div>
      ) : (
        <>
          <div className="filter-tabs" style={{ marginBottom: 14 }}>
            {(['summary', 'invoices', 'time', 'flags', 'payroll'] as Tab[]).map(t => (
              <button key={t} className={`filter-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {t === 'summary' ? 'Summary' : t === 'invoices' ? `Invoices (${invoices.length})` : t === 'time' ? 'Time' : t === 'flags' ? `Flags (${close.flags.length})` : 'Payroll preview'}
              </button>
            ))}
          </div>

          {tab === 'summary' && (
            <div className="kpi-grid">
              <div className="kpi-card clickable-card" onClick={() => setTab('invoices')}><div className="kpi-label">Invoices</div><div className="kpi-value">{usd(s.total || 0)}</div><div className="kpi-label">{s.invoices || 0} client{s.invoices === 1 ? '' : 's'} · {drafts.length} to send</div></div>
              <div className="kpi-card clickable-card" onClick={() => setTab('time')}><div className="kpi-label">Billable hours</div><div className="kpi-value">{hm(s.billableSeconds || 0)}</div><div className="kpi-label">{s.people || 0} people tracked</div></div>
              <div className="kpi-card clickable-card" onClick={() => setTab('payroll')}><div className="kpi-label">Payroll for these hours</div><div className="kpi-value">{usd(s.payrollTotal || 0)}</div><div className="kpi-label">paid on each project's schedule</div></div>
              <div className="kpi-card clickable-card" onClick={() => setTab('flags')}><div className="kpi-label">Things to check</div><div className="kpi-value" style={{ color: close.flags.length ? '#b45309' : undefined }}>{close.flags.length}</div><div className="kpi-label">flags never block anything</div></div>
            </div>
          )}

          {tab === 'invoices' && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Invoice</th><th>Client</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {invoices.map(inv => {
                    const hours = (inv.items || []).reduce((x, it) => x + (Number(it.hoursTotal) || 0), 0)
                    return (
                      <tr key={inv.id}>
                        <td className="td-name">{inv.number}</td>
                        <td>{inv.clientName}<div className="td-muted" style={{ fontSize: 12 }}>{inv.projectName}</div></td>
                        <td style={{ textAlign: 'right' }}>{hm(hours * 3600)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{usd(Number(inv.subtotal) || 0)}</td>
                        <td><span className={`badge ${inv.status === 'paid' ? 'badge-green' : inv.status === 'partial' ? 'badge-orange' : inv.status === 'sent' ? 'badge-blue' : 'badge-gray'}`}>{inv.status || 'draft'}</span></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn-ghost btn-sm" onClick={() => preview(inv)}>Preview</button>
                          {(inv.status || 'draft') === 'draft' && allowed('invoices.send') && <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} disabled={!!busy} onClick={() => void sendOne(inv)}>{busy === `send-${inv.id}` ? 'Sending…' : 'Send'}</button>}
                          {inv.status && inv.status !== 'draft' && <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setPaying(inv)}>Payments</button>}
                        </td>
                      </tr>
                    )
                  })}
                  {invoices.length === 0 && <tr><td colSpan={6} className="td-muted">No billable client time this week.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'time' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Tap a day to add or remove minutes, or move time to next week. Employees see every change with your note.</div>
              {[...grid.entries()].sort((a, b) => empName(a[0]).localeCompare(empName(b[0]))).map(([emp, targets]) => (
                <div key={emp} className="data-card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{empName(emp)}</div>
                  <div className="table-wrap">
                    <table className="data-table week-grid">
                      <thead><tr><th>Working on</th>{days.map(d => <th key={d} style={{ textAlign: 'center' }}>{dayLabel(d)}</th>)}<th style={{ textAlign: 'right' }}>Week</th></tr></thead>
                      <tbody>
                        {[...targets.entries()].map(([key, t]) => {
                          const total = days.reduce((x, d) => x + (t.tracked[d] || 0) + (t.adj[d] || 0), 0)
                          return (
                            <tr key={key}>
                              <td className="td-name">{t.projectId ? projName(t.projectId) : t.workType}</td>
                              {days.map(d => {
                                const sec = (t.tracked[d] || 0) + (t.adj[d] || 0)
                                return (
                                  <td key={d} style={{ textAlign: 'center' }}>
                                    <button className="week-cell" onClick={() => { setEditing({ employeeId: emp, target: key, day: d, mode: 'edit' }); setAdjForm({ minutes: '', note: '' }) }}
                                      title="Adjust this day">
                                      {sec ? hm(sec) : '—'}{t.adj[d] ? <span className="week-adj">{t.adj[d] > 0 ? '+' : ''}{hm(t.adj[d])}</span> : null}
                                    </button>
                                  </td>
                                )
                              })}
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>{hm(total)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {editing?.employeeId === emp && (
                    <div style={{ marginTop: 10, padding: 12, background: 'var(--surf2)', borderRadius: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <strong style={{ width: '100%' }}>{dayLabel(editing.day)} · {(() => { const t = targets.get(editing.target); return t?.projectId ? projName(t.projectId) : t?.workType })()}</strong>
                      <select aria-label="Change" className="form-select" style={{ width: 'auto' }} value={editing.mode} onChange={e => setEditing({ ...editing, mode: e.target.value as 'edit' | 'move' })}>
                        <option value="edit">Add / remove minutes</option>
                        <option value="move">Move to next week</option>
                      </select>
                      <input aria-label="Minutes" className="form-input" style={{ width: 110 }} inputMode="decimal" placeholder={editing.mode === 'move' ? 'minutes' : '+30 or −15'} value={adjForm.minutes} onChange={e => setAdjForm(f => ({ ...f, minutes: e.target.value }))} />
                      <input aria-label="Note for the employee" className="form-input" style={{ flex: 1, minWidth: 180 }} placeholder="Note the employee will see" value={adjForm.note} onChange={e => setAdjForm(f => ({ ...f, note: e.target.value }))} />
                      <button className="btn-primary btn-sm" onClick={() => void saveAdjustment()}>Save</button>
                      <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  )}
                  {adjustments.filter(a => a.employee_id === emp && a.status === 'applied' && a.kind !== 'defer_in').map(a => (
                    <div key={a.id} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>{dayLabel(a.day)}: {a.kind === 'defer_out' ? `moved ${hm(-a.seconds_delta)} to next week` : `${a.seconds_delta > 0 ? '+' : ''}${hm(a.seconds_delta)}`} — {a.note}</span>
                      <button className="notif-link" onClick={() => void cancelAdjustment(a).then(async () => setAdjustments(await loadAdjustments(weekStart)))}>Undo</button>
                    </div>
                  ))}
                </div>
              ))}
              {grid.size === 0 && <div className="data-card td-muted">No tracked time this week.</div>}
            </div>
          )}

          {tab === 'flags' && (
            <div className="data-card" style={{ padding: 0 }}>
              {close.flags.length === 0 && <div style={{ padding: 16, color: 'var(--muted)' }}>Nothing to check this week.</div>}
              {close.flags.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <span className={`badge ${['missing_rate', 'invoice_locked', 'project_no_client'].includes(f.kind) ? 'badge-red' : 'badge-orange'}`} style={{ minWidth: 92, justifyContent: 'center' }}>{FLAG_LABEL[f.kind] ?? f.kind}</span>
                  <span style={{ fontSize: 14, flex: 1, minWidth: 200 }}>{f.message}</span>
                  {f.kind === 'late' && <button className="btn-ghost btn-sm" onClick={() => void moveLate(f)}>Move to next week</button>}
                </div>
              ))}
            </div>
          )}

          {tab === 'payroll' && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Person</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Night</th><th style={{ textAlign: 'right' }}>Pay (USD)</th></tr></thead>
                <tbody>
                  {close.payroll.map(p => (
                    <tr key={p.employeeId}>
                      <td className="td-name">{p.employeeName}{p.missingRate && <span className="badge badge-red" style={{ marginLeft: 6 }}>No pay rate</span>}</td>
                      <td style={{ textAlign: 'right' }}>{hm(p.seconds)}</td>
                      <td style={{ textAlign: 'right' }} className="td-muted">{p.premiumSeconds ? hm(p.premiumSeconds) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{usd(p.amount)}</td>
                    </tr>
                  ))}
                  <tr><td className="td-name">Total</td><td /><td /><td style={{ textAlign: 'right', fontWeight: 800 }}>{usd(s.payrollTotal || 0)}</td></tr>
                </tbody>
              </table>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>Preview only — people are paid on their project's schedule in Payroll.</div>
            </div>
          )}
        </>
      )}
      {paying && <RecordPaymentModal invoice={{ ...paying, subtotal: Number(paying.subtotal) || 0, clientId: (paying as Invoice & { clientId?: string }).clientId ?? null }}
        onClose={() => setPaying(null)} onChanged={() => void loadAll()} />}
    </div>
  )
}
