import type { Employee, Invoice } from '../data/types'

export function buildStatementHTML(
  emp: Employee,
  empInvoices: Invoice[],
  dateFrom: string,
  dateTo: string,
  dopRate: number,
  autoPrint = false,
): string {
  const payRate   = Number(emp.payRate) || 0
  const totalHours = empInvoices.reduce((s, inv) =>
    s + (inv.items||[]).filter(it => it.employeeName?.toLowerCase() === emp.name.toLowerCase())
      .reduce((h, it) => h + (Number(it.hoursTotal) || 0), 0), 0)
  const totalUSD  = totalHours * payRate
  const totalDOP  = dopRate > 0 ? totalUSD * dopRate : 0

  function ph(v: string): number {
    if (!v) return 0
    const s = v.trim().replace(',', '.')
    if (s.includes(':')) { const [h, m] = s.split(':'); return (parseInt(h)||0) + (parseInt(m)||0)/60 }
    return parseFloat(s) || 0
  }
  const DA = ['Su','Mo','Tu','We','Th','Fr','Sa']

  const sections = empInvoices.map(inv => {
    const items    = (inv.items||[]).filter(it => it.employeeName?.toLowerCase() === emp.name.toLowerCase())
    const hrs      = items.reduce((h, it) => h + (Number(it.hoursTotal) || 0), 0)
    const earned   = payRate > 0 ? hrs * payRate : 0
    const invPeriod = inv.billingStart
      ? inv.billingStart + (inv.billingEnd ? ' – ' + inv.billingEnd : '')
      : (inv.date || '—')
    const daily    = items[0]?.daily
    let allDates: string[] = []
    if (daily) {
      if (inv.billingStart && inv.billingEnd) {
        const cur = new Date(inv.billingStart + 'T12:00:00')
        const end = new Date(inv.billingEnd   + 'T12:00:00')
        while (cur <= end) { allDates.push(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1) }
      } else {
        allDates = Object.keys(daily).filter(d => ph(daily[d]) > 0).sort()
      }
    }
    const label = '<div style="font-size:11px;margin-bottom:6px"><strong style="font-size:13px">' + inv.number + '</strong>&nbsp;&middot;&nbsp;' + (inv.projectName||'—') + '&nbsp;&middot;&nbsp;<span style="color:#999">' + invPeriod + '</span></div>'
    if (allDates.length > 0 && daily) {
      const dateHeaders = allDates.map(d => { const dt = new Date(d + 'T12:00:00'); return '<th style="text-align:center;font-size:9px;padding:5px 3px;min-width:22px;color:#999;border-bottom:2px solid #eee;white-space:nowrap">' + DA[dt.getDay()] + '<br>' + (dt.getMonth()+1) + '/' + dt.getDate() + '</th>' }).join('')
      const dayCells   = allDates.map(d => { const h = ph(daily[d]||''); return '<td style="text-align:center;padding:7px 4px;font-size:12px;color:' + (h>0?'#111':'#ccc') + '">' + (h>0?(h%1===0?String(h):h.toFixed(1)):'—') + '</td>' }).join('')
      return label + '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr>' + dateHeaders + '<th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">HOURS</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">RATE</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">EARNED</th></tr></thead><tbody><tr>' + dayCells + '<td style="text-align:right;font-weight:700;padding:8px 6px">' + hrs.toFixed(1) + 'h</td><td style="text-align:right;color:#999;padding:8px 6px">' + (payRate>0?'$'+payRate+'/hr':'—') + '</td><td style="text-align:right;font-weight:700;color:#f5b533;padding:8px 6px">' + (earned>0?'$'+earned.toFixed(2):'—') + '</td></tr></tbody></table>'
    } else {
      return label + '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px"><thead><tr><th style="font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">HOURS</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">RATE</th><th style="text-align:right;font-size:9px;padding:5px 6px;color:#999;border-bottom:2px solid #eee">EARNED</th></tr></thead><tbody><tr><td style="font-weight:700;padding:8px 6px">' + hrs.toFixed(1) + 'h</td><td style="text-align:right;color:#999;padding:8px 6px">' + (payRate>0?'$'+payRate+'/hr':'—') + '</td><td style="text-align:right;font-weight:700;color:#f5b533;padding:8px 6px">' + (earned>0?'$'+earned.toFixed(2):'—') + '</td></tr></tbody></table>'
    }
  }).join('<hr style="border:none;border-top:1px solid #eee;margin:0 0 16px">')

  const period = dateFrom && dateTo ? `${dateFrom} – ${dateTo}` : dateFrom || dateTo || 'All time'

  return `<!DOCTYPE html><html><head>
  <title>Statement — ${emp.name}</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#111}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;border-bottom:2px solid #f5b533;padding-bottom:16px}
    .logo{height:48px}
    h2{margin:0;font-size:22px;color:#f5b533}
    .meta{font-size:12px;color:#999;margin-top:4px}
    .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
    .kpi{background:#f9f9f9;border-radius:8px;padding:14px;text-align:center}
    .kpi-v{font-size:20px;font-weight:800;color:#111}
    .kpi-l{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#999;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999;padding:8px 8px;border-bottom:2px solid #eee}
    td{padding:8px;border-bottom:1px solid #eee}
    .footer{margin-top:32px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;text-align:center}
    @media print{body{margin:16px}}
  </style></head><body>
  <div class="header">
    <img src="${window.location.origin}/yva-logo.png" class="logo" onerror="this.style.display='none'" />
    <div style="text-align:right">
      <h2>EARNINGS STATEMENT</h2>
      <div class="meta">${emp.name}${emp.employeeNumber ? ` · ${emp.employeeNumber}` : ''}</div>
      <div class="meta">Period: ${period}</div>
      <div class="meta">Generated: ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</div>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="kpi-v">${empInvoices.length}</div><div class="kpi-l">Invoices</div></div>
    <div class="kpi"><div class="kpi-v">${totalHours.toFixed(1)}h</div><div class="kpi-l">Total Hours</div></div>
    <div class="kpi"><div class="kpi-v">${payRate>0?'$'+payRate+'/hr':'—'}</div><div class="kpi-l">Pay Rate</div></div>
    <div class="kpi"><div class="kpi-v">${payRate>0?'$'+totalUSD.toFixed(2):'—'}</div><div class="kpi-l">Total Earned (USD)</div></div>
    ${totalDOP>0?`<div class="kpi"><div class="kpi-v">RD$${totalDOP.toLocaleString('en-US',{maximumFractionDigits:0})}</div><div class="kpi-l">Total Earned (DOP @ ${dopRate})</div></div>`:''}
  </div>
  ${sections ? sections + '<div style="text-align:right;font-weight:800;font-size:13px;padding:10px 0;border-top:2px solid #111;margin-top:4px">Total &nbsp;&nbsp; ' + totalHours.toFixed(1) + 'h &nbsp;&nbsp; ' + (payRate>0?'$'+totalUSD.toFixed(2):'—') + '</div>' : '<p style="color:#999;text-align:center;padding:24px">No invoice data for this period.</p>'}
  <div class="footer">YVA Staffing · Bilingual Virtual Professionals · yvastaffing.net</div>
  ${autoPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}
  </body></html>`
}
