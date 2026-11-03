/**
 * expenses-recurring — Netlify scheduled function, daily 04:30 UTC (12:30 am Dominican time).
 * Adds the copies of repeating expenses (Finance → Expenses, "Repeats") that are due today or earlier.
 * The Expenses page runs the same catch-up when it opens, so copies also appear before this first runs.
 *
 * Safe to run any number of times, alongside open Expenses pages: copies are inserted with
 * ON CONFLICT (series_id, series_period) DO NOTHING, and the database refuses copies on or before the
 * series' recurrence_through (so a copy someone deleted never comes back) or after its end date.
 * One small read per day (series rows only, partial index). Rules: _lib/recurringExpenses.cjs.
 *
 * Needs supabase/migrate-expenses-recurring-fees.sql (before it runs, this answers 200 "not set up").
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const crypto = require('crypto')
const { rest, enc } = require('./_lib/supa.cjs')
const M = require('./_lib/money.cjs')
const R = require('./_lib/recurringExpenses.cjs')

const notSetUp = e => /recurrence|series_|column|42703|PGRST204/i.test(e?.message || '')

async function run(today = M.localParts(Date.now()).date) {
  let rows
  try {
    rows = await rest('expenses?recurrence=not.is.null&select=id,project_id,description,amount,category,date,recurrence,recurrence_end,recurrence_through&order=id&limit=1000')
  } catch (e) {
    if (notSetUp(e)) return { setUp: false, added: 0, series: 0 }
    throw e
  }
  const byId = new Map(rows.map(r => [String(r.id), r]))
  const plan = R.planCatchUp(rows.map(R.fromRow), today)
  if (!plan.length) return { setUp: true, added: 0, series: 0 }
  const inserts = plan.flatMap(p => p.occurrences.map(o => R.occurrenceRow(byId.get(p.series.id), o, crypto.randomUUID())))
  const added = await rest('expenses?on_conflict=series_id,series_period', { method: 'POST', body: inserts, prefer: 'resolution=ignore-duplicates,return=representation' })
  for (const p of plan) {
    // Only ever moves forward (also enforced by a trigger)
    await rest(`expenses?id=eq.${enc(p.series.id)}&or=(recurrence_through.is.null,recurrence_through.lt.${p.through})`,
      { method: 'PATCH', body: { recurrence_through: p.through }, prefer: 'return=minimal' })
  }
  return { setUp: true, added: Array.isArray(added) ? added.length : 0, series: plan.length }
}

exports.handler = async function handler() {
  try {
    const out = await run()
    if (!out.setUp) return { statusCode: 200, body: 'Repeating expenses are not set up yet: run supabase/migrate-expenses-recurring-fees.sql' }
    return { statusCode: 200, body: JSON.stringify(out) }
  } catch (e) {
    console.error('expenses-recurring', e)
    return { statusCode: 500, body: String(e.message || e) }
  }
}

exports._test = { run }
