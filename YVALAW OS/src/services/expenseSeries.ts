// Repeating expenses — the Expenses page's catch-up (same rules as the daily `expenses-recurring` function,
// see utils/recurringExpenses.ts). Copies are inserted with ON CONFLICT (series_id, series_period) DO NOTHING and
// the database refuses copies already added / after the end date, so this is safe with other windows open.
import { supabase } from '../lib/supabase'
import type { Expense } from '../data/types'
import { planCatchUp } from '../utils/recurringExpenses'

/** Add every copy that is due by `today` (business-zone date). Returns how many were added (0 when nothing was due).
 *  Throws with the database's reason if the insert fails. */
export async function catchUpRecurringExpenses(rows: Expense[], today: string): Promise<number> {
  const plan = planCatchUp(rows.filter(r => r.recurrence), today)
  if (!plan.length) return 0
  const inserts = plan.flatMap(p => p.occurrences.map(o => ({
    id: crypto.randomUUID(), project_id: p.series.projectId || null, description: p.series.description, amount: p.series.amount,
    category: p.series.category || null, date: o.date, series_id: String(p.series.id), series_period: o.period,
  })))
  const { data, error } = await supabase.from('expenses')
    .upsert(inserts, { onConflict: 'series_id,series_period', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  for (const p of plan) {
    // Remember the last copy added (only ever forward — the database enforces it too)
    const { error: e2 } = await supabase.from('expenses').update({ recurrence_through: p.through })
      .eq('id', p.series.id).or(`recurrence_through.is.null,recurrence_through.lt.${p.through}`)
    if (e2) throw new Error(e2.message)
  }
  return (data || []).length
}

/** A database without migrate-expenses-recurring-fees.sql answers "column … does not exist" */
export const isRecurrenceSetupError = (message: string) => /recurrence|series_(id|period)/.test(message) && /column|schema cache/i.test(message)
export const RECURRENCE_SQL = 'Repeating expenses need one database update: run supabase/migrate-expenses-recurring-fees.sql in Supabase, then try again.'
