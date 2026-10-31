import { useEffect, useMemo, useState } from 'react'
import type { Employee } from '../data/types'
import { loadEmployees, loadSettings } from '../services/storage'
import { usePermission } from '../context/RoleContext'
import {
  addAdjustment, cancelAdjustment, fetchBhdRate, loadAdjustments, loadLines, loadPayoutMethods, loadRuns, markPaid, preparePayroll, setExchangeRate, unmarkPaid,
  type PayoutMethod, type PayrollAdjustment, type PayrollLine, type PayrollRun,
} from '../services/payroll'
import { openPayslip } from '../utils/payslipHtml'
import { addDays, localParts, weekdayOf } from '../utils/moneyRules'

const usd = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const dop = (n: number) => `RD$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hm = (s: number) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const friday = (d: string) => addDays(d, (5 - weekdayOf(d) + 7) % 7)
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** Finance → Payroll: the Friday payroll (PLAN.md Step 6) */
export default function PayrollPage() {
  const allowed = usePermission()
  const canManage = allowed('payroll.manage')
  const canBank = allowed('bank.view')
  const today = localParts(Date.now()).date
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [payday, setPayday] = useState(friday(today))
  const [lines, setLines] = useState<PayrollLine[]>([])
  const [adjs, setAdjs] = useState<PayrollAdjustment[]>([])
  const [pending, setPending] = useState<PayrollAdjustment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [payouts, setPayouts] = useState<PayoutMethod[]>([])
  const [company, setCompany] = useState('YVA Staffing')
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [payForm, setPayForm] = useState<{ ids: string[]; paidOn: string; reference: string } | null>(null)
  const [adjForm, setAdjForm] = useState<{ employeeId: string; type: 'bonus' | 'deduction'; amount: string; reason: string; repeat: string } | null>(null)

  const run = runs.find(r => r.payday === payday) ?? null
  async function load() {
    const r = await loadRuns()
    setRuns(r.rows); setError(r.error)
    const cur = r.rows.find(x => x.payday === payday)
    setRateInput(cur?.exchange_rate ? String(cur.exchange_rate) : '')
    setLines(cur ? await loadLines(cur.id) : [])
    setAdjs(cur ? await loadAdjustments({ runId: cur.id }) : [])
    setPending(await loadAdjustments({ pendingOnly: true }))
    setSelected(new Set())
  }
  useEffect(() => {
    void loadEmployees().then(setEmployees)
    void loadSettings().then(s => setCompany(s.companyName || 'YVA Staffing'))
    if (canBank) void loadPayoutMethods().then(setPayouts).catch(e => setError(`Could not load payout details: ${(e as Error).message}`))
  }, [canBank])
  useEffect(() => { void load() }, [payday])   // eslint-disable-line react-hooks/exhaustive-deps

  const emp = (id: string) => employees.find(e => e.id === id)
  const payoutOf = (id: string) => payouts.find(p => p.employee_id === id)
  const groupOf = (id: string) => { const p = payoutOf(id); if (!canBank) return 'All'; if (!p) return 'No payout details'; if (p.method === 'paypal') return 'PayPal'; return p.bank_name === 'BHD' ? 'BHD' : 'Other DR banks' }
  const GROUPS = ['BHD', 'Other DR banks', 'PayPal', 'No payout details', 'All']
  const rate = Number(rateInput.replace(',', '.')) || run?.exchange_rate || 0
  const totals = useMemo(() => ({
    net: lines.reduce((s, l) => s + l.net_usd, 0),
    dop: lines.reduce((s, l) => s + (l.status === 'paid' && l.net_dop != null ? l.net_dop : l.net_usd * rate), 0),
    pending: lines.filter(l => l.status === 'pending').length,
    people: new Set(lines.map(l => l.employee_id)).size,
  }), [lines, rate])

  if (!allowed('payroll.view') && !canManage) {
    return <div className="page-wrap"><div className="data-card" style={{ color: 'var(--muted)' }}>Payroll needs the "See payroll" or "Run payroll" permission (Settings → Team Access → Permissions).</div></div>
  }

  async function act(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name); setError(null); setMsg(null)
    try { await fn(); if (ok) setMsg(ok); await load() } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  const prepare = () => act('prepare', () => preparePayroll(payday), 'Payroll prepared from approved hours.')
  async function bhd() {
    try { const r = await fetchBhdRate(); setRateInput(String(r.buy)); setMsg(`${r.entity}: buys USD at RD$${r.buy} (sells at RD$${r.sell}). Check it, then Save rate.`) } catch (e) { setError((e as Error).message) }
  }
  const saveRate = () => act('rate', () => setExchangeRate(run!.id, Number(rateInput.replace(',', '.')), 'manual'), 'Exchange rate saved.')
  function payslip(l: PayrollLine) {
    const e = emp(l.employee_id)
    openPayslip({ companyName: company, employeeName: e?.name ?? '', employeeNumber: e?.employeeNumber, label: l.label, periodStart: l.period_start, periodEnd: l.period_end,
      payday: l.payday, paidOn: l.paid_on, reference: l.reference, regularSeconds: l.regular_seconds, premiumSeconds: l.premium_seconds, payRate: l.pay_rate,
      rates: l.rates || [], premiumPercent: Number(l.premium_percent) || 0, grossUsd: l.gross_usd, netUsd: l.net_usd,
      // Paid line → the adjustments that were applied with it (as MyPayslips shows); unpaid preview → the ones still attached. Never cancelled ones.
      adjustments: l.adjustments_usd ? adjs.filter(a => a.employee_id === l.employee_id && a.status === (l.status === 'paid' ? 'applied' : 'pending')).map(a => ({ type: a.type, amount: a.amount, reason: a.reason })) : [],
      exchangeRate: l.exchange_rate ?? (rate || null), netDop: l.net_dop ?? (rate ? Math.round(l.net_usd * rate * 100) / 100 : null), payout: l.payout })
  }
  function paymentList(format: 'csv' | 'print') {
    const rows = lines.filter(l => l.status === 'pending' || selected.has(l.id))
    const byEmp = new Map<string, number>()
    for (const l of rows) byEmp.set(l.employee_id, (byEmp.get(l.employee_id) || 0) + l.net_usd)
    const list = [...byEmp.entries()].map(([id, net]) => ({ id, name: emp(id)?.name ?? '', p: payoutOf(id), net, group: groupOf(id) }))
      .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.name.localeCompare(b.name))
    if (format === 'csv') {
      const header = ['Group', 'Name', 'Method', 'Bank', 'Account type', 'Account number', 'Holder', 'ID (cédula)', 'PayPal', 'Amount USD', 'Amount DOP']
      const csv = [header, ...list.map(x => [x.group, x.name, x.p?.method ?? '', x.p?.bank_name ?? '', x.p?.account_type ?? '', x.p?.account_number ?? '', x.p?.holder_name ?? '', x.p?.holder_id ?? '', x.p?.paypal_email ?? '', x.net.toFixed(2), rate ? (x.net * rate).toFixed(2) : ''])]
        .map(r => r.map(csvCell).join(',')).join('\r\n')
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `payroll-${payday}-payment-list.csv`; a.click()
      return
    }
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment list ${esc(payday)}</title><style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}h2{margin:18px 0 6px}</style></head><body>
      <h1>Payment list — payday ${esc(payday)}</h1><div>Exchange rate: ${rate ? `RD$${rate}` : 'not set'}</div>
      ${GROUPS.filter(g => list.some(x => x.group === g)).map(g => `<h2>${esc(g)}</h2><table><tr><th>Name</th><th>Bank / PayPal</th><th>Account</th><th>Holder / ID</th><th>USD</th><th>DOP</th></tr>
        ${list.filter(x => x.group === g).map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.p?.method === 'paypal' ? 'PayPal' : x.p?.bank_name)}</td><td>${esc(x.p?.method === 'paypal' ? x.p?.paypal_email : `${x.p?.account_number ?? ''} ${x.p?.account_type ?? ''}`)}</td><td>${esc(x.p?.holder_name)} ${esc(x.p?.holder_id)}</td><td>$${x.net.toFixed(2)}</td><td>${rate ? `RD$${(x.net * rate).toFixed(2)}` : ''}</td></tr>`).join('')}</table>`).join('')}
      <script>window.onload=()=>window.print()</script></body></html>`)
    w.document.close()
  }

  const paydays = [...new Set([friday(today), addDays(friday(today), -7), ...runs.map(r => r.payday)])].sort().reverse()
  const groups = GROUPS.filter(g => lines.some(l => groupOf(l.employee_id) === g))

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Payroll</h1>
          <p className="page-sub">Payday {new Date(`${payday}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} · {run ? (run.status === 'paid' ? 'Paid' : `${totals.pending} to pay`) : 'not prepared'}</p>
        </div>
        <div className="page-header-actions" style={{ flexWrap: 'wrap' }}>
          <select aria-label="Payday" className="form-select" style={{ width: 'auto' }} value={payday} onChange={e => setPayday(e.target.value)}>
            {paydays.map(d => <option key={d} value={d}>{new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</option>)}
          </select>
          {canManage && <button className="btn-ghost" disabled={!!busy} onClick={() => void prepare()}>{busy === 'prepare' ? 'Preparing…' : run ? 'Prepare again' : 'Prepare payroll'}</button>}
          {canManage && <button className="btn-ghost" onClick={() => setAdjForm({ employeeId: employees[0]?.id ?? '', type: 'bonus', amount: '', reason: '', repeat: '1' })}>+ Bonus / deduction</button>}
        </div>
      </div>
      {error && <div className="portal-message portal-message-error" style={{ marginBottom: 12 }}>{error}</div>}
      {msg && <div style={{ marginBottom: 12, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 10, padding: '10px 14px', fontSize: 14 }}>{msg}</div>}

      {!run ? (
        <div className="data-card" style={{ fontSize: 14, color: 'var(--muted)' }}>This payroll isn't prepared yet. It's prepared automatically on Wednesday morning, or press <strong>Prepare payroll</strong>. Only approved hours are paid.</div>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 14 }}>
            <div className="kpi-card"><div className="kpi-label">People</div><div className="kpi-value">{totals.people}</div></div>
            <div className="kpi-card"><div className="kpi-label">Net pay (USD)</div><div className="kpi-value">{usd(totals.net)}</div></div>
            <div className="kpi-card"><div className="kpi-label">Net pay (DOP)</div><div className="kpi-value">{rate ? dop(totals.dop) : '—'}</div><div className="kpi-label">{rate ? `at RD$${rate}` : 'enter the rate'}</div></div>
            <div className="kpi-card">
              <div className="kpi-label">Exchange rate (USD → DOP)</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <input aria-label="Exchange rate" className="form-input form-input-sm" style={{ width: 96 }} inputMode="decimal" value={rateInput} disabled={!canManage || lines.some(l => l.status === 'paid')} onChange={e => setRateInput(e.target.value)} placeholder="60.50" />
                {canManage && !lines.some(l => l.status === 'paid') && <>
                  <button className="btn-ghost btn-sm" onClick={() => void bhd()}>BHD rate</button>
                  <button className="btn-primary btn-sm" disabled={!rateInput || busy === 'rate'} onClick={() => void saveRate()}>Save rate</button>
                </>}
              </div>
              {lines.some(l => l.status === 'paid') && <div className="kpi-label" style={{ marginTop: 4 }}>Locked — people are already paid</div>}
            </div>
          </div>

          {run.flags.length > 0 && (
            <div className="data-card" style={{ marginBottom: 14, borderLeft: '4px solid #d97706' }}>
              <div className="data-card-title">To check ({run.flags.length})</div>
              {run.flags.map((f, i) => <div key={i} style={{ fontSize: 13, padding: '3px 0' }}>• {f.message}</div>)}
            </div>
          )}

          {canManage && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <button className="btn-primary" disabled={totals.pending === 0} onClick={() => setPayForm({ ids: selected.size ? [...selected] : lines.filter(l => l.status === 'pending').map(l => l.id), paidOn: today, reference: '' })}>
                {selected.size ? `Mark ${selected.size} paid` : 'Mark all paid'}
              </button>
              {canBank && <button className="btn-ghost" onClick={() => paymentList('print')}>Payment list (print)</button>}
              {canBank && <button className="btn-ghost" onClick={() => paymentList('csv')}>Payment list (CSV)</button>}
            </div>
          )}

          {groups.map(g => (
            <div key={g} className="data-card" style={{ marginBottom: 12, padding: 0 }}>
              {g !== 'All' && <div className="data-card-title" style={{ padding: '12px 14px 0' }}>{g}</div>}
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr>{canManage && <th style={{ width: 28 }} />}<th>Person</th><th>Period</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Gross</th><th style={{ textAlign: 'right' }}>+/−</th><th style={{ textAlign: 'right' }}>Net USD</th><th style={{ textAlign: 'right' }}>Net DOP</th><th></th></tr></thead>
                  <tbody>
                    {lines.filter(l => groupOf(l.employee_id) === g).sort((a, b) => (emp(a.employee_id)?.name ?? '').localeCompare(emp(b.employee_id)?.name ?? '')).map(l => (
                      <tr key={l.id}>
                        {canManage && <td>{l.status === 'pending' && <input type="checkbox" aria-label={`Select ${emp(l.employee_id)?.name}`} checked={selected.has(l.id)} onChange={() => setSelected(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n })} />}</td>}
                        <td className="td-name" style={{ whiteSpace: 'nowrap' }}>{emp(l.employee_id)?.name ?? '—'}<div className="td-muted" style={{ fontSize: 12 }}>{l.label}</div></td>
                        <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{short(l.period_start)} – {short(l.period_end)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{hm(l.regular_seconds + l.premium_seconds)}{l.premium_seconds ? <div className="td-muted" style={{ fontSize: 11 }}>{hm(l.premium_seconds)} night</div> : null}</td>
                        <td style={{ textAlign: 'right' }}>{(l.rates || []).length > 1 ? 'Multiple' : l.pay_rate ? usd(l.pay_rate) : <span style={{ color: '#dc2626' }}>none</span>}</td>
                        <td style={{ textAlign: 'right' }}>{usd(l.gross_usd)}</td>
                        <td style={{ textAlign: 'right', color: l.adjustments_usd < 0 ? '#b45309' : l.adjustments_usd > 0 ? '#15803d' : 'var(--muted)' }}>{l.adjustments_usd ? usd(l.adjustments_usd) : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{usd(l.net_usd)}</td>
                        <td style={{ textAlign: 'right' }}>{l.status === 'paid' && l.net_dop != null ? dop(l.net_dop) : rate ? dop(l.net_usd * rate) : '—'}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {l.status === 'paid' ? <span className="badge badge-green">Paid {l.paid_on ? short(l.paid_on) : ''}</span> : <span className="badge badge-gray">To pay</span>}
                          <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => payslip(l)}>Payslip</button>
                          {canManage && l.status === 'paid' && <button className="notif-link" style={{ marginLeft: 6 }} onClick={() => { if (window.confirm('Undo "paid" for this line? Its bonuses/deductions go back to waiting.')) void act('unmark', () => unmarkPaid(l.id)) }}>Undo</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {lines.length === 0 && <div className="data-card td-muted">Nobody to pay on this payday (no approved hours whose pay period ends this week).</div>}
        </>
      )}

      {pending.length > 0 && (
        <div className="data-card" style={{ marginTop: 14 }}>
          <div className="data-card-title">Bonuses & deductions waiting for a payroll ({pending.length})</div>
          {pending.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <span className={`badge ${a.type === 'bonus' ? 'badge-green' : 'badge-orange'}`}>{a.type === 'bonus' ? 'Bonus' : 'Deduction'}</span>
              <strong>{usd(a.amount)}</strong><span>{emp(a.employee_id)?.name}</span><span className="td-muted">{a.reason}</span>
              {a.run_id && a.run_id === run?.id && <span className="badge badge-blue">on this payroll</span>}
              {canManage && <button className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void act('cancel', () => cancelAdjustment(a, a.total > 1 && window.confirm('Cancel the remaining repeats too?')), 'Cancelled.')}>Cancel</button>}
            </div>
          ))}
        </div>
      )}

      {payForm && (
        <div className="modal-overlay" onClick={() => setPayForm(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">Mark {payForm.ids.length} paid</div><button className="modal-close btn-icon" aria-label="Close" onClick={() => setPayForm(null)}>✕</button></div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!run?.exchange_rate && <div className="portal-message portal-message-error">Save the exchange rate first — DOP amounts are fixed when people are marked paid.</div>}
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Paid on</label><input aria-label="Paid on" className="form-input" type="date" value={payForm.paidOn} onChange={e => setPayForm({ ...payForm, paidOn: e.target.value })} /></div>
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Reference (optional)</label><input aria-label="Reference" className="form-input" value={payForm.reference} placeholder="e.g. BHD batch #" onChange={e => setPayForm({ ...payForm, reference: e.target.value })} /></div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>Each person gets a notification and can download their payslip in My workspace.</div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost btn-sm" onClick={() => setPayForm(null)}>Cancel</button>
              <button className="btn-primary btn-sm" disabled={!run?.exchange_rate || busy === 'pay'} onClick={() => { const f = payForm; setPayForm(null); void act('pay', async () => { const n = await markPaid(f.ids, f.paidOn, f.reference); setMsg(`${n} marked paid.`) }) }}>Mark paid</button>
            </div>
          </div>
        </div>
      )}

      {adjForm && (
        <div className="modal-overlay" onClick={() => setAdjForm(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">Bonus or deduction</div><button className="modal-close btn-icon" aria-label="Close" onClick={() => setAdjForm(null)}>✕</button></div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}><label className="form-label">Person</label>
                <select aria-label="Person" className="form-select" value={adjForm.employeeId} onChange={e => setAdjForm({ ...adjForm, employeeId: e.target.value })}>
                  {employees.filter(e => String(e.status || '').toLowerCase() !== 'inactive').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select></div>
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Type</label>
                <select aria-label="Type" className="form-select" value={adjForm.type} onChange={e => setAdjForm({ ...adjForm, type: e.target.value as 'bonus' | 'deduction' })}><option value="bonus">Bonus</option><option value="deduction">Deduction</option></select></div>
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Amount (USD)</label>
                <input aria-label="Amount (USD)" className="form-input" inputMode="decimal" value={adjForm.amount} onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })} /></div>
              <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}><label className="form-label">Reason (shown on the payslip)</label>
                <input aria-label="Reason" className="form-input" value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder="e.g. Referral bonus" /></div>
              <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}><label className="form-label">Repeat for the next … paydays</label>
                <input aria-label="Repeat" className="form-input" type="number" min={1} max={52} value={adjForm.repeat} onChange={e => setAdjForm({ ...adjForm, repeat: e.target.value })} />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>1 = only the next payroll. Each payroll uses one and it never comes back.</div></div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost btn-sm" onClick={() => setAdjForm(null)}>Cancel</button>
              <button className="btn-primary btn-sm" disabled={!adjForm.employeeId || !(Number(adjForm.amount.replace(',', '.')) > 0) || adjForm.reason.trim().length < 2}
                onClick={() => { const f = adjForm; setAdjForm(null); void act('adj', () => addAdjustment({ employeeId: f.employeeId, type: f.type, amount: Number(f.amount.replace(',', '.')), reason: f.reason, repeat: Number(f.repeat) }), 'Saved — it goes on the next payroll (press "Prepare again" if this one is open).') }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
