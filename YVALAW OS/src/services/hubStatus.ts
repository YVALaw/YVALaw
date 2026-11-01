// Live status lines for the dock's hub pop-ups ("5 follow-ups due today", "6 waiting"…) and the
// gold dot on hubs where something needs action. Cheap queries only, each one allowed to fail
// (RLS hides tables from roles that can't see them), cached for a minute.
import { supabase } from '../lib/supabase'
import { loadSnapshot, countPendingStaffRequests } from './storage'
import { addDays, localParts, mondayOf, DEFAULT_TZ } from '../utils/moneyRules'
import { dateShort, usdShort } from '../utils/format'

export type PageStatus = { stat: string; warn?: boolean; badge?: number }
export type HubStatus = Record<string, PageStatus>

let cache: { at: number; keys: string; value: HubStatus } | null = null
export function invalidateHubStatus() { cache = null }

const safe = async <T,>(fn: () => Promise<T>): Promise<T | null> => { try { return await fn() } catch { return null } }
const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => { const r = await q; if (r.error) throw r.error; return r.count ?? 0 }

export async function loadHubStatus(keys: string[]): Promise<HubStatus> {
  const k = keys.slice().sort().join(',')
  if (cache && cache.keys === k && Date.now() - cache.at < 60_000) return cache.value
  const has = (key: string) => keys.includes(key)
  const today = localParts(Date.now(), DEFAULT_TZ).date
  const monday = mondayOf(today)
  const out: HubStatus = {}
  const snap = await safe(() => loadSnapshot())

  await Promise.all([
    has('leads') && safe(async () => {
      const due = await count(supabase.from('leads').select('id', { count: 'exact', head: true }).lte('next_follow_up', today).not('stage', 'in', '(won,lost)'))
      out.leads = due ? { stat: `${due} follow-up${due === 1 ? '' : 's'} due`, warn: true, badge: due } : { stat: 'No follow-ups due' }
    }),
    has('clients') && snap && (async () => {
      const active = snap.clients.filter(c => String(c.status || 'active').toLowerCase() === 'active').length
      const ending = snap.clients.filter(c => c.contractEnd && c.contractEnd >= today && c.contractEnd <= addDays(today, 60)).length
      out.clients = { stat: `${active} active${ending ? ` · ${ending} contract${ending === 1 ? '' : 's'} ending` : ''}`, warn: ending > 0 }
    })(),
    has('estimates') && safe(async () => {
      const open = await count(supabase.from('estimates').select('id', { count: 'exact', head: true }).in('status', ['draft', 'sent']))
      out.estimates = { stat: open ? `${open} open` : 'None open' }
    }),
    has('requests') && safe(async () => {
      const n = await countPendingStaffRequests()
      out.requests = n ? { stat: `${n} new`, warn: true, badge: n } : { stat: 'Nothing new' }
    }),
    has('weekly-close') && safe(async () => {
      const last = addDays(monday, -7)
      const { data } = await supabase.from('week_closes').select('status').eq('week_start', last).maybeSingle()
      const st = (data as { status?: string } | null)?.status
      out['weekly-close'] = st === 'ready' ? { stat: `Week of ${dateShort(last)} ready to approve`, warn: true }
        : st === 'approved' ? { stat: `Prepares Monday ${dateShort(addDays(monday, 7))}, 12:05 am` }
        : { stat: 'Prepares Monday 12:05 am' }
    }),
    has('invoices') && snap && (async () => {
      const open = snap.invoices.filter(i => ['sent', 'viewed', 'overdue', 'partial'].includes(String(i.status || '').toLowerCase()))
      const overdue = open.filter(i => String(i.status).toLowerCase() === 'overdue' || (i.dueDate && i.dueDate < today)).length
      const total = open.reduce((s, i) => s + (Number(i.subtotal) || 0) - (Number(i.amountPaid) || 0), 0)
      out.invoices = { stat: open.length ? `${usdShort(total)} open${overdue ? ` · ${overdue} overdue` : ''}` : 'Nothing open', warn: overdue > 0, badge: overdue || undefined }
    })(),
    has('payroll') && (async () => {
      const fri = addDays(today, (5 - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7)
      out.payroll = { stat: fri === today ? 'Payday today' : `Next payday Fri ${dateShort(fri)}`, warn: fri === today }
    })(),
    has('expenses') && safe(async () => {
      const { data, error } = await supabase.from('expenses').select('amount').is('project_id', null).gte('date', `${today.slice(0, 8)}01`)
      if (error) throw error
      const total = (data || []).reduce((s, r) => s + (Number((r as { amount: number }).amount) || 0), 0)
      out.expenses = { stat: `${usdShort(total)} this month` }
    }),
    has('reports') && (async () => { out.reports = { stat: 'Revenue, AR aging, forecast' } })(),
    has('projects') && snap && (async () => {
      const active = snap.projects.filter(p => !['completed', 'cancelled', 'archived', 'closed'].includes(String(p.status || '').toLowerCase())).length
      out.projects = { stat: `${active} active` }
    })(),
    has('time') && safe(async () => {
      const since = new Date(Date.now() - 3 * 60_000).toISOString()
      const { data, error } = await supabase.from('tracker_blocks').select('employee_id').gte('updated_at', since).limit(500)
      if (error) throw error
      const n = new Set((data || []).map(r => (r as { employee_id: string }).employee_id)).size
      out.time = { stat: n ? `${n} tracking now` : 'Nobody tracking right now' }
    }),
    has('calendar') && safe(async () => {
      const sunday = addDays(monday, 6)
      const n = await count(supabase.from('time_off_requests').select('id', { count: 'exact', head: true }).eq('status', 'approved').lte('start_date', sunday).gte('end_date', monday))
      out.calendar = { stat: n ? `${n} time off this week` : 'No time off this week' }
    }),
    has('team') && snap && (async () => {
      const n = snap.employees.filter(e => !['inactive', 'terminated'].includes(String(e.status || '').toLowerCase())).length
      out.team = { stat: `${n} people` }
    })(),
    has('approvals') && safe(async () => {
      const [a, b] = await Promise.all([
        safe(() => count(supabase.from('time_off_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'))),
        safe(() => count(supabase.from('manual_time_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'))),
      ])
      const n = (a ?? 0) + (b ?? 0)
      out.approvals = n ? { stat: `${n} waiting`, warn: true, badge: n } : { stat: 'Nothing waiting' }
    }),
    has('candidates') && safe(async () => {
      const n = await count(supabase.from('candidates').select('id', { count: 'exact', head: true }).not('stage', 'in', '(hired,rejected)'))
      out.candidates = { stat: `${n} in pipeline` }
    }),
    has('announcements') && safe(async () => {
      const n = await count(supabase.from('announcements').select('id', { count: 'exact', head: true }).is('published_at', null))
      out.announcements = { stat: n ? `${n} draft${n === 1 ? '' : 's'}` : 'No drafts' }
    }),
  ].filter(Boolean))

  cache = { at: Date.now(), keys: k, value: out }
  return out
}
