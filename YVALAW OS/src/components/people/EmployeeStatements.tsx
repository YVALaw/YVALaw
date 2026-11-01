// People hub: earnings statements (Team → Statements drawer, employee profile → Pay & payout).
// The calculations, email and payslip are the ones the Team page and the profile already used.
import { useEffect, useState } from 'react'
import type { Employee, Invoice, TimeEntry } from '../../data/types'
import { loadSettings, loadTimeEntries, saveInvoices } from '../../services/storage'
import { sendEmail } from '../../services/gmail'
import { buildStatementHTML } from '../../utils/statementHtml'
import { trackedHoursOf, trackedPayEntries } from '../../utils/trackedPay'
import { employeePremiumConfig, payrollFromInvoiceItem } from '../../utils/payroll'
import { formatMoney, fmtHoursHM } from '../../utils/money'
import { Ic, P } from '../Icon'
import { Banner, EmptyState, Field, KpiStrip, Modal, Pill } from '../ui'

export function getEmpInvoices(name: string, invoices: Invoice[], from?: string, to?: string) {
  return invoices.filter(inv => {
    const has = (inv.items || []).some(it => it.employeeName?.toLowerCase() === name.toLowerCase())
    if (!has) return false
    const d = inv.date || inv.billingEnd || inv.billingStart
    if (!d) return true
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

export function getEmployeeInvoiceItems(emp: Employee, inv: Invoice) {
  return (inv.items || []).filter(it =>
    (it.employeeId && it.employeeId === emp.id) ||
    it.employeeName?.toLowerCase() === emp.name.toLowerCase()
  )
}

export function summarizeEmployeeInvoices(emp: Employee, invoices: Invoice[]) {
  return invoices.reduce((summary, inv) => {
    for (const item of getEmployeeInvoiceItems(emp, inv)) {
      const payroll = payrollFromInvoiceItem(item, emp)
      summary.hours += payroll.totalHours
      summary.regularHours += payroll.regularHours
      summary.premiumHours += payroll.premiumHours
      summary.totalPay += payroll.totalPay
    }
    return summary
  }, { hours: 0, regularHours: 0, premiumHours: 0, totalPay: 0 })
}

export async function emailStatement(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string, tracked: TimeEntry[] = []) {
  const settings = await loadSettings()
  const payRate = Number(emp.payRate) || 0
  const dopRate = settings.usdToDop || 0
  const summary = summarizeEmployeeInvoices(emp, empInvoices)
  const totalHours = summary.hours + trackedHoursOf(tracked)
  const totalUSD = summary.totalPay + trackedHoursOf(tracked) * payRate
  const totalDOP = dopRate > 0 ? totalUSD * dopRate : 0
  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'
  const companyName = settings.companyName || 'YVA Staffing'
  const subject = `Your Earnings Statement — ${period} — ${companyName}`
  let bodyText: string
  if (settings.statementEmailTemplate) {
    bodyText = settings.statementEmailTemplate
      .replace(/\{employeeName\}/g, emp.name)
      .replace(/\{period\}/g, period)
      .replace(/\{companyName\}/g, companyName)
  } else {
    bodyText =
      `Hi ${emp.name},\n\nHere is your earnings summary for the period ${period}:\n\n` +
      `  Total Hours: ${totalHours.toFixed(1)}h\n` +
      `  Total Earned: $${totalUSD.toFixed(2)} USD` +
      (totalDOP > 0 ? ` / RD$${totalDOP.toLocaleString('en-US', { maximumFractionDigits: 0 })} DOP\n` : '\n') +
      `  Invoices: ${empInvoices.length}\n\n` +
      `Please reach out if you have any questions.\n\n${settings.emailSignature || companyName}`
  }
  const statementHtml = buildStatementHTML(emp, empInvoices, dateFrom, dateTo, dopRate, false, tracked)
  const safeName = emp.name.replace(/\s+/g, '-').toLowerCase()
  const periodSlug = period.replace(/\s/g, '').replace(/[^a-zA-Z0-9-]/g, '-')
  return sendEmail(emp.email || '', subject, bodyText, {
    name: `statement-${safeName}-${periodSlug}.html`,
    content: statementHtml,
    mimeType: 'text/html',
  })
}

export async function printPayslip(emp: Employee, empInvoices: Invoice[], dateFrom: string, dateTo: string, tracked: TimeEntry[] = []) {
  const settings = await loadSettings()
  const html = buildStatementHTML(emp, empInvoices, dateFrom, dateTo, settings.usdToDop || 0, true, tracked)
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
}

const DA = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Statements for one person: date filter, KPIs (premium split when they have a night premium), per-invoice
 *  daily grid with Mark as paid / Undo, totals by project, Email statement and PDF payslip. */
export default function EmployeeStatements({ emp, invoices, onInvoicesChange, timeEntries: givenEntries }: {
  emp: Employee
  invoices: Invoice[]
  onInvoicesChange: (updated: Invoice[]) => void
  timeEntries?: TimeEntry[]
}) {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [payModal, setPayModal] = useState<Invoice | null>(null)
  const [payDate, setPayDate] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [ownEntries, setOwnEntries] = useState<TimeEntry[]>([])
  useEffect(() => { if (!givenEntries) void loadTimeEntries().then(setOwnEntries) }, [givenEntries])
  const timeEntries = givenEntries ?? ownEntries

  function show(ok: boolean, text: string) { setMsg({ ok, text }); if (ok) setTimeout(() => setMsg(m => (m?.text === text ? null : m)), 4000) }

  const empInvoices = getEmpInvoices(emp.name, invoices, dateFrom || undefined, dateTo || undefined)
  const payRate = Number(emp.payRate) || 0
  const premium = employeePremiumConfig(emp)
  const summary = summarizeEmployeeInvoices(emp, empInvoices)
  const empTracked = trackedPayEntries(emp, timeEntries, dateFrom || undefined, dateTo || undefined)
  const trackedHours = trackedHoursOf(empTracked)
  const totalHours = summary.hours + trackedHours
  const totalEarned = summary.totalPay + trackedHours * payRate
  const payOf = (inv: Invoice) => inv.employeePayments?.[emp.id] || inv.employeePayments?.[emp.name]
  const paidCount = empInvoices.filter(inv => payOf(inv)?.status === 'paid').length
  const pendingCount = empInvoices.length - paidCount
  const totalPaid = empInvoices.reduce((s, inv) => {
    if (payOf(inv)?.status !== 'paid') return s
    return s + getEmployeeInvoiceItems(emp, inv).reduce((t, item) => t + payrollFromInvoiceItem(item, emp).totalPay, 0)
  }, 0)

  async function writeInvoices(updated: Invoice[], ok: string) {
    const before = invoices
    onInvoicesChange(updated)
    try { await saveInvoices(updated); show(true, ok) }
    catch (e) { onInvoicesChange(before); show(false, `Could not save: ${(e as Error).message}`) }
  }

  async function markPaid(inv: Invoice) {
    const amount = getEmployeeInvoiceItems(emp, inv).reduce((sum, item) => sum + payrollFromInvoiceItem(item, emp).totalPay, 0)
    const existingPayments = { ...(inv.employeePayments || {}) }
    if (emp.name in existingPayments && emp.id !== emp.name) delete existingPayments[emp.name]
    const updated = invoices.map(i => i.id === inv.id ? {
      ...i,
      employeePayments: { ...existingPayments, [emp.id]: { status: 'paid' as const, paidDate: payDate || new Date().toISOString().slice(0, 10), amount, notes: payNotes || undefined } },
    } : i)
    setPayModal(null); setPayDate(''); setPayNotes('')
    await writeInvoices(updated, `${inv.number} marked as paid.`)
  }

  async function markPending(inv: Invoice) {
    const existingPayments = { ...(inv.employeePayments || {}) }
    if (emp.name in existingPayments && emp.id !== emp.name) delete existingPayments[emp.name]
    const updated = invoices.map(i => i.id === inv.id ? { ...i, employeePayments: { ...existingPayments, [emp.id]: { status: 'pending' as const } } } : i)
    await writeInvoices(updated, `${inv.number} back to pending.`)
  }

  async function sendStatement() {
    setSending(true)
    try {
      const r = await emailStatement(emp, empInvoices, dateFrom, dateTo, empTracked)
      const mode = r.mode
      if (mode === 'failed') show(false, 'Not sent — check the Gmail connection in Settings.')
      else show(true, mode === 'mailto' ? 'Opened in your mail app — attach the downloaded statement.' : `Statement sent to ${emp.email}`)
    } catch { show(false, 'Failed to send — check Gmail connection in Settings') }
    finally { setSending(false) }
  }

  const byProject = new Map<string, { hours: number; earned: number }>()
  for (const inv of empInvoices) {
    const projName = inv.projectName || 'No project'
    const pp = byProject.get(projName) || { hours: 0, earned: 0 }
    for (const it of getEmployeeInvoiceItems(emp, inv)) {
      const payroll = payrollFromInvoiceItem(it, emp)
      pp.hours += payroll.totalHours
      pp.earned += payroll.totalPay
    }
    byProject.set(projName, pp)
  }
  const projectTotals = Array.from(byProject.entries()).map(([name, pp]) => ({ name, ...pp }))
  const nothing = empInvoices.length === 0 && empTracked.length === 0

  return (
    <div className="ppl-statements">
      {msg && <Banner tone={msg.ok ? 'success' : 'danger'} onClose={() => setMsg(null)}>{msg.text}</Banner>}
      <div className="ppl-toolbar">
        <Field label="From"><input className="input input--sm" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input input--sm" type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></Field>
        {(dateFrom || dateTo) && <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setDateFrom(''); setDateTo('') }}>Clear</button>}
        <span className="spacer" />
        <button type="button" className="btn btn--sm" disabled={nothing || !emp.email || sending} title={!emp.email ? 'No email address on file — add one in the employee profile' : ''} onClick={() => void sendStatement()}>
          <Ic d={P.mail} size={15} />{sending ? 'Sending…' : 'Email statement'}
        </button>
        <button type="button" className="btn btn--sm" disabled={nothing} onClick={() => void printPayslip(emp, empInvoices, dateFrom, dateTo, empTracked)}>
          <Ic d={P.printer} size={15} />PDF payslip
        </button>
      </div>

      <KpiStrip compact items={[
        { label: 'Invoices', value: empInvoices.length },
        { label: 'Total hours', value: fmtHoursHM(totalHours), note: premium.enabled && summary.premiumHours > 0 ? `${fmtHoursHM(summary.regularHours)} regular · ${fmtHoursHM(summary.premiumHours)} night (+${premium.percent}%)` : undefined },
        { label: 'Pay rate', value: payRate > 0 ? `$${payRate}/hr` : '—' },
        { label: 'Total earned', value: payRate > 0 ? formatMoney(totalEarned) : '—' },
        { label: `${paidCount} paid`, value: payRate > 0 ? formatMoney(totalPaid) : paidCount, tone: paidCount > 0 ? 'success' : undefined },
        { label: 'Pending', value: pendingCount },
      ]} />

      {trackedHours > 0 && (
        <p className="ppl-note">Includes <strong>{trackedHours.toFixed(2)} h</strong> of approved YVA Time work (not on client invoices).</p>
      )}

      {empInvoices.length === 0 ? <EmptyState>No invoices for this period.</EmptyState> : (
        <div className="stack">
          {empInvoices.map(inv => {
            const items = getEmployeeInvoiceItems(emp, inv)
            const ps = items.reduce((acc, item) => { const p = payrollFromInvoiceItem(item, emp); acc.hours += p.totalHours; acc.totalPay += p.totalPay; acc.premium += p.premiumHours; return acc }, { hours: 0, totalPay: 0, premium: 0 })
            const period = inv.billingStart ? `${inv.billingStart}${inv.billingEnd ? ' – ' + inv.billingEnd : ''}` : (inv.date || '—')
            const daily = items[0]?.daily
            let allDates: string[] = []
            if (daily) {
              if (inv.billingStart && inv.billingEnd) {
                const cur = new Date(inv.billingStart + 'T12:00:00')
                const end = new Date(inv.billingEnd + 'T12:00:00')
                while (cur <= end) { allDates.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1) }
              } else {
                allDates = Object.keys(daily).filter(d => parseFloat(daily[d]) > 0).sort()
              }
            }
            const payment = payOf(inv)
            const isPaid = payment?.status === 'paid'
            return (
              <div key={inv.id} className="ppl-stmt">
                <div className="ppl-stmt__head">
                  <span className="mono ppl-stmt__num">{inv.number}</span>
                  <span className="muted">{inv.projectName || '—'} · {period}</span>
                  <span className="spacer" />
                  {isPaid ? (
                    <>
                      <Pill tone="success">Paid{payment?.paidDate ? ` ${longDate(payment.paidDate)}` : ''}</Pill>
                      <button type="button" className="btn btn--xs btn--ghost" onClick={() => void markPending(inv)}>Undo</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--xs btn--soft-gold" onClick={() => { setPayModal(inv); setPayDate(new Date().toISOString().slice(0, 10)); setPayNotes('') }}>Mark as paid</button>
                  )}
                </div>
                <div className="ppl-stmt__grid">
                  <table className="table table--compact">
                    <thead>
                      <tr>
                        {allDates.map(d => { const dt = new Date(d + 'T12:00:00'); return <th key={d} className="ppl-day">{DA[dt.getDay()]}<span>{dt.getMonth() + 1}/{dt.getDate()}</span></th> })}
                        <th className="t-right">Hours</th><th className="t-right">Rate</th><th className="t-right">Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {allDates.map(d => { const h = daily ? (parseFloat(daily[d] || '') || 0) : 0; return <td key={d} className={`ppl-day${h > 0 ? '' : ' soft'}`}>{h > 0 ? (h % 1 === 0 ? h : h.toFixed(1)) : '—'}</td> })}
                        <td className="t-num t-strong">{fmtHoursHM(ps.hours)}{ps.premium > 0 && <span className="t-sub">{fmtHoursHM(ps.premium)} night</span>}</td>
                        <td className="t-num muted">{payRate > 0 ? `$${payRate}/hr` : '—'}</td>
                        <td className="t-num t-strong">{payRate > 0 ? formatMoney(ps.totalPay) : '—'}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
          <div className="ppl-stmt-total">Total <span className="num">{fmtHoursHM(totalHours)}</span> <span className="num">{payRate > 0 ? formatMoney(totalEarned) : '—'}</span></div>
        </div>
      )}

      {projectTotals.length > 0 && (
        <div className="table-card">
          <div className="card__head"><h3 className="card__title">Totals by project</h3></div>
          <table className="table">
            <thead><tr><th>Project</th><th className="t-right">Hours</th><th className="t-right">Total pay</th></tr></thead>
            <tbody>
              {projectTotals.map(pt => (
                <tr key={pt.name}><td className="t-strong">{pt.name}</td><td className="t-num">{fmtHoursHM(pt.hours)}</td><td className="t-num t-strong">{payRate > 0 ? formatMoney(pt.earned) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!payModal} onClose={() => setPayModal(null)} title={`Mark as paid — ${payModal?.number ?? ''}`}
        footer={<><button type="button" className="btn" onClick={() => setPayModal(null)}>Cancel</button><button type="button" className="btn btn--primary" onClick={() => payModal && void markPaid(payModal)}>Confirm payment</button></>}>
        <Field label="Payment date"><input className="input" type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></Field>
        <Field label="Notes (optional)"><input className="input" placeholder="e.g. Bank transfer, Ref #1234" value={payNotes} onChange={e => setPayNotes(e.target.value)} /></Field>
      </Modal>
    </div>
  )
}
