// Bulk actions on the Invoices page (2026-11): who gets emailed, what may be deleted, the CSV export and the
// summary messages. Pure (types only), so the unit tests run it directly under node.
import type { Invoice } from '../data/types'

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const statusOf = (i: Invoice) => (i.status || 'draft').toLowerCase()
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Balance still owed (paid → 0), to the cent — same rule as the list */
export function invoiceBalance(i: Invoice): number {
  if (statusOf(i) === 'paid') return 0
  return Math.max(0, Math.round((num(i.subtotal) - num(i.amountPaid)) * 100) / 100)
}

/** Email: drafts are skipped (they go out with Send, which also marks them sent) and so are invoices without a
 *  client email */
export function bulkEmailPlan(invoices: Invoice[]): { send: Invoice[]; drafts: Invoice[]; noEmail: Invoice[] } {
  const send: Invoice[] = [], drafts: Invoice[] = [], noEmail: Invoice[] = []
  for (const i of invoices) {
    if (statusOf(i) === 'draft') drafts.push(i)
    else if (!(i.clientEmail || '').trim()) noEmail.push(i)
    else send.push(i)
  }
  return { send, drafts, noEmail }
}

/** Delete: only invoices with no recorded payment (no client_payments row and nothing in amount paid) */
export function bulkDeletePlan(invoices: Invoice[], withPaymentRows: ReadonlySet<string>): { remove: Invoice[]; paid: Invoice[] } {
  const remove: Invoice[] = [], paid: Invoice[] = []
  for (const i of invoices) (withPaymentRows.has(i.id) || num(i.amountPaid) > 0 ? paid : remove).push(i)
  return { remove, paid }
}

/** "Emailed 5 · skipped 2 (no email) · 1 draft skipped · 1 failed" */
export function emailSummary(r: { sent: number; noEmail: number; drafts: number; failed: number; notReached?: number }): string {
  const parts = [`Emailed ${r.sent}`]
  if (r.noEmail) parts.push(`skipped ${r.noEmail} (no email)`)
  if (r.drafts) parts.push(`skipped ${plural(r.drafts, 'draft')} (use Send)`)
  if (r.failed) parts.push(`${r.failed} failed`)
  if (r.notReached) parts.push(`${r.notReached} not sent (stopped)`)
  return parts.join(' · ')
}

/** "Deleted 3 · kept 1 with payments (HAL-0040)" */
export function deleteSummary(removed: number, paid: Invoice[]): string {
  const parts = [`Deleted ${removed}`]
  if (paid.length) parts.push(`kept ${paid.length} with payments (${paid.map(i => i.number).join(', ')})`)
  return parts.join(' · ')
}

/** "2026-10-26 – 2026-11-01" (or the invoice date when there's no billing period) */
export function periodText(i: Invoice): string {
  if (i.billingStart || i.billingEnd) return `${i.billingStart || ''} – ${i.billingEnd || ''}`.trim()
  return ''
}

export const INVOICE_CSV_HEADERS = ['Number', 'Client', 'Project', 'Period', 'Date', 'Due date', 'Status', 'Amount (USD)', 'Paid (USD)', 'Balance (USD)']

/** Selected invoices → spreadsheet rows (headers first). `projectLabel` names every project of a multi-project invoice. */
export function invoiceCsvRows(invoices: Invoice[], projectLabel: (i: Invoice) => string = i => i.projectName || ''): string[][] {
  return [INVOICE_CSV_HEADERS, ...invoices.map(i => [
    i.number || '', i.clientName || '', projectLabel(i), periodText(i), i.date || '', i.dueDate || '',
    statusOf(i).charAt(0).toUpperCase() + statusOf(i).slice(1),
    money(num(i.subtotal)), money(statusOf(i) === 'paid' && !num(i.amountPaid) ? num(i.subtotal) : num(i.amountPaid)), money(invoiceBalance(i)),
  ])]
}

/** File name of one invoice's PDF (pdfFileName makes it safe) */
export const invoicePdfBase = (i: Invoice) => `Invoice-${i.number || 'draft'}`
