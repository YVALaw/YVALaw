// People hub: this week's YVA Time stats for one employee (profile stats strip).
// Activity % = active seconds / seconds over this week's measured blocks (client team, YVA Time 0.3+).
// On time   = this week's finished shift weekdays where the person started on time — the same rules as
//             Time → Schedule (utils/schedule.ts, default 5 min grace, profile's default shift,
//             approved time off and company holidays don't count).
import { useEffect, useState } from 'react'
import type { Employee } from '../../data/types'
import { blocksActivity, loadTrackerBlocks, type TrackerBlock } from '../../services/trackerStorage'
import { loadHolidays, loadTimeOff } from '../../services/workspace'
import { parseClock, scheduleWeek, ymd, type ScheduleDay } from '../../utils/schedule'

const DAY_MS = 86_400_000
export const ON_TIME_GRACE_MIN = 5

export function mondayOf(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime()
}
function addDays(ms: number, n: number): number {
  const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime()     // DST-safe
}

export type OnTime = { onTime: number; days: number }

/** Pure: on-time count over finished shift weekdays (days off excluded). null = no shift on the profile. */
export function onTimeWeek(
  blocks: TrackerBlock[], shiftStart: string | null | undefined, shiftEnd: string | null | undefined,
  weekStart: number, now: number, offDays: Set<string>, graceMin = ON_TIME_GRACE_MIN,
): OnTime | null {
  if (parseClock(shiftStart) === null || parseClock(shiftEnd) === null) return null
  const counted = blocks.filter(b => b.status !== 'removed' && b.status !== 'rejected')
  const days: ScheduleDay[] = scheduleWeek(counted, shiftStart, shiftEnd, weekStart, now, graceMin)
  let onTime = 0, total = 0
  for (const d of days) {
    if (d.shiftStart === null || d.shiftEnd === null) continue                     // weekend / no shift that day
    if (now < d.shiftEnd + graceMin * 60_000) continue                             // shift not finished yet
    if (offDays.has(d.day) && !d.seconds) continue                                 // approved time off / holiday
    total++
    if (d.status === 'on-time' || d.status === 'left-early') onTime++              // started on time
  }
  return { onTime, days: total }
}

export type WeekStats = { loading: boolean; activity: number | null; onTime: OnTime | null }

/** Loads this week's tracker blocks (+ a day either side for overnight shifts), time off and holidays */
export function useEmployeeWeekStats(emp: Employee | undefined): WeekStats {
  const [state, setState] = useState<WeekStats>({ loading: true, activity: null, onTime: null })
  const id = emp?.id, start = emp?.defaultShiftStart, end = emp?.defaultShiftEnd
  useEffect(() => {
    if (!id) return
    let alive = true
    const now = Date.now()
    const week = mondayOf(now)
    const from = ymd(week), to = ymd(addDays(week, 6))
    setState(s => ({ ...s, loading: true }))
    void Promise.all([
      loadTrackerBlocks(week - DAY_MS, addDays(week, 8), id),
      loadTimeOff({ status: 'approved', employeeId: id, from, to }).then(r => r.rows).catch(() => []),
      loadHolidays(from).catch(() => []),
    ]).then(([blocks, timeOff, holidays]) => {
      if (!alive) return
      const off = new Set<string>()
      for (const r of timeOff) for (let d = r.start_date; d <= r.end_date && d <= to; d = ymd(addDays(new Date(`${d}T12:00:00`).getTime(), 1))) off.add(d)
      for (const h of holidays) if (h.day <= to) off.add(h.day)
      const end7 = addDays(week, 7)
      setState({
        loading: false,
        activity: blocksActivity(blocks.filter(b => b.blockStart >= week && b.blockStart < end7)),
        onTime: onTimeWeek(blocks, start, end, week, now, off),
      })
    })
    return () => { alive = false }
  }, [id, start, end])
  return state
}
