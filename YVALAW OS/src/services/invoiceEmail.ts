// Emailing an invoice (Invoices page, Weekly close): template + attached invoice, through sendEmail
// (Gmail if connected; failures are shown, never silent).
import type { AppSettings, Invoice } from '../data/types'
import { formatMoney } from '../utils/money'
import { buildInvoiceHTML } from '../utils/invoiceHtml'
import { sendEmail, type SendEmailResult } from './gmail'

export const DEFAULT_INVOICE_EMAIL = `Hi {clientName},\n\nPlease find attached invoice {invoiceNumber} for {amount}.\n\nBilling period: {period}\n{dueDate}\nPlease don't hesitate to reach out with any questions.\n\n{companyName}`
export const DEFAULT_REMINDER_EMAIL = `Hi {clientName},\n\nThis is a friendly reminder that invoice {invoiceNumber} for {amount} is past due.\n\nOriginal due date: {dueDate}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n{companyName}`

export function applyInvoiceTemplate(template: string, inv: Invoice, settings: AppSettings): string {
  const period = `${inv.billingStart || inv.date || '—'} – ${inv.billingEnd || ''}`
  return template
    .replace(/\{clientName\}/g,    inv.clientName || 'Client')
    .replace(/\{invoiceNumber\}/g, inv.number || '')
    .replace(/\{amount\}/g,        formatMoney(Number(inv.subtotal) || 0))
    .replace(/\{dueDate\}/g,       inv.dueDate ? `Due date: ${inv.dueDate}` : '')
    .replace(/\{period\}/g,        period)
    .replace(/\{companyName\}/g,   settings.emailSignature || settings.companyName || 'YVA Staffing')
}

export function invoiceHtmlFor(inv: Invoice, settings: AppSettings, autoPrint = false): string {
  // Client-facing: never DOP (rate 0)
  return buildInvoiceHTML(inv, { rate: 0, companyName: settings.companyName, companyAddress: settings.companyAddress,
    companyEmail: settings.companyEmail, companyPhone: settings.companyPhone, autoPrint })
}

/** Email the invoice with the invoice attached */
export function sendInvoiceEmail(inv: Invoice, settings: AppSettings): Promise<SendEmailResult> {
  const subject = `Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body = applyInvoiceTemplate(settings.invoiceEmailTemplate || DEFAULT_INVOICE_EMAIL, inv, settings)
  return sendEmail(inv.clientEmail || '', subject, body, { name: `invoice-${inv.number}.html`, content: invoiceHtmlFor(inv, settings), mimeType: 'text/html' })
}
