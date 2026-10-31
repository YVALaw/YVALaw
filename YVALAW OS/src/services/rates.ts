// Placement rates (PLAN.md Step 2): dated bill/pay rates per person per project.
// Readable/writable only with the rates.manage permission (enforced by the database).
import { supabase } from '../lib/supabase'
import type { Client, Employee, Project } from '../data/types'
import type { RateClient, RateEmployee, RateProject, RateRow } from '../utils/moneyRules'

export type PlacementRate = RateRow & { id: string; note?: string | null; created_at?: string }

export async function loadPlacementRates(filter?: { projectId?: string; employeeId?: string }): Promise<{ rows: PlacementRate[]; error: string | null }> {
  let q = supabase.from('placement_rates').select('id,employee_id,project_id,position,bill_rate,pay_rate,effective_from,note,created_at').order('effective_from', { ascending: false })
  if (filter?.projectId) q = q.eq('project_id', filter.projectId)
  if (filter?.employeeId) q = q.eq('employee_id', filter.employeeId)
  const { data, error } = await q
  if (error) return { rows: [], error: error.code === '42P01' ? 'Run supabase/migrate-step2-rates.sql to turn on per-person rates.' : error.message }
  return { rows: (data || []) as PlacementRate[], error: null }
}

export async function addPlacementRate(r: Omit<PlacementRate, 'id' | 'created_at'>): Promise<void> {
  const { error } = await supabase.from('placement_rates').upsert({
    employee_id: r.employee_id, project_id: r.project_id, position: r.position || null,
    bill_rate: r.bill_rate === '' || r.bill_rate == null ? null : Number(String(r.bill_rate).replace(',', '.')),
    pay_rate: r.pay_rate === '' || r.pay_rate == null ? null : Number(String(r.pay_rate).replace(',', '.')),
    effective_from: r.effective_from, note: r.note || null,
  }, { onConflict: 'employee_id,project_id,effective_from' })
  if (error) throw new Error(error.message)
}

export async function deletePlacementRate(id: string): Promise<void> {
  const { error } = await supabase.from('placement_rates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// camelCase app records → the snake_case shapes the rate rules use
export const rateEmployee = (e: Employee): RateEmployee => ({
  id: e.id, pay_rate: e.payRate ?? null, role: e.role ?? null, premium_enabled: e.premiumEnabled ?? false,
  premium_percent: e.premiumPercent ?? null, premium_start_time: e.premiumStartTime ?? null, timezone: e.timezone ?? null,
})
export const rateProject = (p: Project): RateProject => ({ id: p.id, rate: p.rate ?? null, client_id: p.clientId ?? null })
export const rateClient = (c: Client): RateClient => ({ id: c.id, default_rate: c.defaultRate ?? null })
