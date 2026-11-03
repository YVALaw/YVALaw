// Client payments (PLAN.md Step 5). Each payment updates the invoice's amount paid and status
// in the database (trigger), so the app only inserts / deletes rows.
import { supabase } from '../lib/supabase'

/** kind: payment (> 0) · refund / dispute (< 0, written by the Stripe webhook) */
export type ClientPayment = { id: string; invoiceId: string; clientId: string | null; paidOn: string; amount: number; method: string; reference: string | null; note: string | null; source: string; kind: 'payment' | 'refund' | 'dispute'; stripeChargeId: string | null; createdAt: string }
export const PAYMENT_METHODS = [
  { value: 'wire', label: 'Wire transfer' }, { value: 'ach', label: 'ACH' }, { value: 'zelle', label: 'Zelle' }, { value: 'check', label: 'Check' },
  { value: 'card', label: 'Card' }, { value: 'paypal', label: 'PayPal' }, { value: 'cash', label: 'Cash' }, { value: 'other', label: 'Other' },
]
const fromRow = (r: Record<string, unknown>): ClientPayment => ({ id: r.id as string, invoiceId: r.invoice_id as string, clientId: (r.client_id as string) ?? null,
  paidOn: r.paid_on as string, amount: Number(r.amount), method: r.method as string, reference: (r.reference as string) ?? null, note: (r.note as string) ?? null,
  source: r.source as string, kind: ((r.kind as string) || 'payment') as ClientPayment['kind'], stripeChargeId: (r.stripe_charge_id as string) ?? null, createdAt: r.created_at as string })

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

/** Which of these invoices have any payment row (bulk delete keeps those). One small read: invoice_id only, in
 *  chunks of 100 ids. No payments table yet (SQL not run) → none; any other error throws (the caller stops). */
export async function invoiceIdsWithPayments(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('client_payments').select('invoice_id').in('invoice_id', ids.slice(i, i + 100))
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') return out
      throw new Error(`Could not check payments: ${error.message}`)
    }
    for (const r of data || []) out.add(String((r as { invoice_id: string }).invoice_id))
  }
  return out
}

/** The invoice's amount paid + status after payments changed (the database computed them) */
export async function loadInvoicePaidState(invoiceId: string): Promise<{ amountPaid: number; status: string } | null> {
  const { data } = await supabase.from('invoices').select('amount_paid,status').eq('id', invoiceId).maybeSingle()
  return data ? { amountPaid: Number((data as { amount_paid: number }).amount_paid) || 0, status: (data as { status: string }).status } : null
}

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Please sign in again.')
  const res = await fetch(`/.netlify/functions/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

/** What is still refundable on a Stripe payment (minus refunds / disputes already recorded against its charge) */
export function refundableLeft(p: ClientPayment, all: ClientPayment[]): number {
  if (p.source !== 'stripe' || p.kind !== 'payment') return 0
  const taken = p.stripeChargeId ? all.filter(x => x.kind !== 'payment' && x.stripeChargeId === p.stripeChargeId).reduce((s, x) => s + x.amount, 0) : 0
  return Math.max(0, Math.round((p.amount + taken) * 100) / 100)
}

/** Refund a Stripe payment (permission payments.refund). The refund row appears when Stripe confirms it (webhook). */
export function refundStripePayment(paymentId: string, amount?: number, reason?: string) {
  // A new id for every refund the person asks for (Stripe treats a repeat of the same id as the same refund)
  return callFunction<{ ok: boolean; refundId: string; status: string; amount: number }>('refund-payment', { paymentId, amount, reason, requestId: crypto.randomUUID() })
}

/** A "Pay now" link for an invoice (card or bank, no portal login); expires in 60 days */
export function createPayLink(invoiceId: string) {
  return callFunction<{ url: string; expiresAt: string }>('pay-link', { invoiceId })
}
