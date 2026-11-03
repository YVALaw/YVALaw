/**
 * Repeating expenses — pure date rules (server copy of src/utils/recurringExpenses.ts; tests/recurringExpenses.test.ts
 * checks both agree). Rows use the normalized shape { id, date, recurrence, recurrenceEnd, recurrenceThrough }.
 * See the browser file for the full description of series / copies / series_period.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/
const pad = n => String(n).padStart(2, '0')
const MAX_STEPS = 20000

const isFrequency = v => v === 'weekly' || v === 'monthly' || v === 'yearly'
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

function isIsoDate(v) {
  if (typeof v !== 'string' || !ISO.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

function occurrenceDate(start, freq, n) {
  const [y, m, d] = start.split('-').map(Number)
  if (freq === 'weekly') {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * n))
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
  }
  const months = freq === 'monthly' ? n : 12 * n
  const total = (m - 1) + months
  const y2 = y + Math.floor(total / 12)
  const m2 = ((total % 12) + 12) % 12 + 1
  return `${y2}-${pad(m2)}-${pad(Math.min(d, daysInMonth(y2, m2)))}`
}

const periodKey = (date, freq) => (freq === 'monthly' ? date.slice(0, 7) : freq === 'yearly' ? date.slice(0, 4) : date)

function settings(s) {
  if (!isFrequency(s.recurrence) || !isIsoDate(s.date)) return null
  const through = isIsoDate(s.recurrenceThrough) ? s.recurrenceThrough : null
  const last = through && through > s.date ? through : s.date
  return { start: s.date, freq: s.recurrence, last, end: isIsoDate(s.recurrenceEnd) ? s.recurrenceEnd : null }
}

function dueOccurrences(s, today, max = 60) {
  const cfg = settings(s)
  if (!cfg || !isIsoDate(today)) return []
  const limit = cfg.end && cfg.end < today ? cfg.end : today
  const out = []
  for (let n = 1; n < MAX_STEPS && out.length < max; n++) {
    const date = occurrenceDate(cfg.start, cfg.freq, n)
    if (date > limit) break
    if (date > cfg.last) out.push({ date, period: periodKey(date, cfg.freq) })
  }
  return out
}

function planCatchUp(rows, today, { perSeries = 60, maxTotal = 500 } = {}) {
  const out = []
  let total = 0
  for (const s of rows) {
    if (total >= maxTotal) break
    const occ = dueOccurrences(s, today, Math.min(perSeries, maxTotal - total))
    if (!occ.length) continue
    out.push({ series: s, occurrences: occ, through: occ[occ.length - 1].date })
    total += occ.length
  }
  return out
}

/** Database row (snake_case) → the normalized shape */
const fromRow = r => ({ id: String(r.id), date: r.date ? String(r.date).slice(0, 10) : '', recurrence: r.recurrence ?? null,
  recurrenceEnd: r.recurrence_end ? String(r.recurrence_end).slice(0, 10) : null, recurrenceThrough: r.recurrence_through ? String(r.recurrence_through).slice(0, 10) : null })

/** The new expense row for one copy (no receipt; the database adds created_at) */
function occurrenceRow(seriesRow, occ, id) {
  return {
    id, project_id: seriesRow.project_id ?? null, description: seriesRow.description, amount: seriesRow.amount,
    category: seriesRow.category ?? null, date: occ.date, series_id: String(seriesRow.id), series_period: occ.period,
  }
}

module.exports = { isFrequency, isIsoDate, daysInMonth, occurrenceDate, periodKey, dueOccurrences, planCatchUp, fromRow, occurrenceRow }
