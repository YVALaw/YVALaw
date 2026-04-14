/**
 * invoiceHtml.ts
 * Shared invoice PDF/print builder used by InvoicePage (internal) and PortalBilling (client-facing).
 * Never passes DOP to client-facing output — always call with rate = 0 from portal.
 */

import type { Invoice } from '../data/types'
import { formatMoney } from './money'

export interface InvoiceHtmlOptions {
  rate?:           number   // USD→DOP rate; 0 = omit DOP line (always 0 for portal)
  companyName?:    string
  companyAddress?: string
  companyEmail?:   string
  companyPhone?:   string
  autoPrint?:      boolean  // inject window.print() onload
}

const DEFAULTS = {
  companyName:    'YVA Staffing',
  companyAddress: 'Santo Domingo, Dominican Republic',
  companyEmail:   'Contact@yvastaffing.net',
  companyPhone:   '+1 (717) 281-8676',
}

function parseH(v: string): number {
  if (!v) return 0
  const s = v.trim().replace(',', '.')
  if (s.includes(':')) { const [h, m] = s.split(':'); return (parseInt(h) || 0) + (parseInt(m) || 0) / 60 }
  return parseFloat(s) || 0
}

function dopLabel(usd: number, rate: number): string {
  if (!rate || rate <= 0) return ''
  return `RD$${(usd * rate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function buildInvoiceHTML(inv: Invoice, opts: InvoiceHtmlOptions = {}): string {
  const rate           = opts.rate           ?? 0
  const companyName    = opts.companyName    || DEFAULTS.companyName
  const companyAddress = opts.companyAddress || DEFAULTS.companyAddress
  const companyEmail   = opts.companyEmail   || DEFAULTS.companyEmail
  const companyPhone   = opts.companyPhone   || DEFAULTS.companyPhone
  const autoPrint      = opts.autoPrint      ?? false

  const dop = dopLabel(Number(inv.subtotal) || 0, rate)

  const dayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
  const hasDailyGrid = (inv.items || []).some(it => it.daily && Object.keys(it.daily).length > 0)
  const allDates: string[] = []
  if (hasDailyGrid && inv.billingStart && inv.billingEnd) {
    const cs = new Date(inv.billingStart + 'T12:00:00')
    const ce = new Date(inv.billingEnd   + 'T12:00:00')
    const cc = new Date(cs)
    while (cc <= ce && allDates.length < 31) {
      allDates.push(cc.toISOString().slice(0, 10))
      cc.setDate(cc.getDate() + 1)
    }
  }

  let itemsSection = ''
  if ((inv.items || []).length === 0) {
    itemsSection = `
    <div class="section">
      <div class="label">Amount Due</div>
      <div style="font-size:28px;font-weight:900;color:#f5b533">${formatMoney(Number(inv.subtotal) || 0)}</div>
      ${dop ? `<div class="dop">${dop}</div>` : ''}
    </div>`
  } else if (allDates.length > 0) {
    const dateHeaders = allDates.map(d => {
      const dt = new Date(d + 'T12:00:00')
      return '<th style="text-align:center;font-size:9px;padding:6px 2px;min-width:26px">' +
        dayAbbr[dt.getDay()] + '<br>' + (dt.getMonth() + 1) + '/' + dt.getDate() + '</th>'
    }).join('')
    const bodyRows = (inv.items || []).map(it => {
      const dayCells = allDates.map(d => {
        const h = parseH(it.daily?.[d] || '')
        return '<td style="text-align:center;font-size:11px;color:' + (h > 0 ? '#111' : '#ccc') + '">' +
          (h > 0 ? (h % 1 === 0 ? String(h) : h.toFixed(1)) : '—') + '</td>'
      }).join('')
      return '<tr><td style="white-space:nowrap"><strong>' + it.employeeName + '</strong>' +
        (it.position ? '<br><span style="font-size:10px;color:#888">' + it.position + '</span>' : '') +
        '</td>' + dayCells +
        '<td style="text-align:right;font-weight:700;white-space:nowrap">' + it.hoursTotal + 'h</td>' +
        '<td style="text-align:right;white-space:nowrap">$' + it.rate + '/hr</td>' +
        '<td style="text-align:right;font-weight:700;white-space:nowrap">$' + (it.hoursTotal * it.rate).toFixed(2) + '</td></tr>'
    }).join('')
    const colSpan = allDates.length + 3
    itemsSection = `
    <div style="overflow-x:auto;margin-top:16px">
    <table style="font-size:12px;width:100%">
      <thead><tr><th style="min-width:140px">Team Member</th>${dateHeaders}<th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${bodyRows}
        <tr class="total-row"><td colspan="${colSpan}">Total Due</td><td style="text-align:right">${formatMoney(Number(inv.subtotal) || 0)}</td></tr>
      </tbody>
    </table>
    </div>
    ${dop ? `<div class="dop">${dop}</div>` : ''}`
  } else {
    const bodyRows = (inv.items || []).map(it =>
      '<tr><td><strong>' + it.employeeName + '</strong>' +
      (it.position ? '<br><span style="font-size:11px;color:#888">' + it.position + '</span>' : '') +
      '</td><td style="text-align:right">' + it.hoursTotal + 'h</td>' +
      '<td style="text-align:right">$' + it.rate + '/hr</td>' +
      '<td style="text-align:right"><strong>$' + (it.hoursTotal * it.rate).toFixed(2) + '</strong></td></tr>'
    ).join('')
    itemsSection = `
    <table>
      <thead><tr><th>Team Member</th><th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${bodyRows}
        <tr class="total-row"><td colspan="3">Total Due</td><td style="text-align:right">${formatMoney(Number(inv.subtotal) || 0)}</td></tr>
      </tbody>
    </table>
    ${dop ? `<div class="dop">${dop}</div>` : ''}`
  }

  return `<!DOCTYPE html><html><head>
    <title>${inv.number}</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; color: #111; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
      .logo { height: 52px; }
      .from-info { font-size: 12px; color: #666; line-height: 1.6; margin-top: 8px; }
      .inv-title { font-size: 28px; font-weight: 900; color: #f5b533; }
      .inv-num { font-size: 14px; color: #666; margin-top: 4px; }
      .section { margin-bottom: 24px; }
      .label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #999; margin-bottom: 4px; }
      .value { font-size: 15px; font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #999; padding: 8px 10px; border-bottom: 2px solid #eee; }
      td { padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: top; }
      .total-row { font-size: 16px; font-weight: 800; }
      .total-row td { border-top: 2px solid #111; border-bottom: none; padding-top: 14px; }
      .dop { font-size: 12px; color: #999; margin-top: 4px; }
      .notes-box { background: #f9f9f9; border-left: 3px solid #f5b533; padding: 12px 16px; margin-top: 24px; font-size: 13px; color: #444; white-space: pre-wrap; }
      .footer { margin-top: 40px; font-size: 12px; color: #999; border-top: 1px solid #eee; padding-top: 16px; }
      @media print { body { margin: 20px; } }
    </style>
    </head><body>
    <div class="header">
      <div>
        <img src="${window.location.origin}/os/yva-logo.png" class="logo" onerror="this.style.display='none'" />
        <div class="from-info">
          <div><strong>${companyName}</strong></div>
          <div>${companyAddress}</div>
          <div>${companyEmail}</div>
          <div>${companyPhone}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div class="inv-title">INVOICE</div>
        <div class="inv-num">${inv.number}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px">
      <div class="section">
        <div class="label">Bill To</div>
        <div class="value">${inv.clientName || '—'}</div>
        ${inv.clientEmail  ? `<div style="font-size:13px;color:#666">${inv.clientEmail}</div>`  : ''}
        ${inv.clientAddress ? `<div style="font-size:13px;color:#666;white-space:pre-line">${inv.clientAddress}</div>` : ''}
      </div>
      <div class="section">
        <div class="label">Invoice Details</div>
        <div class="value">${inv.date || '—'}</div>
        ${inv.dueDate     ? `<div style="font-size:13px;color:#c00"><strong>Due: ${inv.dueDate}</strong></div>` : ''}
        ${inv.billingStart ? `<div style="font-size:13px;color:#666">Period: ${inv.billingStart} – ${inv.billingEnd || ''}</div>` : ''}
        ${inv.projectName  ? `<div style="font-size:13px;color:#666">Project: ${inv.projectName}</div>` : ''}
      </div>
    </div>
    ${itemsSection}
    ${inv.notes ? `<div class="notes-box">${inv.notes}</div>` : ''}
    <div class="footer">${companyName} · yvastaffing.net</div>
    ${autoPrint ? '<script>window.onload = function(){ window.print(); }</script>' : ''}
    </body></html>`
}

/** Open invoice as a print/PDF window */
export function printInvoice(inv: Invoice, opts: InvoiceHtmlOptions = {}): void {
  const html = buildInvoiceHTML(inv, { ...opts, autoPrint: true })
  const win = window.open('', '_blank', 'width=800,height=600')
  if (!win) return
  win.document.write(html)
  win.document.close()
}
