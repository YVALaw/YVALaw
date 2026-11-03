// When does the weekly reminder email go out next? Same rule as isDue() in netlify/functions/_lib/weeklyReminder.cjs
// (chosen weekday, from the chosen hour on, business time zone, once per Monday–Sunday week); tests/weeklyReminder.test.ts
// checks the two agree hour by hour. No imports, so the Node tests can load it directly.

export type NextReminder = { date: string; hour: number; catchUp: boolean }

const DEFAULT_TZ = 'America/Santo_Domingo'
function zoneOr(tz?: string | null): string {
  const t = String(tz || '').trim()
  if (!t) return DEFAULT_TZ
  try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return t } catch { return DEFAULT_TZ }
}
function parts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const m = Object.fromEntries(f.formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  return { date: `${m.year}-${m.month}-${m.day}`, hour: Number(m.hour), weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[m.weekday] }
}
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7))

/** The next send as a business-zone date + hour. `catchUp` = due now (it goes at the next hourly check, within the hour). */
export function nextReminder({ day, hour, lastSent }: { day: number; hour: number; lastSent?: string | null }, now: number, tz?: string | null): NextReminder {
  const zone = zoneOr(tz)
  const p = parts(now, zone)
  const thisWeek = mondayOf(p.date)
  const last = lastSent ? Date.parse(lastSent) : NaN
  const sentThisWeek = Number.isFinite(last) && mondayOf(parts(last, zone).date) === thisWeek
  let date = addDays(p.date, (day - p.weekday + 7) % 7)
  if (sentThisWeek && mondayOf(date) === thisWeek) date = addDays(date, 7)
  return { date, hour, catchUp: date === p.date && p.hour >= hour }
}

/** "Monday, Nov 9" for a YYYY-MM-DD */
export const reminderDateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })
