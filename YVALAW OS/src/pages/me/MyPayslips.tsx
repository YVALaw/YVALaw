import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { openPayslip } from '../../utils/payslipHtml'
import { Skel } from '../../components/ui'
import { usd } from '../../utils/format'
import { DICT, dateLabel, hm, type Lang } from './i18n'
import { adjAmount, adjWhen, type PendingAdjustment } from './MyPay'

type Line = { id: string; run_id: string; label: string; period_start: string; period_end: string; payday: string; paid_on: string | null; reference: string | null
  regular_seconds: number; premium_seconds: number; pay_rate: number; rates: number[]; premium_percent: number; gross_usd: number; adjustments_usd: number; net_usd: number
  net_dop: number | null; exchange_rate: number | null; payout: { method?: string; bank?: string; account?: string; paypal?: string } | null }
type Adj = { id?: string; run_id: string; type: 'bonus' | 'deduction'; amount: number; reason: string }

/** My workspace → My pay: payslips (own PAID payroll lines, RLS) with a PDF each, and the bonuses / deductions
 *  YVA applied to them (own applied payroll_adjustments, RLS) */
export default function MyPayslips({ employeeName, employeeNumber, lang = 'en', pending = [] }: { employeeName: string; employeeNumber?: string | null; lang?: Lang
  /** own bonuses / deductions waiting for a payday (employee-earnings; RLS only lets employees read applied ones) */
  pending?: PendingAdjustment[] }) {
  const t = DICT[lang].pay
  const [lines, setLines] = useState<Line[] | null>(null)
  const [adjs, setAdjs] = useState<Adj[]>([])
  useEffect(() => {
    void supabase.from('payroll_lines').select('*').eq('status', 'paid').order('payday', { ascending: false }).limit(40).then(({ data }) => setLines((data || []) as Line[]))
    void supabase.from('payroll_adjustments').select('id,run_id,type,amount,reason').eq('status', 'applied').then(({ data }) => setAdjs((data || []) as Adj[]))
  }, [])

  const pdf = (l: Line) => openPayslip({ companyName: 'YVA Staffing', employeeName, employeeNumber, label: l.label, periodStart: l.period_start, periodEnd: l.period_end, payday: l.payday,
    paidOn: l.paid_on, reference: l.reference, regularSeconds: l.regular_seconds, premiumSeconds: l.premium_seconds, payRate: Number(l.pay_rate), rates: l.rates || [],
    premiumPercent: Number(l.premium_percent) || 0, grossUsd: Number(l.gross_usd), netUsd: Number(l.net_usd), exchangeRate: l.exchange_rate == null ? null : Number(l.exchange_rate),
    netDop: l.net_dop == null ? null : Number(l.net_dop), payout: l.payout, lang,
    adjustments: Number(l.adjustments_usd) ? adjs.filter(a => a.run_id === l.run_id).map(a => ({ ...a, amount: Number(a.amount) })) : [] })
  const paydayOf = (runId: string) => lines?.find(l => l.run_id === runId)?.payday ?? null

  return (
    <>
      <section className="card">
        <h2 className="mw-card-title">{t.payslips}</h2>
        {lines === null && <div className="mw-row"><Skel h={36} /></div>}
        {lines?.length === 0 && <p className="mw-empty">{t.noSlips}</p>}
        {lines?.map(l => (
          <div key={l.id} className="mw-row mw-slip">
            <div className="mw-row__main">
              <span className="mw-row__title">{dateLabel(l.payday, lang)}</span>
              <span className="mw-row__meta">{hm(Number(l.regular_seconds) + Number(l.premium_seconds))} · {l.label} · {dateLabel(l.period_start, lang, { month: 'short', day: 'numeric' })} – {dateLabel(l.period_end, lang, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
            <span className="mw-slip__amount num">{l.net_dop != null ? `RD$${Math.round(Number(l.net_dop)).toLocaleString('en-US')}` : usd(Number(l.net_usd))}</span>
            <button type="button" className="btn mw-row__btn" aria-label={`${t.payslip} PDF ${dateLabel(l.payday, lang)}`} onClick={() => pdf(l)}>PDF</button>
          </div>
        ))}
      </section>
      <section className="card">
        <h2 className="mw-card-title">{t.adjustments}</h2>
        {adjs.length === 0 && pending.length === 0 && <p className="mw-empty">{t.noAdjustments}</p>}
        {pending.map(a => (
          <div key={`p-${a.id}`} className="mw-row mw-adj mw-adj--waiting">
            <div className="mw-row__main">
              <span className="mw-row__title">{a.reason}</span>
              <span className="mw-row__meta">{a.type === 'bonus' ? t.bonus : t.deduction} · {adjWhen(a, lang)}{a.total > 1 ? ` · ${t.of(a.sequence, a.total)}` : ''}</span>
            </div>
            <span className="pill pill--warning mw-pill">{t.waiting}</span>
            <span className={`mw-adj__amount num ${a.type === 'bonus' ? 't-success' : 't-danger'}`}>{adjAmount(a)}</span>
          </div>
        ))}
        {adjs.map((a, i) => {
          const payday = paydayOf(a.run_id)
          return (
            <div key={a.id ?? i} className="mw-row mw-adj">
              <div className="mw-row__main">
                <span className="mw-row__title">{a.reason}</span>
                <span className="mw-row__meta">{a.type === 'bonus' ? t.bonus : t.deduction}{payday ? ` · ${dateLabel(payday, lang)}` : ''}</span>
              </div>
              <span className={`mw-adj__amount num ${a.type === 'bonus' ? 't-success' : 't-danger'}`}>{a.type === 'bonus' ? '+' : '−'}{usd(Math.abs(Number(a.amount)))}</span>
            </div>
          )
        })}
      </section>
    </>
  )
}
