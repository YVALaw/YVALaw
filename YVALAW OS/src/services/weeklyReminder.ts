// Weekly reminder email (Settings → Notifications). Settings live on the settings row (supabase/migrate-weekly-reminder.sql);
// the email itself is built and sent by netlify/functions/weekly-reminder.cjs (hourly) / weekly-reminder-test.cjs.
import { supabase } from '../lib/supabase'

export type ReminderSection = 'drafts' | 'unpaid' | 'weekly_close'
export const REMINDER_SECTIONS: { id: ReminderSection; label: string; hint: string }[] = [
  { id: 'drafts', label: 'Invoices still in draft', hint: 'Number, client and amount of each draft not sent yet' },
  { id: 'unpaid', label: 'Unpaid and overdue invoices', hint: 'Balance owed on each, overdue ones first' },
  { id: 'weekly_close', label: "Last week's close", hint: 'Approved, waiting for approval or not prepared (when Weekly close is set up)' },
]
export const BUSINESS_TZ = 'America/Santo_Domingo'

export type WeeklyReminder = {
  ready: boolean                 // false until the SQL has run (columns missing)
  enabled: boolean
  day: number                    // 0 = Sunday … 6 = Saturday
  hour: number                   // 0–23, business time zone
  recipients: string[]           // empty = every CEO login
  include: ReminderSection[]
  lastSent: string | null
  timeZone: string
}

const COLS = ['weekly_reminder_enabled', 'weekly_reminder_day', 'weekly_reminder_hour', 'weekly_reminder_recipients', 'weekly_reminder_include', 'weekly_reminder_last_sent']
const ALL: ReminderSection[] = ['drafts', 'unpaid', 'weekly_close']

function fromRow(row: Record<string, unknown> | null): WeeklyReminder {
  const r = row || {}
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d)
  return {
    ready: 'weekly_reminder_enabled' in r,
    enabled: r.weekly_reminder_enabled === true,
    day: int(r.weekly_reminder_day, 0, 6, 1),
    hour: int(r.weekly_reminder_hour, 0, 23, 8),
    recipients: Array.isArray(r.weekly_reminder_recipients) ? (r.weekly_reminder_recipients as string[]) : [],
    include: Array.isArray(r.weekly_reminder_include) ? ALL.filter(s => (r.weekly_reminder_include as string[]).includes(s)) : ALL.slice(),
    lastSent: (r.weekly_reminder_last_sent as string | null) ?? null,
    timeZone: (typeof r.business_timezone === 'string' && r.business_timezone) || BUSINESS_TZ,
  }
}

export async function loadWeeklyReminder(): Promise<WeeklyReminder> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return fromRow(data as Record<string, unknown> | null)
}

/** Saves the reminder columns only (never the rest of the settings row). Throws if nothing was saved (e.g. no permission). */
export async function saveWeeklyReminder(r: Pick<WeeklyReminder, 'enabled' | 'day' | 'hour' | 'recipients' | 'include'>): Promise<WeeklyReminder> {
  const { data, error } = await supabase.from('settings').update({
    weekly_reminder_enabled: r.enabled,
    weekly_reminder_day: r.day,
    weekly_reminder_hour: r.hour,
    weekly_reminder_recipients: r.recipients.length ? r.recipients : null,
    weekly_reminder_include: r.include,
  }).eq('id', 1).select(COLS.join(','))
  if (error) throw new Error(error.message)
  if (!data || !data.length) throw new Error('Only the CEO or an Admin can change this.')
  return fromRow(data[0] as unknown as Record<string, unknown>)
}

/** "Email me a test now" → the summary goes to the signed-in person's own email */
export async function sendWeeklyReminderTest(include: ReminderSection[]): Promise<{ to: string; subject: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Please sign in again.')
  const res = await fetch('/.netlify/functions/weekly-reminder-test', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ include }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Could not send the test (${res.status})`)
  return data as { to: string; subject: string }
}

/** "8:00 am" style label for an hour in the business zone */
export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'am' : 'pm'}`
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
