// Clients list quick actions (2026-11): which invoice "Record payment" / "Copy pay link" use, the tel: link for
// "Call", and the project a "New invoice for this client" starts on. Pure (type imports only) so
// tests/clientQuickActions.test.ts can run it directly.
import type { Client, Invoice, Project } from '../data/types'

const UNPAID = ['sent', 'viewed', 'overdue', 'partial']
const NOT_RUNNING = ['completed', 'cancelled', 'archived', 'closed', 'on-hold', 'paused']

/** Same matching rule as services/crm.ts invoicesOf: by client_id, else by name (older invoices) */
const belongsTo = (c: Pick<Client, 'id' | 'name'>, i: Invoice) => (!!i.clientId && i.clientId === c.id) || i.clientName === c.name
const balance = (i: Invoice) => Math.round(((Number(i.subtotal) || 0) - (Number(i.amountPaid) || 0)) * 100) / 100

/** The client's oldest invoice that was sent and still has a balance (by invoice date, then due date, then number) */
export function oldestOpenInvoice(c: Pick<Client, 'id' | 'name'>, invoices: Invoice[]): Invoice | null {
  const open = invoices.filter(i => belongsTo(c, i) && UNPAID.includes(String(i.status || '').toLowerCase()) && balance(i) > 0.005)
  if (open.length === 0) return null
  const key = (i: Invoice) => i.date || i.dueDate || '9999-12-31'
  return [...open].sort((a, b) => key(a).localeCompare(key(b)) || (a.dueDate || '').localeCompare(b.dueDate || '') || String(a.number || '').localeCompare(String(b.number || '')))[0]
}

/** "+1 (617) 555-0188 ext 2" → "tel:+16175550188"; nothing dialable → null */
export function telHref(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').trim().split(/\s*(?:ext\.?|x|#)\s*\d*$/i)[0]
  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length < 3) return null
  return `tel:${raw.trim().startsWith('+') ? '+' : ''}${digits}`
}

/** A project still running (not completed, cancelled, archived or paused) */
export const isRunningProject = (p: Project) => !NOT_RUNNING.includes(String(p.status || '').toLowerCase())

/** The client's only running project, or null when it has none or several (the builder then asks) */
export function soleRunningProject(projects: Project[], clientId: string): Project | null {
  const mine = projects.filter(p => p.clientId === clientId && isRunningProject(p))
  return mine.length === 1 ? mine[0] : null
}
