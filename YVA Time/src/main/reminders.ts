// Shift reminders — pure logic, unit-tested in test/reminders.test.ts.
// Uses the shift times on the employee's YVA OS profile, read in this computer's local time:
//   • start: not tracking 10–60 min after the shift started (Mon–Fri) → "start tracking?"
//   • end:   still tracking 30 min – 6 h after the shift ended        → "still tracking?"
// Each reminder shows at most once per shift. Overnight shifts (e.g. 4 pm – 12 am) work.
import type { TrackerStatus } from '../shared/types'

/** "9:00 am", "9am", "4:30 PM", "16:30", "21:00" → minutes after midnight (null if unreadable) */
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

export type ReminderMemory = { start: string | null; end: string | null }   // shift keys already reminded
export type Reminder = { kind: 'start' | 'end'; shiftKey: string; clock: string }

function clockText(minutes: number): string {
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function reminderDue(
  now: Date, shiftStart: string | null, shiftEnd: string | null,
  status: TrackerStatus, memory: ReminderMemory,
): Reminder | null {
  const start = parseClock(shiftStart), end = parseClock(shiftEnd)
  if (start === null || end === null) return null
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const sinceStart = (nowMin - start + 1440) % 1440                 // minutes into the current shift cycle
  const length = ((end - start + 1440) % 1440) || 1440
  const shiftBegan = new Date(now.getTime() - sinceStart * 60_000)
  const shiftKey = shiftBegan.toDateString()

  if (status === 'stopped' && sinceStart >= 10 && sinceStart <= 60 && memory.start !== shiftKey) {
    const weekday = shiftBegan.getDay()
    if (weekday >= 1 && weekday <= 5) return { kind: 'start', shiftKey, clock: clockText(start) }
  }
  if (status !== 'stopped' && sinceStart >= length + 30 && sinceStart <= length + 360 && memory.end !== shiftKey) {
    return { kind: 'end', shiftKey, clock: clockText(end) }
  }
  return null
}
