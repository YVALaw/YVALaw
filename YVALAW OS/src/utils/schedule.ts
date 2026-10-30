// Schedule report (Time Tracking → Schedule): each person's shift vs. when YVA Time shows
// they actually started and stopped. Pure logic, no React.
//
// • Shift times come from the employee profile ("Default shift", e.g. 9:00 am – 5:00 pm),
//   read in the viewer's time zone (same as the desktop app's shift reminders).
//   Mon–Fri are shift days; Saturday/Sunday work shows as an extra day.
// • Overnight shifts work: time is grouped into "work days" that begin 4 hours before the
//   shift starts (a 4 pm – 12 am shift's work day runs noon to noon).
// • First/last moment come from first_offset/last_offset (the exact second inside each
//   10-minute block, YVA Time 0.3+); older rows fall back to the block's start.

export type ScheduleBlock = {
  blockStart: number
  seconds: number
  firstOffset: number | null
  lastOffset: number | null
}

export type DayStatus =
  | 'on-time' | 'late' | 'left-early' | 'late-left-early'
  | 'absent' | 'not-started' | 'upcoming' | 'in-progress' | 'outside-shift'
  | 'day-off' | 'extra-day' | 'worked' | 'none'

export type ScheduleDay = {
  day: string                 // yyyy-mm-dd of the work day
  shiftStart: number | null   // ms (null on days off / no shift set)
  shiftEnd: number | null
  firstAt: number | null      // first tracked second
  lastAt: number | null       // end of the last tracked second
  seconds: number
  lateMin: number             // minutes after shift start (0 = on time)
  earlyMin: number            // minutes before shift end (0 = stayed)
  status: DayStatus
}

/** "9:00 am", "9am", "4:30 PM", "16:30" → minutes after midnight (null if unreadable). Same as the desktop app. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null
  const m = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ampm = m[3]?.replace(/\./g, '')
  if (min > 59 || h > 23 || (ampm && (h < 1 || h > 12))) return null
  if (ampm === 'am' && h === 12) h = 0
  if (ampm === 'pm' && h !== 12) h += 12
  return h * 60 + min
}

export function ymd(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function atMinutes(dayMs: number, minutes: number): number {
  const d = new Date(dayMs); d.setHours(0, minutes, 0, 0); return d.getTime()
}

function addDays(ms: number, n: number): number {
  const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime()     // DST-safe
}

/**
 * One person's week (7 work days from weekStart, a local Monday 00:00).
 * blocks: that person's counted blocks (not removed/rejected), ideally loaded from a day
 * before the week to a day after it, so overnight shifts at the edges are complete.
 */
export function scheduleWeek(
  blocks: ScheduleBlock[], shiftStartText: string | null | undefined, shiftEndText: string | null | undefined,
  weekStart: number, now: number, graceMin: number,
): ScheduleDay[] {
  const start = parseClock(shiftStartText), end = parseClock(shiftEndText)
  const hasShift = start !== null && end !== null
  const length = hasShift ? (((end! - start! + 1440) % 1440) || 1440) : 0
  const dayBeginsAt = hasShift ? start! - 240 : 0      // minutes after midnight (may be negative)

  const workDayOf = (t: number) => ymd(t - dayBeginsAt * 60_000)
  const byDay = new Map<string, { first: number; last: number; seconds: number }>()
  for (const b of blocks) {
    if (b.seconds <= 0) continue
    const first = b.blockStart + (b.firstOffset ?? 0) * 1000
    const last  = b.blockStart + ((b.lastOffset ?? Math.min(599, (b.firstOffset ?? 0) + b.seconds - 1)) + 1) * 1000
    const key = workDayOf(first)
    const d = byDay.get(key)
    if (d) { d.first = Math.min(d.first, first); d.last = Math.max(d.last, last); d.seconds += b.seconds }
    else byDay.set(key, { first, last, seconds: b.seconds })
  }

  return Array.from({ length: 7 }, (_, i): ScheduleDay => {
    const dayMs = addDays(weekStart, i)
    const day = ymd(dayMs)
    const worked = byDay.get(day)
    const weekday = new Date(dayMs).getDay()
    const shiftDay = hasShift && weekday >= 1 && weekday <= 5
    const base: ScheduleDay = {
      day, shiftStart: null, shiftEnd: null, firstAt: worked?.first ?? null, lastAt: worked?.last ?? null,
      seconds: worked?.seconds ?? 0, lateMin: 0, earlyMin: 0, status: 'none',
    }
    if (!hasShift) return { ...base, status: worked ? 'worked' : 'none' }
    if (!shiftDay) return { ...base, status: worked ? 'extra-day' : 'day-off' }

    const shiftStart = atMinutes(dayMs, start!)
    const shiftEnd = shiftStart + length * 60_000
    const r = { ...base, shiftStart, shiftEnd }
    if (!worked) {
      if (now < shiftStart + graceMin * 60_000) return { ...r, status: 'upcoming' }
      return { ...r, status: now < shiftEnd ? 'not-started' : 'absent' }
    }
    if (worked.first >= shiftEnd) return { ...r, status: 'outside-shift' }   // only worked after the shift ended
    const lateMin = Math.max(0, Math.floor((worked.first - shiftStart) / 60_000))
    const earlyMin = Math.max(0, Math.floor((shiftEnd - worked.last) / 60_000))
    const late = lateMin > graceMin
    const shiftOver = now >= shiftEnd + graceMin * 60_000
    const early = shiftOver && earlyMin > graceMin
    return {
      ...r, lateMin, earlyMin: shiftOver ? earlyMin : 0,
      status: late && early ? 'late-left-early' : late ? 'late' : early ? 'left-early' : shiftOver ? 'on-time' : 'in-progress',
    }
  })
}
