// Payroll (PLAN.md Step 6). The payroll function prepares a Friday; the browser reads rows (RLS:
// payroll.view / payroll.manage), sets the exchange rate, adds bonuses/deductions and marks people paid
// through the payroll_mark_paid SQL function.
import { supabase } from '../lib/supabase'

export type PayrollRun = { id: string; payday: string; status: 'open' | 'paid'; exchange_rate: number | null; rate_source: string | null; flags: { kind: string; message: string; employeeId?: string; employeeName?: string }[]; prepared_at: string | null; paid_at: string | null }
export type PayrollLine = { id: string; run_id: string; employee_id: string; project_id: string | null; label: string; schedule: string; period_start: string; period_end: string; payday: string
  regular_seconds: number; premium_seconds: number; pay_rate: number; rates: number[]; premium_percent: number; gross_usd: number; adjustments_usd: number; net_usd: number
  net_dop: number | null; exchange_rate: number | null; payout: { method?: string; bank?: string; accountType?: string; account?: string; paypal?: string; currency?: string } | null
  status: 'pending' | 'paid'; paid_on: string | null; reference: string | null }
export type PayrollAdjustment = { id: string; employee_id: string; type: 'bonus' | 'deduction'; amount: number; reason: string; status: 'pending' | 'applied' | 'cancelled'; run_id: string | null; group_id: string | null; sequence: number; total: number; created_at: string }
export type PayoutMethod = { employee_id: string; method: 'bank' | 'paypal'; bank_name: string | null; account_type: 'savings' | 'checking' | null; account_number: string | null; holder_name: string | null; holder_id: string | null; paypal_email: string | null; currency: 'DOP' | 'USD' }

const missing = (e: { code?: string; message: string } | null) => (e ? (e.code === '42P01' ? 'Run supabase/migrate-step6-payroll.sql to turn on payroll.' : e.message) : null)

export async function loadRuns(): Promise<{ rows: PayrollRun[]; error: string | null }> {
  const { data, error } = await supabase.from('payroll_runs').select('*').order('payday', { ascending: false }).limit(60)
  return { rows: (data || []) as PayrollRun[], error: missing(error) }
}
export async function loadLines(runId: string): Promise<PayrollLine[]> {
  const { data } = await supabase.from('payroll_lines').select('*').eq('run_id', runId)
  return ((data || []) as PayrollLine[]).map(l => ({ ...l, gross_usd: Number(l.gross_usd), adjustments_usd: Number(l.adjustments_usd), net_usd: Number(l.net_usd), pay_rate: Number(l.pay_rate), net_dop: l.net_dop == null ? null : Number(l.net_dop) }))
}
export async function preparePayroll(payday: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/payroll', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify({ action: 'prepare', payday }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
}
export async function setExchangeRate(runId: string, rate: number, source: string): Promise<void> {
  const { error } = await supabase.from('payroll_runs').update({ exchange_rate: rate, rate_source: source }).eq('id', runId)
  if (error) throw new Error(error.message)
}
export async function markPaid(lineIds: string[], paidOn: string, reference: string): Promise<number> {
  const { data, error } = await supabase.rpc('payroll_mark_paid', { p_lines: lineIds, p_paid_on: paidOn, p_reference: reference || null })
  if (error) throw new Error(error.message)
  return (data as { paid: number })?.paid ?? 0
}
export async function unmarkPaid(lineId: string): Promise<void> {
  const { error } = await supabase.rpc('payroll_unmark_paid', { p_line: lineId })
  if (error) throw new Error(error.message)
}
export async function loadAdjustments(filter: { runId?: string; employeeId?: string; pendingOnly?: boolean } = {}): Promise<PayrollAdjustment[]> {
  let q = supabase.from('payroll_adjustments').select('*').order('created_at', { ascending: false })
  if (filter.runId) q = q.eq('run_id', filter.runId)
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId)
  if (filter.pendingOnly) q = q.eq('status', 'pending')
  const { data } = await q
  return ((data || []) as PayrollAdjustment[]).map(a => ({ ...a, amount: Number(a.amount) }))
}
/** A bonus or deduction for the next payroll; repeat > 1 = the next N paydays (each used once) */
export async function addAdjustment(a: { employeeId: string; type: 'bonus' | 'deduction'; amount: number; reason: string; repeat: number; runId?: string | null }): Promise<void> {
  const total = Math.max(1, Math.min(52, Math.floor(a.repeat) || 1))
  const group = total > 1 ? crypto.randomUUID() : null
  const rows = Array.from({ length: total }, (_, i) => ({
    employee_id: a.employeeId, type: a.type, amount: Math.round(a.amount * 100) / 100,
    reason: total > 1 ? `${a.reason.trim()} (${i + 1}/${total})` : a.reason.trim(), group_id: group, sequence: i + 1, total,
    run_id: i === 0 ? a.runId ?? null : null,
  }))
  const { error } = await supabase.from('payroll_adjustments').insert(rows)
  if (error) throw new Error(error.message)
}
export async function cancelAdjustment(adj: PayrollAdjustment, wholeGroup = false): Promise<void> {
  const q = supabase.from('payroll_adjustments').update({ status: 'cancelled' }).eq('status', 'pending')
  const { error } = wholeGroup && adj.group_id ? await q.eq('group_id', adj.group_id) : await q.eq('id', adj.id)
  if (error) throw new Error(error.message)
}
export async function loadPayoutMethods(): Promise<PayoutMethod[]> {
  const { data } = await supabase.from('employee_payout_methods').select('*')
  return (data || []) as PayoutMethod[]
}
export async function savePayoutMethod(p: PayoutMethod): Promise<void> {
  const { error } = await supabase.from('employee_payout_methods').upsert({ ...p, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}
/** BHD's rate via InfoDolar (Settings uses the same function): BHD buys USD at `buy` */
export async function fetchBhdRate(): Promise<{ buy: number; sell: number; entity: string }> {
  const res = await fetch('/.netlify/functions/infodolar-bhd')
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.buy) throw new Error(data.error || 'Could not get the BHD rate — enter it by hand.')
  return data
}
export const DR_BANKS = ['BHD', 'Banreservas', 'Banco Popular', 'Scotiabank', 'Banco Santa Cruz', 'Banesco', 'Banco Caribe', 'Banco Promerica', 'Banco BDI', 'Banco López de Haro', 'Banco Vimenca', 'Asociación Popular (APAP)', 'Asociación Cibao', 'Other']
