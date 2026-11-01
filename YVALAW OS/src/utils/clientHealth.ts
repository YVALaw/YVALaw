// Client health badge (Step 9): a quick read of how each client relationship is doing.
import type { ActivityLogEntry, Client, Invoice, StaffRequest } from '../data/types'

/** Whole days from today to a YYYY-MM-DD date, in local time (negative = past). Never new Date('YYYY-MM-DD') — that is UTC midnight. */
function daysUntil(day: string, now = Date.now()): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  const t = new Date(now); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
  return Math.round((new Date(y, (m || 1) - 1, d || 1).getTime() - today) / 86400000)
}

export type Health = { level: 'good' | 'watch' | 'risk'; label: string; reasons: string[] }

export function clientHealth(client: Client, invoices: Invoice[], activity: ActivityLogEntry[], requests: StaffRequest[], now = Date.now()): Health {
  const reasons: string[] = []
  let score = 0
  const mine = invoices.filter(i => (i as Invoice & { clientId?: string }).clientId === client.id || i.clientName === client.name)
  const overdue = mine.filter(i => i.status === 'overdue' || (['sent', 'viewed', 'partial'].includes(i.status || '') && i.dueDate && daysUntil(i.dueDate, now) < -7))
  if (overdue.length) { score += overdue.length > 1 ? 2 : 1; reasons.push(`${overdue.length} overdue invoice${overdue.length === 1 ? '' : 's'}`) }
  const open = requests.filter(r => r.clientId === client.id && (r.status === 'pending' || r.status === 'in_review'))
  if (open.length) { score += 1; reasons.push(`${open.length} open staff request${open.length === 1 ? '' : 's'}`) }
  if (client.contractEnd) {
    const d = daysUntil(client.contractEnd, now)
    if (d < 0) { score += 2; reasons.push('contract expired') } else if (d <= 30) { score += 1; reasons.push(`contract ends in ${d} days`) }
  }
  const touches = activity.filter(a => a.clientId === client.id && !a.auto).map(a => Number(a.createdAt) || 0)
  const lastTouch = touches.length ? Math.max(...touches) : 0
  if (String(client.status || '').toLowerCase() !== 'lead') {
    if (!lastTouch || now - lastTouch > 30 * 86400000) { score += 1; reasons.push(lastTouch ? `no check-in for ${Math.floor((now - lastTouch) / 86400000)} days` : 'no check-in logged') }
  }
  const level = score >= 3 ? 'risk' : score >= 1 ? 'watch' : 'good'
  return { level, label: level === 'risk' ? 'At risk' : level === 'watch' ? 'Watch' : 'Healthy', reasons }
}
export const HEALTH_BADGE: Record<Health['level'], string> = { good: 'badge-green', watch: 'badge-orange', risk: 'badge-red' }
