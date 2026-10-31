// Weekly close (PLAN.md Step 4): the week-close function prepares/approves; the page reads rows
// directly (RLS: weekly_close.manage) and records time adjustments.
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/pages'
import type { Invoice } from '../data/types'
import { addDays, DEFAULT_TZ, localParts, mondayOf, zonedMidnight } from '../utils/moneyRules'

export type WeekFlag = { kind: string; message: string; employeeId?: string; employeeName?: string; projectId?: string | null; workType?: string | null; clientId?: string; seconds?: number; byDay?: Record<string, number>; days?: string[] }
export type WeekClose = { id: string; weekStart: string; weekEnd: string; status: 'preparing' | 'ready' | 'approved'; preparedAt: string | null; approvedAt: string | null
  summary: { label?: string; invoices?: number; total?: number; billableSeconds?: number; people?: number; payrollTotal?: number; flags?: number; firstPreparedAt?: string }
  flags: WeekFlag[]; payroll: { employeeId: string; employeeName: string; seconds: number; premiumSeconds: number; amount: number; missingRate: boolean }[] }
export type WeekBlock = { employee_id: string; block_start: string; project_id: string | null; work_type: string | null; seconds: number; status: string; created_at: string }
export type Adjustment = { id: string; employee_id: string; project_id: string | null; work_type: string | null; day: string; seconds_delta: number; kind: string; note: string; status: string; group_id: string | null; created_at: string }

export const lastFinishedWeek = (tz = DEFAULT_TZ) => addDays(mondayOf(localParts(Date.now(), tz).date), -7)

const toClose = (r: Record<string, unknown>): WeekClose => ({ id: r.id as string, weekStart: r.week_start as string, weekEnd: r.week_end as string, status: r.status as WeekClose['status'],
  preparedAt: (r.prepared_at as string) ?? null, approvedAt: (r.approved_at as string) ?? null, summary: (r.summary as WeekClose['summary']) || {}, flags: (r.flags as WeekFlag[]) || [],
  payroll: (r.payroll_preview as WeekClose['payroll']) || [] })

export async function loadWeekCloses(): Promise<{ rows: WeekClose[]; error: string | null }> {
  const { data, error } = await supabase.from('week_closes').select('*').order('week_start', { ascending: false }).limit(52)
  if (error) return { rows: [], error: error.code === '42P01' ? 'Run supabase/migrate-step4-weekly-close.sql to turn on the weekly close.' : error.message }
  return { rows: (data || []).map(r => toClose(r as Record<string, unknown>)), error: null }
}

export async function callWeekClose(action: 'prepare' | 'approve', weekStart: string): Promise<unknown> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/week-close', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify({ action, weekStart }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const camel = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v]))
export async function loadWeekInvoices(closeId: string): Promise<Invoice[]> {
  const { data } = await supabase.from('invoices').select('*').eq('week_close_id', closeId).order('number')
  return (data || []).map(r => camel(r as Record<string, unknown>) as unknown as Invoice)
}
export async function markInvoiceSent(inv: Invoice): Promise<void> {
  const history = [...(inv.statusHistory || []), { status: 'sent', changedAt: Date.now() }]
  const { error } = await supabase.from('invoices').update({ status: 'sent', status_history: history }).eq('id', inv.id).eq('status', 'draft')
  if (error) throw new Error(error.message)
}

export async function loadWeekBlocks(weekStart: string, tz = DEFAULT_TZ): Promise<WeekBlock[]> {
  const from = new Date(zonedMidnight(weekStart, tz)).toISOString(), to = new Date(zonedMidnight(addDays(weekStart, 7), tz)).toISOString()
  const { data } = await fetchAllPages<WeekBlock>((a, b) => supabase.from('tracker_blocks').select('employee_id,block_start,project_id,work_type,seconds,status,created_at')
    .gte('block_start', from).lt('block_start', to).in('status', ['tracked', 'approved']).order('id').range(a, b))
  return (data || []) as WeekBlock[]
}
export async function loadAdjustments(weekStart: string): Promise<Adjustment[]> {
  const { data } = await supabase.from('time_adjustments').select('*').gte('day', weekStart).lte('day', addDays(weekStart, 7)).order('created_at')
  return (data || []) as Adjustment[]
}
export async function addAdjustment(a: { employeeId: string; projectId: string | null; workType: string | null; day: string; seconds: number; note: string }): Promise<void> {
  const { error } = await supabase.from('time_adjustments').insert({ employee_id: a.employeeId, project_id: a.projectId, work_type: a.projectId ? null : a.workType,
    day: a.day, seconds_delta: Math.round(a.seconds), kind: 'edit', note: a.note.trim() })
  if (error) throw new Error(error.message)
}
/** Move time to next week: −seconds on its day, +seconds on next Monday (same group) */
export async function moveToNextWeek(a: { employeeId: string; projectId: string | null; workType: string | null; day: string; seconds: number; note: string; weekStart: string }): Promise<void> {
  const group = crypto.randomUUID()
  const base = { employee_id: a.employeeId, project_id: a.projectId, work_type: a.projectId ? null : a.workType, note: a.note.trim(), group_id: group }
  const { error } = await supabase.from('time_adjustments').insert([
    { ...base, day: a.day, seconds_delta: -Math.round(a.seconds), kind: 'defer_out' },
    { ...base, day: addDays(a.weekStart, 7), seconds_delta: Math.round(a.seconds), kind: 'defer_in' },
  ])
  if (error) throw new Error(error.message)
}
export async function cancelAdjustment(adj: Adjustment): Promise<void> {
  const q = supabase.from('time_adjustments').update({ status: 'cancelled' })
  const { error } = adj.group_id ? await q.eq('group_id', adj.group_id) : await q.eq('id', adj.id)
  if (error) throw new Error(error.message)
}
