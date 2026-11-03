// One invoice can cover several projects of the same client (2026-11). The invoice keeps its main project in
// `projectId` / `projectName` (the first one — what it is grouped and numbered under, as before) and lists every
// project in `projectIds`; each hours line carries its own `projectId` / `projectName`. Item lines and lines
// without a project belong to the main project. Older invoices (one project, no line projects) behave exactly
// as before: one share = the whole invoice.
// Totals per project split the invoice by line, so a two-project invoice is never counted twice.
// No runtime imports: the unit tests run this file directly under node.
import type { Invoice, InvoiceItem } from '../data/types'

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const cents = (n: number) => Math.round(n * 100) / 100
const isItem = (it: InvoiceItem) => it?.kind === 'item'

/** What one line bills — the same rule as utils/invoiceLines.ts `lineAmount` (the tests check they agree) */
export function lineBill(it: InvoiceItem): number {
  if (isItem(it)) return num(it.qty) * num(it.rate)
  if (it.billAmount != null && Number.isFinite(Number(it.billAmount))) return Number(it.billAmount)
  return num(it.hoursTotal) * num(it.rate)
}

type Ref = { id: string; name?: string }
export type ProjectShare = { projectId: string | null; projectName: string; amount: number; hours: number; lines: number }

/** Every project the invoice covers: the main one first, then the listed ones, then any a line names */
export function invoiceProjectIds(inv: Pick<Invoice, 'projectId' | 'projectIds' | 'items'>): string[] {
  const out: string[] = []
  const add = (id: unknown) => { if (typeof id === 'string' && id && !out.includes(id)) out.push(id) }
  add(inv.projectId)
  for (const id of inv.projectIds || []) add(id)
  for (const it of inv.items || []) add(it?.projectId)
  return out
}

export const isMultiProject = (inv: Pick<Invoice, 'projectId' | 'projectIds' | 'items'>) => invoiceProjectIds(inv).length > 1
/** "+1 project" tag count on the Invoices page */
export const extraProjectCount = (inv: Pick<Invoice, 'projectId' | 'projectIds' | 'items'>) => Math.max(0, invoiceProjectIds(inv).length - 1)

/** Does this invoice bill (part of) the project? Older invoices may only have the project's name. */
export function invoiceCoversProject(inv: Invoice, p: Ref): boolean {
  if (inv.projectId === p.id || (!!p.name && inv.projectName === p.name)) return true
  return invoiceProjectIds(inv).includes(p.id)
}

/** The invoice split by project. Amounts add up to the invoice total (rounding goes to the main project). */
export function projectShares(inv: Invoice, nameOf: (id: string) => string | undefined = () => undefined): ProjectShare[] {
  const items = Array.isArray(inv.items) ? inv.items : []
  const subtotal = num(inv.subtotal)
  const hoursOf = (it: InvoiceItem) => (isItem(it) ? 0 : num(it.hoursTotal))
  const ids = invoiceProjectIds(inv)
  if (ids.length <= 1) {
    const id = inv.projectId || ids[0] || null
    return [{ projectId: id, projectName: inv.projectName || (id ? nameOf(id) : '') || '', amount: subtotal, hours: items.reduce((s, it) => s + hoursOf(it), 0), lines: items.length }]
  }
  const main = inv.projectId || ids[0]
  const map = new Map<string, ProjectShare>()
  // Names as invoiced (the invoice / its lines), else today's project name
  for (const id of ids) map.set(id, { projectId: id, projectName: id === main ? (inv.projectName || '') : '', amount: 0, hours: 0, lines: 0 })
  let linesTotal = 0
  for (const it of items) {
    const s = map.get(it.projectId || main)!
    if (!s.projectName && it.projectName) s.projectName = it.projectName
    const a = lineBill(it)
    s.amount += a; s.hours += hoursOf(it); s.lines += 1
    linesTotal += a
  }
  map.get(main)!.amount += subtotal - linesTotal   // whatever the lines don't explain (rounding, a typed total) stays on the main project
  return [...map.values()].filter(s => s.projectId === main || s.lines > 0)
    .map(s => ({ ...s, projectName: s.projectName || (s.projectId ? nameOf(s.projectId) : '') || '', amount: cents(s.amount) }))
}

/** This project's part of the invoice (null = the invoice doesn't cover it) */
export function projectShareOf(inv: Invoice, p: Ref): ProjectShare | null {
  if (!invoiceCoversProject(inv, p)) return null
  const shares = projectShares(inv)
  if (!isMultiProject(inv)) return shares[0]
  return shares.find(s => s.projectId === p.id) ?? { projectId: p.id, projectName: p.name || '', amount: 0, hours: 0, lines: 0 }
}

/** Share of the invoice that belongs to the project, 0–1 (to split amount paid / balance the same way) */
export function projectFraction(inv: Invoice, p: Ref): number {
  const s = projectShareOf(inv, p)
  if (!s) return 0
  const total = num(inv.subtotal)
  if (!isMultiProject(inv)) return 1
  return total ? s.amount / total : 0
}

/** "Intake Team + Demand Desk" (names of every project the invoice covers) */
export function projectNamesLabel(inv: Invoice, nameOf: (id: string) => string | undefined = () => undefined, sep = ' + '): string {
  return projectShares(inv, nameOf).map(s => s.projectName).filter(Boolean).join(sep) || inv.projectName || ''
}

/** Lines grouped by project in order of first appearance (for the PDF's project headers). One group = no headers. */
export function linesByProject(inv: Invoice): { projectId: string | null; projectName: string; items: InvoiceItem[] }[] {
  const items = Array.isArray(inv.items) ? inv.items : []
  if (!isMultiProject(inv)) return [{ projectId: inv.projectId || null, projectName: inv.projectName || '', items }]
  const main = inv.projectId || invoiceProjectIds(inv)[0]
  const groups: { projectId: string | null; projectName: string; items: InvoiceItem[] }[] = []
  for (const it of items) {
    const id = it.projectId || main
    let g = groups.find(x => x.projectId === id)
    if (!g) { g = { projectId: id, projectName: '', items: [] }; groups.push(g) }
    if (!g.projectName) g.projectName = it.projectName || (id === main ? inv.projectName || '' : '')
    g.items.push(it)
  }
  return groups
}

/** Next number the database would give a client-level invoice (next_client_invoice_number): PREFIX-0001 style,
 *  never below a number already used. Only a preview — the real number comes from the database when saving. */
export function clientNumberPreview(prefix: string | null | undefined, nextSeq: number | null | undefined, numbers: (string | undefined)[]): string | null {
  const p = (prefix || '').trim().toUpperCase()
  if (!p) return null
  const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`)
  const used = numbers.reduce((m, n) => { const x = (n || '').match(re); return x ? Math.max(m, parseInt(x[1], 10)) : m }, 0)
  const seq = Math.max(num(nextSeq) || 1, used + 1)
  return `${p}-${String(seq).padStart(4, '0')}`
}
