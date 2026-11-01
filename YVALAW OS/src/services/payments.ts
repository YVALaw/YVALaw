// Client payments (PLAN.md Step 5). Each payment updates the invoice's amount paid and status
// in the database (trigger), so the app only inserts / deletes rows.
import { supabase } from '../lib/supabase'

export type ClientPayment = { id: string; invoiceId: string; clientId: string | null; paidOn: string; amount: number; method: string; reference: string | null; note: string | null; source: string; createdAt: string }
export const PAYMENT_METHODS = [
  { value: 'wire', label: 'Wire transfer' }, { value: 'ach', label: 'ACH' }, { value: 'zelle', label: 'Zelle' }, { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' }, { value: 'paypal', label: 'PayPal' }, { value: 'cash', label: 'Cash' }, { value: 'other', label: 'Other' },
]
const fromRow = (r: Record<string, unknown>): ClientPayment => ({ id: r.id as string, invoiceId: r.invoice_id as string, clientId: (r.client_id as string) ?? null,
  paidOn: r.paid_on as string, amount: Number(r.amount), method: r.method as string, reference: (r.reference as string) ?? null, note: (r.note as string) ?? null,
  source: r.source as string, createdAt: r.created_at as string })

export async function loadPayments(filter: { invoiceId?: string; from?: string; to?: string } = {}): Promise<{ rows: ClientPayment[]; error: string | null }> {
  let q = supabase.from('client_payments').select('*').order('paid_on', { ascending: false })
  if (filter.invoiceId) q = q.eq('invoice_id', filter.invoiceId)
  if (filter.from) q = q.gte('paid_on', filter.from)
  if (filter.to) q = q.lte('paid_on', filter.to)
  const { data, error } = await q
  if (error) return { rows: [], error: error.code === '42P01' ? 'Run supabase/migrate-step4-weekly-close.sql to record payments.' : error.message }
  return { rows: (data || []).map(r => fromRow(r as Record<string, unknown>)), error: null }
}

export async function recordPayment(p: { invoiceId: string; clientId?: string | null; paidOn: string; amount: number; method: string; reference?: string; note?: string }): Promise<void> {
  const { error } = await supabase.from('client_payments').insert({
    invoice_id: p.invoiceId, client_id: p.clientId || null, paid_on: p.paidOn, amount: Math.round(p.amount * 100) / 100,
    method: p.method, reference: p.reference?.trim() || null, note: p.note?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function deletePayment(id: string): Promise<void> {
  const { error } = await supabase.from('client_payments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** The invoice's amount paid + status after payments changed (the database computed them) */
export async function loadInvoicePaidState(invoiceId: string): Promise<{ amountPaid: number; status: string } | null> {
  const { data } = await supabase.from('invoices').select('amount_paid,status').eq('id', invoiceId).maybeSingle()
  return data ? { amountPaid: Number((data as { amount_paid: number }).amount_paid) || 0, status: (data as { status: string }).status } : null
}
