// Finance → Payroll: the Friday payroll (PLAN.md Step 6; redesign 2026-11 → designs/Payroll.dc.html).
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Employee } from '../data/types'
import { loadEmployees, loadSettings } from '../services/storage'
import { usePermission } from '../context/RoleContext'
import {
  addAdjustment, cancelAdjustment, fetchBhdRate, loadAdjustments, loadLines, loadPayoutMethods, loadRuns, markPaid, preparePayroll, setExchangeRate, unmarkPaid,
  type PayoutMethod, type PayrollAdjustment, type PayrollLine, type PayrollRun,
} from '../services/payroll'
import { openPayslip } from '../utils/payslipHtml'
import { addDays, localParts, weekdayOf } from '../utils/moneyRules'
import { Banner, Checkbox, EmptyState, Field, Menu, Modal, PageHeader, Pill, Stepper, useIsMobile } from '../components/ui'
import { P } from '../components/Icon'
import { hmClock } from '../utils/format'
import { useToast } from '../context/ToastContext'

const usd = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const signed = (n: number) => `${n < 0 ? '−' : '+'}${usd(Math.abs(n))}`
const dop = (n: number) => `RD$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hm = (s: number) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const friday = (d: string) => addDays(d, (5 - weekdayOf(d) + 7) % 7)
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const GROUPS = ['BHD', 'Other DR banks', 'PayPal', 'No payout details', 'All']

/** "BHD •• 4821" / "PayPal a•••@gmail.com" — never the full account on screen */
function maskPayout(p?: PayoutMethod | null, snap?: PayrollLine['payout']): string | null {
  if (p) {
    if (p.method === 'paypal') return `PayPal ${p.paypal_email ? `${p.paypal_email.slice(0, 1)}•••@${p.paypal_email.split('@')[1] ?? ''}` : ''}`.trim()
    return `${p.bank_name ?? 'Bank'}${p.account_number ? ` •• ${p.account_number.slice(-4)}` : ''}`
  }
  if (snap) return snap.method === 'paypal' ? `PayPal ${snap.paypal ?? ''}`.trim() : `${snap.bank ?? 'Bank'}${snap.account ? ` •• ${snap.account.replace(/[^0-9]/g, '').slice(-4)}` : ''}`
  return null
}

/** Finance → Payroll: the Friday payroll (PLAN.md Step 6) */
export default function PayrollPage() {
  const allowed = usePermission()
  const mobile = useIsMobile()
  const canManage = allowed('payroll.manage')
  const canBank = allowed('bank.view')
  const today = localParts(Date.now()).date
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [payday, setPayday] = useState(friday(today))
  // ?payday=YYYY-MM-DD (the Wednesday reminder, links): open that payday — also when this page is already open
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const d = params.get('payday')
    if (!d) return
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T12:00:00Z`))) setPayday(friday(d))
    setParams({}, { replace: true })
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps
  const [lines, setLines] = useState<PayrollLine[]>([])
  const [adjs, setAdjs] = useState<PayrollAdjustment[]>([])
  const [pending, setPending] = useState<PayrollAdjustment[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [payouts, setPayouts] = useState<PayoutMethod[]>([])
  const [company, setCompany] = useState('YVA Staffing')
  const [loadError, setLoadError] = useState<string | null>(null)   // could not load: stays as a banner
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [refInput, setRefInput] = useState('')
  const [payForm, setPayForm] = useState<{ ids: string[]; paidOn: string; reference: string } | null>(null)
  const [adjForm, setAdjForm] = useState<{ employeeId: string; type: 'bonus' | 'deduction'; amount: string; reason: string; repeat: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  const run = runs.find(r => r.payday === payday) ?? null
  async function load() {
    const r = await loadRuns()
    setRuns(r.rows); setLoadError(r.error)
    const cur = r.rows.find(x => x.payday === payday)
    setRateInput(cur?.exchange_rate ? String(cur.exchange_rate) : '')
    setLines(cur ? await loadLines(cur.id) : [])
    setAdjs(cur ? await loadAdjustments({ runId: cur.id }) : [])
    setPending(await loadAdjustments({ pendingOnly: true }))
    setSelected(new Set())
    setLoaded(true)
  }
  useEffect(() => {
    void loadEmployees().then(setEmployees)
    void loadSettings().then(s => setCompany(s.companyName || 'YVA Staffing'))
    if (canBank) void loadPayoutMethods().then(setPayouts).catch(e => setLoadError(`Could not load payout details: ${(e as Error).message}`))
  }, [canBank])
  useEffect(() => { void load() }, [payday])   // eslint-disable-line react-hooks/exhaustive-deps

  const emp = (id: string) => employees.find(e => e.id === id)
  const payoutOf = (id: string) => payouts.find(p => p.employee_id === id)
  const groupOf = (id: string) => { const p = payoutOf(id); if (!canBank) return 'All'; if (!p) return 'No payout details'; if (p.method === 'paypal') return 'PayPal'; return p.bank_name === 'BHD' ? 'BHD' : 'Other DR banks' }
  const rate = Number(rateInput.replace(',', '.')) || run?.exchange_rate || 0
  const totals = useMemo(() => ({
    gross: lines.reduce((s, l) => s + l.gross_usd, 0),
    net: lines.reduce((s, l) => s + l.net_usd, 0),
    dop: lines.reduce((s, l) => s + (l.status === 'paid' && l.net_dop != null ? l.net_dop : l.net_usd * rate), 0),
    pending: lines.filter(l => l.status === 'pending').length,
    paid: lines.filter(l => l.status === 'paid').length,
    people: new Set(lines.map(l => l.employee_id)).size,
  }), [lines, rate])

  if (!allowed('payroll.view') && !canManage) {
    return <div className="page"><PageHeader title="Payroll" /><EmptyState>Payroll needs the "See payroll" or "Run payroll" permission (Settings → Team Access → Permissions).</EmptyState></div>
  }

  async function act(name: string, fn: () => Promise<void>, ok?: string) {
    setBusy(name)
    try { await fn(); if (ok) toast.success(ok); await load() } catch (e) { toast.error((e as Error).message) }
    setBusy(null)
  }
  const prepare = () => act('prepare', () => preparePayroll(payday), 'Payroll prepared from approved hours.')
  async function bhd() {
    try { const r = await fetchBhdRate(); setRateInput(String(r.buy)); toast.success(`${r.entity}: buys USD at RD$${r.buy} (sells at RD$${r.sell}). Check it, then Save rate.`) } catch (e) { toast.error((e as Error).message) }
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

  const latestPayday = [friday(today), ...runs.map(r => r.payday)].sort().pop()!
  const groups = GROUPS.filter(g => lines.some(l => groupOf(l.employee_id) === g))
  const locked = lines.some(l => l.status === 'paid')
  const flaggedIds = new Set((run?.flags || []).map(f => f.employeeId).filter(Boolean) as string[])
  const selLines = lines.filter(l => selected.has(l.id))
  const selDop = selLines.reduce((s, l) => s + l.net_usd * rate, 0)
  const sortedIn = (g: string) => lines.filter(l => groupOf(l.employee_id) === g).sort((a, b) => (emp(a.employee_id)?.name ?? '').localeCompare(emp(b.employee_id)?.name ?? ''))
  const toggle = (l: PayrollLine) => { if (l.status !== 'pending' || !canManage) return; setSelected(s => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n }) }
  const openPay = (ids: string[]) => setPayForm({ ids, paidOn: today, reference: refInput })
  const statusPill = (l: PayrollLine) => l.status === 'paid' ? <Pill tone="success">Paid{l.paid_on ? ` ${short(l.paid_on)}` : ''}</Pill>
    : flaggedIds.has(l.employee_id) ? <Pill tone="warning">Check</Pill> : <Pill tone="neutral">To pay</Pill>
  const payoutCell = (l: PayrollLine) => {
    const m = canBank ? maskPayout(payoutOf(l.employee_id), l.payout) : maskPayout(null, l.payout)
    return m ? <span className="fin-payout">{m}</span> : canBank ? <span className="t-danger fin-payout">No payout method</span> : <span className="soft">—</span>
  }
  const lineMenu = (l: PayrollLine) => <Menu items={[
    { label: 'Payslip', icon: P.file, onClick: () => payslip(l) },
    { label: 'Undo paid', icon: P.refresh, hidden: !(canManage && l.status === 'paid'), onClick: () => { if (window.confirm('Undo "paid" for this line? Its bonuses/deductions go back to waiting.')) void act('unmark', () => unmarkPaid(l.id)) } },
  ]} buttonClass="btn btn--icon btn--xs fin-more" />
  const adjRows = [...pending, ...adjs.filter(a => a.status === 'applied' && !pending.some(p => p.id === a.id))]

  return (
    <div className="page">
      <PageHeader title="Payroll"
        sub={<>Paid Fridays in DOP. Prepared Wednesday 9:07 am, with a reminder. · {run ? (run.status === 'paid' ? 'Paid' : `${totals.pending} to pay`) : 'not prepared'}</>}
        actions={<>
          <div className="fin-stepper">
            <Stepper label={`Payday ${new Date(`${payday}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
              prevLabel="Previous payday" nextLabel="Next payday" onPrev={() => setPayday(addDays(payday, -7))} onNext={() => setPayday(addDays(payday, 7))} nextDisabled={payday >= latestPayday} />
          </div>
          {canManage && <button type="button" className="btn" disabled={!!busy} onClick={() => void prepare()}>{busy === 'prepare' ? 'Preparing…' : run ? 'Prepare again' : 'Prepare payroll'}</button>}
        </>} />
      {loadError && <Banner tone="danger" onClose={() => setLoadError(null)}>{loadError}</Banner>}

      {!run ? (
        <EmptyState>{loaded ? <>This payroll isn't prepared yet. It's prepared automatically on Wednesday morning, or press <strong>Prepare payroll</strong>. Only approved hours are paid.</> : 'Loading…'}</EmptyState>
      ) : (
        <>
          <div className="fin-pr-top">
            <section className="card card--navy fin-rate">
              <span className="fin-rate__label">Exchange rate for this payday</span>
              <div className="fin-rate__value">
                {canManage
                  ? <span className="fin-rate__input-wrap">RD$ <input aria-label="Exchange rate" className="fin-rate__input" inputMode="decimal" value={rateInput} disabled={locked} onChange={e => setRateInput(e.target.value)} placeholder="60.50" /></span>
                  : <span className="fin-rate__big">{rate ? `RD$ ${rate}` : 'Not set'}</span>}
                <span className="fin-rate__unit">per USD · BHD buy rate</span>
              </div>
              {canManage && !locked && (
                <div className="fin-rate__actions">
                  <button type="button" className="btn btn--sm btn--gold" onClick={() => void bhd()}>Fill from BHD</button>
                  <button type="button" className="btn btn--sm fin-rate__save" disabled={!rateInput || busy === 'rate'} onClick={() => void saveRate()}>Save rate</button>
                  <span className="fin-rate__hint">Locks once the first line is paid</span>
                </div>
              )}
              {locked && <span className="fin-rate__hint">Locked — people are already paid</span>}
              {canManage && !locked && run.exchange_rate == null && <span className="fin-rate__hint">Not saved yet — DOP amounts are fixed when people are marked paid.</span>}
            </section>
            <section className="card fin-pr-sum">
              <div className="fin-pr-sum__cell"><span className="fin-pr-sum__label">People</span><span className="fin-pr-sum__value">{totals.people}</span></div>
              <div className="fin-pr-sum__cell"><span className="fin-pr-sum__label">Net pay (USD)</span><span className="fin-pr-sum__value num">{usd(totals.net)}</span><span className="fin-pr-sum__note">gross {usd(totals.gross)}</span></div>
              <div className="fin-pr-sum__cell"><span className="fin-pr-sum__label">Net in DOP</span><span className="fin-pr-sum__value num">{rate ? dop(totals.dop) : '—'}</span><span className="fin-pr-sum__note">{rate ? `at RD$${rate}` : 'enter the rate'}</span></div>
              <div className="fin-pr-sum__cell"><span className="fin-pr-sum__label">Paid so far</span><span className={`fin-pr-sum__value${totals.paid ? ' t-success' : ''}`}>{totals.paid} of {lines.length}</span></div>
            </section>
          </div>

          {run.flags.length > 0 && (
            <div className="fin-pr-flags" role="status">
              <span className="fin-pr-flags__title">{run.flags.length} flag{run.flags.length === 1 ? '' : 's'} before paying</span>
              {run.flags.map((f, i) => <span key={i} className="fin-pr-flags__item">• {f.message}</span>)}
            </div>
          )}

          <section className="card fin-pr-lines">
            <div className="fin-pr-lines__head">
              <h2 className="card__title fin-pr-lines__title">Lines · {lines.length}</h2>
              {canManage && selected.size > 0 ? (
                <div className="fin-selbar">
                  <span className="muted">{selected.size} selected · {rate ? dop(selDop) : usd(selLines.reduce((s, l) => s + l.net_usd, 0))}</span>
                  <input className="input input--sm fin-selbar__ref" aria-label="Transfer reference" placeholder="Transfer reference" value={refInput} onChange={e => setRefInput(e.target.value)} />
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => openPay([...selected])}>Mark {selected.size} paid</button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSelected(new Set())}>Clear</button>
                </div>
              ) : (
                <div className="fin-selbar">
                  {canManage && <button type="button" className="btn btn--sm btn--primary" disabled={totals.pending === 0} onClick={() => openPay(lines.filter(l => l.status === 'pending').map(l => l.id))}>Mark all paid</button>}
                  {canManage && canBank && <Menu label="Payment list" buttonClass="btn btn--sm" trigger={<>Payment list</>} items={[
                    { label: 'Payment list (print)', icon: P.printer, onClick: () => paymentList('print') },
                    { label: 'Payment list (CSV)', icon: P.download, onClick: () => paymentList('csv') },
                  ]} />}
                </div>
              )}
            </div>
            {lines.length === 0 && <div className="card-empty">Nobody to pay on this payday (no approved hours whose pay period ends this week).</div>}
            {lines.length > 0 && (mobile ? (
              <div className="fin-pr-m">
                {groups.map(g => (
                  <div key={g}>
                    {g !== 'All' && <div className="fin-pr-group">{g}</div>}
                    {sortedIn(g).map(l => (
                      <div key={l.id} className={`fin-pr-mrow${selected.has(l.id) ? ' fin-row--sel' : ''}`}>
                        {canManage && <Checkbox ariaLabel={`Select ${emp(l.employee_id)?.name}`} checked={selected.has(l.id) || l.status === 'paid'} disabled={l.status !== 'pending'} onChange={() => toggle(l)} />}
                        <button type="button" className="fin-pr-mrow__main" onClick={() => toggle(l)}>
                          <span className="fin-pr-mrow__name">{emp(l.employee_id)?.name ?? '—'}</span>
                          <span className="fin-pr-mrow__meta">{l.label} · <span className="mono">{hmClock(l.regular_seconds + l.premium_seconds)}</span></span>
                        </button>
                        <span className="fin-pr-mrow__right"><span className="fin-strong num">{l.status === 'paid' && l.net_dop != null ? dop(l.net_dop) : rate ? dop(l.net_usd * rate) : usd(l.net_usd)}</span>{statusPill(l)}</span>
                        {lineMenu(l)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="fin-pr-scroll">
                <table className="table fin-pr-table">
                  <thead><tr>
                    {canManage && <th className="fin-col-check" aria-label="Select" />}
                    <th>Person</th><th>Project · period</th><th>Hours</th><th>Rate</th><th className="t-right">Gross</th><th className="t-right">Adjust.</th><th className="t-right">Net USD</th><th className="t-right">Net DOP</th><th>Payout</th><th>Status</th><th />
                  </tr></thead>
                  <tbody>
                    {groups.map(g => [
                      g !== 'All' ? <tr key={`g-${g}`} className="fin-pr-grouprow"><td colSpan={canManage ? 12 : 11}>{g}</td></tr> : null,
                      ...sortedIn(g).map(l => {
                        const flag = run.flags.find(f => f.employeeId === l.employee_id)
                        return (
                          <tr key={l.id} className={selected.has(l.id) ? 'fin-row--sel' : undefined}>
                            {canManage && <td className="fin-col-check"><Checkbox ariaLabel={`Select ${emp(l.employee_id)?.name}`} checked={selected.has(l.id) || l.status === 'paid'} disabled={l.status !== 'pending'} onChange={() => toggle(l)} /></td>}
                            <td><span className="t-strong">{emp(l.employee_id)?.name ?? '—'}</span>{flag && <span className="fin-flag-line">{flag.message.replace(`${flag.employeeName ?? ''}: `, '')}</span>}</td>
                            <td><span>{l.label}</span><span className="t-sub">{short(l.period_start)} – {short(l.period_end)}{l.schedule && l.schedule !== 'weekly' ? ` (${l.schedule})` : ''}</span></td>
                            <td className="fin-pr-hours">{hm(l.regular_seconds + l.premium_seconds)}{l.premium_seconds ? <span className="fin-premium">{hm(l.premium_seconds)} night</span> : null}</td>
                            <td>{(l.rates || []).length > 1 ? 'Multiple' : l.pay_rate ? usd(l.pay_rate) : <span className="t-danger">none</span>}</td>
                            <td className="t-num">{usd(l.gross_usd)}</td>
                            <td className={`t-num ${l.adjustments_usd > 0 ? 't-success' : l.adjustments_usd < 0 ? 't-danger' : 'soft'}`}>{l.adjustments_usd ? usd(l.adjustments_usd) : '—'}</td>
                            <td className="t-num t-strong">{usd(l.net_usd)}</td>
                            <td className="t-num fin-strong">{l.status === 'paid' && l.net_dop != null ? dop(l.net_dop) : rate ? dop(l.net_usd * rate) : '—'}</td>
                            <td>{payoutCell(l)}</td>
                            <td>{statusPill(l)}</td>
                            <td className="t-actions"><span className="fin-acts"><button type="button" className="btn btn--xs" onClick={() => payslip(l)}>Payslip</button>{canManage && l.status === 'paid' && lineMenu(l)}</span></td>
                          </tr>
                        )
                      }),
                    ])}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        </>
      )}

      {(canManage || adjRows.length > 0) && (
        <section className="card fin-pr-adj">
          <div className="card__head">
            <div className="fin-pr-adj__title"><h2 className="card__title">Bonuses and deductions</h2><span className="card__meta">Applied when the person's line is marked paid{pending.length ? ` · ${pending.length} waiting for a payroll` : ''}</span></div>
            {canManage && <button type="button" className="btn btn--sm" onClick={() => setAdjForm({ employeeId: employees[0]?.id ?? '', type: 'bonus', amount: '', reason: '', repeat: '1' })}>+ Add</button>}
          </div>
          {adjRows.length === 0 && <div className="card-empty">No bonuses or deductions waiting.</div>}
          {adjRows.map(a => (
            <div key={a.id} className="fin-adj">
              <Pill tone={a.type === 'bonus' ? 'success' : 'danger'}>{a.type === 'bonus' ? 'Bonus' : 'Deduction'}</Pill>
              <span className="t-strong">{emp(a.employee_id)?.name}</span>
              <span className="fin-adj__note">{a.reason}</span>
              {a.status === 'applied' && <Pill tone="neutral">Applied</Pill>}
              {a.status === 'pending' && a.run_id && a.run_id === run?.id && <Pill tone="info">on this payroll</Pill>}
              <span className={`fin-adj__amt ${a.type === 'bonus' ? 't-success' : 't-danger'}`}>{signed(a.type === 'bonus' ? a.amount : -a.amount)}</span>
              {canManage && a.status === 'pending' && <Menu items={[{ label: 'Cancel', icon: P.x, danger: true, onClick: () => void act('cancel', () => cancelAdjustment(a, a.total > 1 && window.confirm('Cancel the remaining repeats too?')), 'Cancelled.') }]} buttonClass="btn btn--icon btn--xs fin-more" />}
            </div>
          ))}
        </section>
      )}

      <Modal open={!!payForm} onClose={() => setPayForm(null)} title={payForm ? `Mark ${payForm.ids.length} paid` : ''} sub="Each person gets a notification and can download their payslip in My workspace."
        footer={payForm ? <>
          <button type="button" className="btn" onClick={() => setPayForm(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!run?.exchange_rate || busy === 'pay'} onClick={() => { const f = payForm; setPayForm(null); setRefInput(''); void act('pay', async () => { const n = await markPaid(f.ids, f.paidOn, f.reference); toast.success(`${n} marked paid.`) }) }}>Mark paid</button>
        </> : undefined}>
        {payForm && <>
          {!run?.exchange_rate && <Banner tone="danger">Save the exchange rate first — DOP amounts are fixed when people are marked paid.</Banner>}
          <div className="form-grid form-grid--2">
            <Field label="Paid on"><input aria-label="Paid on" className="input" type="date" value={payForm.paidOn} onChange={e => setPayForm({ ...payForm, paidOn: e.target.value })} /></Field>
            <Field label="Reference (optional)"><input aria-label="Reference" className="input" value={payForm.reference} placeholder="e.g. BHD batch #" onChange={e => setPayForm({ ...payForm, reference: e.target.value })} /></Field>
          </div>
        </>}
      </Modal>

      <Modal open={!!adjForm} onClose={() => setAdjForm(null)} title="Bonus or deduction" sub="Goes on the next payroll. Each payroll uses one and it never comes back."
        footer={adjForm ? <>
          <button type="button" className="btn" onClick={() => setAdjForm(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!adjForm.employeeId || !(Number(adjForm.amount.replace(',', '.')) > 0) || adjForm.reason.trim().length < 2}
            onClick={() => { const f = adjForm; setAdjForm(null); void act('adj', () => addAdjustment({ employeeId: f.employeeId, type: f.type, amount: Number(f.amount.replace(',', '.')), reason: f.reason, repeat: Number(f.repeat) }), 'Saved — it goes on the next payroll (press "Prepare again" if this one is open).') }}>Save</button>
        </> : undefined}>
        {adjForm && (
          <div className="form-grid form-grid--2">
            <Field label="Person" full>
              <select aria-label="Person" className="select" value={adjForm.employeeId} onChange={e => setAdjForm({ ...adjForm, employeeId: e.target.value })}>
                {employees.filter(e => String(e.status || '').toLowerCase() !== 'inactive').map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select aria-label="Type" className="select" value={adjForm.type} onChange={e => setAdjForm({ ...adjForm, type: e.target.value as 'bonus' | 'deduction' })}><option value="bonus">Bonus</option><option value="deduction">Deduction</option></select>
            </Field>
            <Field label="Amount (USD)"><input aria-label="Amount (USD)" className="input" inputMode="decimal" value={adjForm.amount} onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })} /></Field>
            <Field label="Reason (shown on the payslip)" full><input aria-label="Reason" className="input" value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder="e.g. Referral bonus" /></Field>
            <Field label="Repeat for the next … paydays" hint="1 = only the next payroll." full>
              <input aria-label="Repeat" className="input" type="number" min={1} max={52} value={adjForm.repeat} onChange={e => setAdjForm({ ...adjForm, repeat: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
