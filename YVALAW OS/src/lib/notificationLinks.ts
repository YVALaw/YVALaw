// Pure rules for where a notification opens (see notificationTarget.ts). No database access here, so they're unit-tested.
// Self-contained date helpers (same rules as utils/moneyRules: business days in the Dominican time zone)
const TZ = 'America/Santo_Domingo'
const localDate = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7))

export type NotificationLike = { kind: string; title: string; body: string | null; link: string | null; createdAt: number }

/** A link that already names a record (or isn't one of the old list-only links) is used as it is */
export function isSpecific(link: string | null): boolean {
  if (!link) return false
  const path = link.split('?')[0].replace(/\/+$/, '')
  if (link.includes('?')) return true
  return !['/candidates', '/leads', '/invoice', '/approvals', '/weekly-close', '/payroll', '/settings'].includes(path)
}

/** "New application: Ana Pérez — Legal Assistant" → "Ana Pérez" */
export function applicantName(title: string): string | null {
  const m = /^New application:\s*(.+?)(?:\s+—\s+.*)?$/.exec(title.trim())
  return m ? m[1].trim() || null : null
}

/** "New lead: Joe Smith (Smith Law)" / "A lead was assigned to you: Joe Smith" → "Joe Smith" */
export function leadName(title: string): string | null {
  const t = title.trim()
  const assigned = /^A lead was assigned to you:\s*(.+)$/.exec(t)
  if (assigned) return assigned[1].trim() || null
  const m = /^New lead:\s*(.+?)(?:\s+\([^()]*\))?$/.exec(t)
  return m ? m[1].trim() || null : null
}

/** "…: invoice HAL-0007" / "Invoice HAL-0007 overpaid…" / "…for invoice HAL-0007 was not…" → "HAL-0007" */
export function invoiceNumber(text: string): string | null {
  const m = /\binvoice\s+([A-Z0-9][A-Z0-9-]{1,30})\b/i.exec(text)
  return m && /\d/.test(m[1]) ? m[1] : null
}

/** Weekly close is announced on the Monday after the week: open that finished week */
export function weekForNotice(createdAt: number): string {
  return addDays(mondayOf(localDate(createdAt)), -7)
}

/** The payroll reminder goes out on Wednesday for that week's Friday */
export function paydayForNotice(createdAt: number): string {
  return addDays(mondayOf(localDate(createdAt)), 4)
}
