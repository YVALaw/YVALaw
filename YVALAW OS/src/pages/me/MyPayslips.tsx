import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { openPayslip } from '../../utils/payslipHtml'

type Line = { id: string; run_id: string; label: string; period_start: string; period_end: string; payday: string; paid_on: string | null; reference: string | null
  regular_seconds: number; premium_seconds: number; pay_rate: number; rates: number[]; premium_percent: number; gross_usd: number; adjustments_usd: number; net_usd: number
  net_dop: number | null; exchange_rate: number | null; payout: { method?: string; bank?: string; account?: string; paypal?: string } | null }
type Adj = { run_id: string; type: 'bonus' | 'deduction'; amount: number; reason: string }

const T = { en: { none: 'No payments yet. Your payslips appear here after YVA pays you.', download: 'Payslip', paid: 'Paid' }, es: { none: 'Aún no hay pagos. Tus comprobantes aparecen aquí cuando YVA te paga.', download: 'Comprobante', paid: 'Pagado' } }

/** My workspace → payslips: own PAID payroll lines (RLS), downloadable */
export default function MyPayslips({ employeeName, employeeNumber, lang = 'en' }: { employeeName: string; employeeNumber?: string | null; lang?: 'en' | 'es' }) {
  const t = T[lang]
  const [lines, setLines] = useState<Line[] | null>(null)
  const [adjs, setAdjs] = useState<Adj[]>([])
  useEffect(() => {
    void supabase.from('payroll_lines').select('*').eq('status', 'paid').order('payday', { ascending: false }).limit(40).then(({ data }) => setLines((data || []) as Line[]))
    void supabase.from('payroll_adjustments').select('run_id,type,amount,reason').eq('status', 'applied').then(({ data }) => setAdjs((data || []) as Adj[]))
  }, [])
  if (lines === null) return null
  if (lines.length === 0) return <div style={{ fontSize: 14, color: 'var(--muted)' }}>{t.none}</div>
  return (
    <div>
      {lines.map(l => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{new Date(`${l.payday}T12:00:00`).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {l.label}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{l.period_start} – {l.period_end}</div>
          </div>
          <strong>{l.net_dop != null ? `RD$${Math.round(Number(l.net_dop)).toLocaleString('en-US')}` : `$${Number(l.net_usd).toFixed(2)}`}</strong>
          <button className="btn-ghost btn-sm" onClick={() => openPayslip({ companyName: 'YVA Staffing', employeeName, employeeNumber, label: l.label, periodStart: l.period_start, periodEnd: l.period_end, payday: l.payday,
            paidOn: l.paid_on, reference: l.reference, regularSeconds: l.regular_seconds, premiumSeconds: l.premium_seconds, payRate: Number(l.pay_rate), rates: l.rates || [],
            premiumPercent: Number(l.premium_percent) || 0, grossUsd: Number(l.gross_usd), netUsd: Number(l.net_usd), exchangeRate: l.exchange_rate == null ? null : Number(l.exchange_rate),
            netDop: l.net_dop == null ? null : Number(l.net_dop), payout: l.payout, lang,
            adjustments: Number(l.adjustments_usd) ? adjs.filter(a => a.run_id === l.run_id).map(a => ({ ...a, amount: Number(a.amount) })) : [] })}>{t.download}</button>
        </div>
      ))}
    </div>
  )
}
