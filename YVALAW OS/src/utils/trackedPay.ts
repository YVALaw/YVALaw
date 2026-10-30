import type { Employee, TimeEntry } from '../data/types'

/**
 * Approved YVA Time hours that are paid outside client invoices (YVA team work types —
 * non-billable). Client-project hours are paid through invoices (Import YVA Time hours),
 * so they are left out here to avoid paying them twice.
 */
export function trackedPayEntries(emp: Employee, entries: TimeEntry[], from?: string, to?: string): TimeEntry[] {
  return entries.filter(t =>
    t.source === 'tracker' && !t.billable && t.employeeId === emp.id &&
    (!from || t.date >= from) && (!to || t.date <= to))
}

export function trackedHoursOf(entries: TimeEntry[]): number {
  return entries.reduce((s, t) => s + (Number(t.hours) || 0), 0)
}
