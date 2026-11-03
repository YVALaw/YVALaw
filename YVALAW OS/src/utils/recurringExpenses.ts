// Repeating expenses (rent, software…) — pure date rules, no I/O.
// The server copy is netlify/functions/_lib/recurringExpenses.cjs (daily `expenses-recurring` function);
// tests/recurringExpenses.test.ts checks both agree.
//
// A series is one expense row with `recurrence` set: that row is the first entry (its `date` is the start).
// Each later period gets its own expense row ("copy") with series_id = the series row's id and series_period =
// the period key (monthly 'YYYY-MM', yearly 'YYYY', weekly the date). The database has a unique key on
// (series_id, series_period), so a copy can never be added twice — two windows, a reload and the daily function
// can all run at once. `recurrence_through` on the series row remembers the date of the last copy added, so a
// copy someone deleted is never added again (the database refuses copies on or before that date).

export type Frequency = 'weekly' | 'monthly' | 'yearly'
export const FREQUENCIES: Frequency[] = ['monthly', 'weekly', 'yearly']

export type SeriesLike = {
  id: string
  date: string                       // first entry = start date (YYYY-MM-DD)
  recurrence?: string | null
  recurrenceEnd?: string | null      // last day a copy may fall on (inclusive); null = keeps going
  recurrenceThrough?: string | null  // date of the last copy added; null = only the first entry exists
}
export type Occurrence = { date: string; period: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/
const pad = (n: number) => String(n).padStart(2, '0')

export function isFrequency(v: unknown): v is Frequency {
  return v === 'weekly' || v === 'monthly' || v === 'yearly'
}

/** A real calendar date in YYYY-MM-DD form */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The n-th entry of a series (n = 0 is the start). Monthly/yearly keep the start's day of the month,
 *  clamped to the month's last day (Jan 31 → Feb 28/29 → Mar 31); weekly adds 7 days each time. */
export function occurrenceDate(start: string, freq: Frequency, n: number): string {
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

export function periodKey(date: string, freq: Frequency): string {
  return freq === 'monthly' ? date.slice(0, 7) : freq === 'yearly' ? date.slice(0, 4) : date
}

/** Valid series settings, or null (not a series / bad start date) */
function settings(s: SeriesLike): { start: string; freq: Frequency; last: string; end: string | null } | null {
  if (!isFrequency(s.recurrence) || !isIsoDate(s.date)) return null
  const through = isIsoDate(s.recurrenceThrough) ? s.recurrenceThrough : null
  // The first entry itself covers the start date; a start moved later than the last copy starts from there
  const last = through && through > s.date ? through : s.date
  return { start: s.date, freq: s.recurrence, last, end: isIsoDate(s.recurrenceEnd) ? s.recurrenceEnd : null }
}

const MAX_STEPS = 20000   // ~380 years of weeks: a typo'd start year can't loop forever

/**
 * Copies that are due on `today` and not added yet: after the last one added, on or before today and the end
 * date. At most `max` per call (the rest come on the next run), oldest first.
 */
export function dueOccurrences(s: SeriesLike, today: string, max = 60): Occurrence[] {
  const cfg = settings(s)
  if (!cfg || !isIsoDate(today)) return []
  const limit = cfg.end && cfg.end < today ? cfg.end : today
  const out: Occurrence[] = []
  for (let n = 1; n < MAX_STEPS && out.length < max; n++) {
    const date = occurrenceDate(cfg.start, cfg.freq, n)
    if (date > limit) break
    if (date > cfg.last) out.push({ date, period: periodKey(date, cfg.freq) })
  }
  return out
}

/** The next date a copy will be added (after today and after the last one added), or null if the series ended */
export function nextOccurrence(s: SeriesLike, today: string): string | null {
  const cfg = settings(s)
  if (!cfg || !isIsoDate(today)) return null
  const after = cfg.last > today ? cfg.last : today
  for (let n = 1; n < MAX_STEPS; n++) {
    const date = occurrenceDate(cfg.start, cfg.freq, n)
    if (cfg.end && date > cfg.end) return null
    if (date > after) return date
  }
  return null
}

/** Still adding copies (no end date, or the end date is today or later) */
export function seriesActive(s: SeriesLike, today: string): boolean {
  if (!settings(s)) return false
  return !isIsoDate(s.recurrenceEnd) || s.recurrenceEnd >= today
}

/** What every due copy of every series needs: the rows to insert and the new "last copy added" date per series.
 *  `maxTotal` caps one run (a page load or the daily function). */
export function planCatchUp<T extends SeriesLike>(rows: T[], today: string, { perSeries = 60, maxTotal = 500 } = {}):
  { series: T; occurrences: Occurrence[]; through: string }[] {
  const out: { series: T; occurrences: Occurrence[]; through: string }[] = []
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

/** YYYY-MM-DD plus n days */
export function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/**
 * Restarting a stopped series (end date in the past, now cleared or moved later) skips the time it was stopped:
 * returns the new "last copy added" (yesterday), so only today's copy (if due) and later ones are added — never a
 * backlog for the stopped months. undefined = nothing to change.
 */
export function restartThrough(prev: SeriesLike | undefined, nextEnd: string | null, today: string): string | undefined {
  if (!prev || !isFrequency(prev.recurrence) || !isIsoDate(prev.recurrenceEnd) || prev.recurrenceEnd >= today) return undefined
  if (nextEnd && nextEnd <= prev.recurrenceEnd) return undefined
  const yesterday = addDaysIso(today, -1)
  return isIsoDate(prev.recurrenceThrough) && prev.recurrenceThrough >= yesterday ? undefined : yesterday
}

export const frequencyLabel =(f: Frequency | string | null | undefined) =>
  f === 'weekly' ? 'Weekly' : f === 'yearly' ? 'Yearly' : f === 'monthly' ? 'Monthly' : ''
export const everyLabel = (f: Frequency | string | null | undefined) =>
  f === 'weekly' ? 'every week' : f === 'yearly' ? 'every year' : f === 'monthly' ? 'every month' : ''
