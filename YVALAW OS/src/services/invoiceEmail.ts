// Emailing an invoice (Invoices page, Weekly close, Home): template + the invoice as a real PDF, To the client
// and Cc their Invoice CC / billing contacts, through sendEmail (Gmail if connected; failures are shown, never
// silent). Each send is recorded in the change history (logAction).
import type { AppSettings, Client, Invoice } from '../data/types'
import { formatMoney } from '../utils/money'
import { buildInvoiceHTML } from '../utils/invoiceHtml'
import { recipientsLabel } from '../utils/emailList'
import { sendEmail, type SendEmailResult } from './gmail'
import { invoiceRecipients } from './emailRecipients'
import { logAction } from './activityLog'

/** What happened, and who it went to (for the page's message) */
export type InvoiceSendResult = SendEmailResult & { to: string; cc: string[] }

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

/** The client-facing invoice as a PDF attachment (never DOP) */
export async function invoicePdf(inv: Invoice, settings: AppSettings) {
  const { htmlToPdfAttachment } = await import('../utils/pdf')   // PDF code + libraries load only when needed
  return htmlToPdfAttachment(invoiceHtmlFor(inv, settings), `Invoice-${inv.number || 'draft'}`)
}

async function sendWithPdf(kind: 'invoice_emailed' | 'invoice_reminder', inv: Invoice, settings: AppSettings, subject: string, body: string, clients?: Client[]): Promise<InvoiceSendResult> {
  const { to, cc } = await invoiceRecipients(inv, clients)
  if (!to) return { mode: 'failed', attached: false, fallbackReason: `${inv.number} has no client email on file.`, to, cc }
  let pdf
  try { pdf = await invoicePdf(inv, settings) } catch (e) {
    return { mode: 'failed', attached: false, fallbackReason: `The invoice PDF could not be made (${(e as Error).message}). Nothing was sent.`, to, cc }
  }
  const r = await sendEmail(to, subject, body, { attachments: [pdf], cc })
  if (r.mode !== 'failed') {
    const what = kind === 'invoice_emailed' ? `Emailed invoice ${inv.number}` : `Sent a payment reminder for invoice ${inv.number}`
    void logAction(kind, `${what} to ${recipientsLabel(to, cc)}${r.mode === 'mailto' ? ' (opened in the email app)' : ''}`,
      { table: 'invoices', recordId: inv.id, details: { to, cc, via: r.mode } })
  }
  return { ...r, to, cc }
}

/** Email the invoice with the invoice PDF attached */
export function sendInvoiceEmail(inv: Invoice, settings: AppSettings, clients?: Client[]): Promise<InvoiceSendResult> {
  const subject = `Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body = applyInvoiceTemplate(settings.invoiceEmailTemplate || DEFAULT_INVOICE_EMAIL, inv, settings)
  return sendWithPdf('invoice_emailed', inv, settings, subject, body, clients)
}

/** Payment reminder for an unpaid invoice, with the invoice PDF attached */
export function sendReminderEmail(inv: Invoice, settings: AppSettings, clients?: Client[]): Promise<InvoiceSendResult> {
  const subject = `Payment Reminder — Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body = applyInvoiceTemplate(settings.reminderEmailTemplate || DEFAULT_REMINDER_EMAIL, inv, settings)
  return sendWithPdf('invoice_reminder', inv, settings, subject, body, clients)
}

/** "ap@firm.com" or "ap@firm.com (cc accounting@firm.com)" */
export const sentToLabel = (r: { to: string; cc: string[] }) => recipientsLabel(r.to, r.cc)
