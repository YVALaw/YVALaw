// Invoice lines come in two kinds (InvoiceItem.kind):
//   'hours' (or no kind — every invoice saved before item lines existed): a person × hours × hourly rate.
//   'item': a fixed-price line — description × qty × unit price (`rate`), e.g. from an accepted estimate.
// Item lines are stored with hoursTotal 0 and no employee, and every payroll / statement / hours
// calculation skips them (hourLines / isItemLine), so they never count as worked time or pay anybody.
// No imports besides types: the unit tests run this file directly under node.
import type { EstimateItem, InvoiceItem } from '../data/types'

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const cents = (n: number) => Math.round(n * 100) / 100

/** A fixed-price line (description × qty × price), never hours */
export const isItemLine = (it: Pick<InvoiceItem, 'kind'> | null | undefined): boolean => it?.kind === 'item'

/** Only the person/hours lines of an invoice — use this for every hours, payroll and statement sum */
export function hourLines<T extends Pick<InvoiceItem, 'kind'>>(items: T[] | null | undefined): T[] {
  return Array.isArray(items) ? items.filter(it => !isItemLine(it)) : []
}

/** What one line bills: qty × price for item lines; for hours lines the stored bill amount (night premium included)
 *  when there is one, else hours × rate */
export function lineAmount(it: InvoiceItem): number {
  if (isItemLine(it)) return num(it.qty) * num(it.rate)
  if (it.billAmount != null && Number.isFinite(Number(it.billAmount))) return Number(it.billAmount)
  return num(it.hoursTotal) * num(it.rate)
}

/** Σ of item lines only (qty × price), to the cent */
export function itemLinesSubtotal(items: InvoiceItem[] | null | undefined): number {
  return cents((items || []).filter(isItemLine).reduce((s, it) => s + lineAmount(it), 0))
}

/** "$1,250.00" */
export const lineMoney = (n: number) => `$${num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "2" / "1.5" — a quantity without trailing zeros */
export const qtyText = (q: unknown) => String(Math.round(num(q) * 1000) / 1000)

/** "Website setup · 2 × $150.00" */
export function itemLineLabel(it: InvoiceItem): string {
  return `${it.description || 'Item'} · ${qtyText(it.qty)} × ${lineMoney(num(it.rate))}`
}

/** A fixed-price invoice line (hoursTotal 0, no employee) */
export function makeItemLine(description: string, qty: number, unitPrice: number): InvoiceItem {
  return { kind: 'item', description: description.trim() || 'Item', qty: num(qty), rate: num(unitPrice), employeeName: '', hoursTotal: 0 }
}

/** Estimate lines → invoice item lines (blank rows skipped, as the estimate's own total does) */
export function itemLinesFromEstimate(items: EstimateItem[] | null | undefined): InvoiceItem[] {
  return (items || []).filter(i => (i.description || '').trim() || num(i.qty) || num(i.unitPrice))
    .map(i => makeItemLine(i.description || '', num(i.qty), num(i.unitPrice)))
}
