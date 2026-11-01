// Employee profile → Pay & payout → Payslips: this person's paid payroll lines (payroll.view, RLS), same
// payslip as Payroll and My workspace.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePermission } from '../../context/RoleContext'
import { loadSettings } from '../../services/storage'
import type { PayrollAdjustment, PayrollLine } from '../../services/payroll'
import { openPayslip } from '../../utils/payslipHtml'
import { Card } from '../ui'

const hm = (s: number) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export default function EmployeePayslips({ employeeId, employeeName, employeeNumber }: { employeeId: string; employeeName: string; employeeNumber?: string | null }) {
  const allowed = usePermission()
  const canSee = allowed('payroll.view') || allowed('payroll.manage')   // arrives after the first render for non-CEO roles
  const [lines, setLines] = useState<PayrollLine[] | null>(null)
  const [adjs, setAdjs] = useState<PayrollAdjustment[]>([])
  const [company, setCompany] = useState('YVA Staffing')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!canSee) return
    let alive = true
    void Promise.all([
      supabase.from('payroll_lines').select('*').eq('employee_id', employeeId).eq('status', 'paid').order('payday', { ascending: false }).limit(30),
      supabase.from('payroll_adjustments').select('*').eq('employee_id', employeeId).eq('status', 'applied'),
      loadSettings().catch(() => null),
    ]).then(([l, a, s]) => {
      if (!alive) return
      if (l.error) setError(l.error.code === '42P01' ? 'Run supabase/migrate-step6-payroll.sql to turn on payroll.' : l.error.message)
      setLines(((l.data || []) as PayrollLine[]).map(x => ({ ...x, net_usd: Number(x.net_usd), gross_usd: Number(x.gross_usd), pay_rate: Number(x.pay_rate), adjustments_usd: Number(x.adjustments_usd), net_dop: x.net_dop == null ? null : Number(x.net_dop) })))
      setAdjs(((a.data || []) as PayrollAdjustment[]).map(x => ({ ...x, amount: Number(x.amount) })))
      if (s?.companyName) setCompany(s.companyName)
    })
    return () => { alive = false }
  }, [employeeId, canSee])
  if (!canSee) return null

  function open(l: PayrollLine) {
    openPayslip({ companyName: company, employeeName, employeeNumber, label: l.label, periodStart: l.period_start, periodEnd: l.period_end, payday: l.payday,
      paidOn: l.paid_on, reference: l.reference, regularSeconds: l.regular_seconds, premiumSeconds: l.premium_seconds, payRate: l.pay_rate, rates: l.rates || [],
      premiumPercent: Number(l.premium_percent) || 0, grossUsd: l.gross_usd, netUsd: l.net_usd, exchangeRate: l.exchange_rate == null ? null : Number(l.exchange_rate),
      netDop: l.net_dop, payout: l.payout,
      adjustments: l.adjustments_usd ? adjs.filter(a => a.run_id === l.run_id).map(a => ({ type: a.type, amount: a.amount, reason: a.reason })) : [] })
  }

  return (
    <Card title="Payslips" meta="Paid Fridays from Payroll" className="ppl-span-all">
      {error && <div className="card__body t-danger">{error}</div>}
      {lines === null ? <div className="card__body muted">Loading…</div>
        : lines.length === 0 ? <div className="card-empty">No paid payslips yet.</div>
        : lines.map(l => (
          <div key={l.id} className="list-row">
            <div className="list-row__main">
              <span className="list-row__title">{day(l.payday)} · {l.label}</span>
              <span className="list-row__meta">{l.reference ? `Ref ${l.reference}` : 'Paid'}{l.paid_on ? ` · ${l.paid_on}` : ''}</span>
            </div>
            <span className="muted num hide-phone">{hm(l.regular_seconds + l.premium_seconds)}</span>
            <span className="ppl-slip-amt num">{l.net_dop != null ? `RD$ ${Math.round(l.net_dop).toLocaleString('en-US')}` : `$${l.net_usd.toFixed(2)}`}</span>
            <button type="button" className="link" onClick={() => open(l)}>PDF</button>
          </div>
        ))}
    </Card>
  )
}
