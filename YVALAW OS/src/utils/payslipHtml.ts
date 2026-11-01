// Payslip (Step 6) — printed / saved as PDF from Payroll and from My workspace. Every value is escaped.
import { escapeHtml as esc } from './html'

export type PayslipData = {
  companyName: string; employeeName: string; employeeNumber?: string | null
  label: string; periodStart: string; periodEnd: string; payday: string; paidOn: string | null; reference: string | null
  regularSeconds: number; premiumSeconds: number; payRate: number; rates: number[]; premiumPercent: number
  grossUsd: number; adjustments: { type: 'bonus' | 'deduction'; amount: number; reason: string }[]; netUsd: number
  exchangeRate: number | null; netDop: number | null; payout?: { method?: string; bank?: string; account?: string; paypal?: string } | null
  lang?: 'en' | 'es'
}
const usd = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hm = (s: number) => { const m = Math.round(s / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
const date = (d: string | null, es: boolean) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(es ? 'es-DO' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

export function buildPayslipHTML(p: PayslipData, autoPrint = false): string {
  const es = p.lang === 'es'
  const T = es
    ? { title: 'Comprobante de pago', period: 'Período', paid: 'Pagado', ref: 'Referencia', hours: 'Horas', regular: 'Regulares', night: 'Nocturnas', rate: 'Tarifa', gross: 'Bruto', bonus: 'Bono', deduction: 'Deducción', net: 'Neto', rateLabel: 'Tasa', to: 'Pagado a' }
    : { title: 'Payslip', period: 'Period', paid: 'Paid', ref: 'Reference', hours: 'Hours', regular: 'Regular', night: 'Night', rate: 'Rate', gross: 'Gross', bonus: 'Bonus', deduction: 'Deduction', net: 'Net pay', rateLabel: 'Exchange rate', to: 'Paid to' }
  const rateText = p.rates.length > 1 ? p.rates.map(r => usd(r)).join(' / ') + '/h' : `${usd(p.payRate)}/h`
  const adj = p.adjustments.map(a => `<tr><td>${a.type === 'bonus' ? T.bonus : T.deduction}: ${esc(a.reason)}</td><td class="r">${a.type === 'bonus' ? '' : '−'}${usd(a.amount)}</td></tr>`).join('')
  const payout = p.payout ? (p.payout.method === 'paypal' ? `PayPal ${esc(p.payout.paypal || '')}` : `${esc(p.payout.bank || '')} ${esc(p.payout.account || '')}`) : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(T.title)} — ${esc(p.employeeName)} — ${esc(p.payday)}</title>
<style>
  body{font-family:Inter,Arial,sans-serif;color:#1b1e2b;max-width:720px;margin:32px auto;padding:0 20px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #facc15;padding-bottom:12px;margin-bottom:18px}
  h1{font-size:20px;margin:0} .muted{color:#6b7280;font-size:12px} table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  td,th{padding:8px 6px;border-bottom:1px solid #e5e7eb;text-align:left} .r{text-align:right} .total td{font-weight:800;font-size:15px;border-top:2px solid #1b1e2b}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:13px} .big{font-size:22px;font-weight:800}
  @media print{body{margin:0}}
</style></head><body>
<div class="head"><div><h1>${esc(p.companyName)}</h1><div class="muted">${esc(T.title)}</div></div>
<div style="text-align:right"><div class="big">${p.netDop != null ? `RD$${Math.round(p.netDop).toLocaleString('en-US')}` : usd(p.netUsd)}</div><div class="muted">${esc(T.paid)} ${esc(date(p.paidOn, es))}</div></div></div>
<div class="grid">
  <div><strong>${esc(p.employeeName)}</strong>${p.employeeNumber ? ` · ${esc(p.employeeNumber)}` : ''}</div><div class="r">${esc(p.label)}</div>
  <div>${esc(T.period)}: ${esc(date(p.periodStart, es))} – ${esc(date(p.periodEnd, es))}</div><div class="r">${esc(T.ref)}: ${esc(p.reference || '—')}</div>
  ${payout ? `<div>${esc(T.to)}: ${payout}</div><div></div>` : ''}
</div>
<table>
  <tr><th>${esc(T.hours)}</th><th class="r">${esc(T.rate)}</th><th class="r">USD</th></tr>
  <tr><td>${esc(T.regular)} ${hm(p.regularSeconds)}</td><td class="r">${esc(rateText)}</td><td class="r"></td></tr>
  ${p.premiumSeconds ? `<tr><td>${esc(T.night)} ${hm(p.premiumSeconds)} (+${p.premiumPercent}%)</td><td class="r"></td><td class="r"></td></tr>` : ''}
  <tr><td><strong>${esc(T.gross)}</strong></td><td></td><td class="r"><strong>${usd(p.grossUsd)}</strong></td></tr>
  ${adj}
  <tr class="total"><td>${esc(T.net)}</td><td></td><td class="r">${usd(p.netUsd)}</td></tr>
  ${p.exchangeRate ? `<tr><td>${esc(T.rateLabel)}: RD$${p.exchangeRate} / $1</td><td></td><td class="r"><strong>RD$${(p.netDop ?? p.netUsd * p.exchangeRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td></tr>` : ''}
</table>
${autoPrint ? '<script>window.onload=()=>window.print()</script>' : ''}
</body></html>`
}

export function openPayslip(p: PayslipData, autoPrint = true) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(buildPayslipHTML(p, autoPrint)); w.document.close()
}
