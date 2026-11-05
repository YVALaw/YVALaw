// Where a notification opens (bell, phone push and email all use the stored `link`).
//
// New notifications carry the exact record: /candidates/<id>, /leads?open=<id>, /invoice?open=<id>,
// /approvals?open=<id>, /weekly-close?week=<monday>, /payroll?payday=<friday>, /settings?tab=notifications.
// Each page opens that record from the address (also when you're already on the page) and says so when it was
// deleted or you can no longer see it.
//
// Notifications made before 2026-11-05 — and the ones the database writes until migrate-notification-links.sql
// runs — only have the list page (/candidates, /leads, /invoice…). For those, legacyTarget() finds the record
// from the title (the person's name, the invoice number) or the date, so they open the record too.
import { supabase } from './supabase'
import { applicantName, invoiceNumber, isSpecific, leadName, paydayForNotice, weekForNotice, type NotificationLike } from './notificationLinks'

async function newestId(table: 'candidates' | 'leads', name: string): Promise<string | null> {
  const { data, error } = await supabase.from(table).select('id').eq('name', name).order('created_at', { ascending: false }).limit(1)
  if (error || !data?.length) return null
  return String((data[0] as { id: string }).id)
}

/** The page a notification should open. Never throws: on any problem it falls back to the stored link. */
export async function notificationTarget(n: NotificationLike): Promise<string | null> {
  if (!n.link || isSpecific(n.link)) return n.link
  try {
    switch (n.kind) {
      case 'application_new': {
        const name = applicantName(n.title)
        const id = name ? await newestId('candidates', name) : null
        return id ? `/candidates/${encodeURIComponent(id)}` : n.link
      }
      case 'lead_new': {
        const name = leadName(n.title)
        const id = name ? await newestId('leads', name) : null
        return id ? `/leads?open=${encodeURIComponent(id)}` : n.link
      }
      case 'payment_received': case 'payment_refunded': case 'payment_disputed': case 'payment_failed': case 'payment_problem': {
        const num = invoiceNumber(`${n.title} ${n.body ?? ''}`)
        if (!num) return n.link
        const { data } = await supabase.from('invoices').select('id').eq('number', num).limit(1)
        const id = (data?.[0] as { id: string } | undefined)?.id
        return id ? `/invoice?open=${encodeURIComponent(id)}` : n.link
      }
      case 'week_ready': return `/weekly-close?week=${weekForNotice(n.createdAt)}`
      case 'payroll_due': return `/payroll?payday=${paydayForNotice(n.createdAt)}`
      case 'test': return n.link.startsWith('/settings') ? '/settings?tab=notifications' : n.link
      default: return n.link
    }
  } catch { return n.link }
}
