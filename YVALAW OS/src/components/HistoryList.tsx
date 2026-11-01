import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Banner, Skel } from './ui'

type Entry = { id: number; at: number; actor: string; actorKey: string; table: string; recordId: string | null; action: 'insert' | 'update' | 'delete'; changes: Record<string, unknown> }

const TABLE_LABELS: Record<string, string> = {
  invoices: 'Invoice', clients: 'Client', projects: 'Project', employees: 'Employee', expenses: 'Expense', candidates: 'Candidate',
  time_entries: 'Time entry', user_roles: 'Team access', role_permissions: 'Permission', client_users: 'Portal login', settings: 'Settings',
  placement_rates: 'Rate', week_closes: 'Weekly close', time_adjustments: 'Time adjustment', client_payments: 'Client payment',
  payroll_runs: 'Payroll', payroll_lines: 'Payroll line', payroll_adjustments: 'Bonus / deduction', employee_payout_methods: 'Bank / PayPal',
  leads: 'Lead', time_off_requests: 'Time off', announcements: 'Announcement',
}
const HIDDEN = new Set(['id', 'status_history', 'updated_at', 'created_at'])
const AUTO = 'YVA OS (automatic)'
const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

function short(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object') return '(details)'
  return String(v)
}
const label = (k: string) => k.replace(/_/g, ' ')

function describe(e: Entry): string[] {
  if (e.action === 'update') {
    return Object.entries(e.changes).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => {
      const [a, b] = Array.isArray(v) ? v : [undefined, v]
      return `${label(k)}: ${short(a)} → ${short(b)}`
    })
  }
  const c = e.changes as Record<string, unknown>
  const name = c.name ?? c.number ?? c.email ?? c.description ?? c.permission ?? ''
  return [String(name || '')].filter(Boolean)
}

function when(ms: number): string {
  const d = new Date(ms), now = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  if (d.toDateString() === now.toDateString()) return `Today ${time}`
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

/** Change history (needs the history.view permission; the database enforces it).
 *  Without `table` it shows the table / person / period filters (Settings → History);
 *  with `table` (+ `recordId`) it is the compact list used on profile pages. */
export default function HistoryList({ table, recordId, limit = 100 }: { table?: string; recordId?: string; limit?: number }) {
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState(table ?? '')
  const [actor, setActor] = useState('')
  const [period, setPeriod] = useState(table ? 'all' : '30')
  const [actors, setActors] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let alive = true
    setRows(null)
    let q = supabase.from('audit_log').select('id,at,actor_id,actor_email,table_name,record_id,action,changes').order('at', { ascending: false }).limit(limit)
    if (filter) q = q.eq('table_name', filter)
    if (recordId) q = q.eq('record_id', recordId)
    if (actor === 'auto') q = q.is('actor_id', null)
    else if (actor) q = q.eq('actor_email', actor)
    if (period !== 'all') q = q.gte('at', new Date(Date.now() - Number(period) * 86400000).toISOString())
    void q.then(({ data, error: e }) => {
      if (!alive) return
      if (e) { setError(e.code === '42P01' ? 'Run supabase/migrate-step1-foundation.sql to start recording changes.' : e.message); setRows([]); return }
      setError(null)
      const list: Entry[] = (data || []).map(r => ({
        id: r.id, at: Date.parse(r.at),
        actor: r.actor_email || (r.actor_id ? 'A team member' : AUTO),
        actorKey: r.actor_email || (r.actor_id ? '' : 'auto'),
        table: r.table_name, recordId: r.record_id, action: r.action, changes: r.changes || {},
      }))
      setRows(list)
      // Remember everyone seen so far, so the "Anyone" list doesn't shrink when a filter is applied
      setActors(prev => {
        const next = new Map(prev)
        for (const x of list) if (x.actorKey && !next.has(x.actorKey)) next.set(x.actorKey, x.actorKey === 'auto' ? 'Automatic' : x.actor)
        return next
      })
    })
    return () => { alive = false }
  }, [filter, recordId, limit, actor, period])

  const embedded = !!table
  return (
    <div className={`set-hist${embedded ? ' set-hist--embedded' : ''}`}>
      {!embedded && (
        <div className="set-hist__filters">
          <select className="select" aria-label="Table" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All tables</option>
            {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" aria-label="Who" value={actor} onChange={e => setActor(e.target.value)}>
            <option value="">Anyone</option>
            {[...actors].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="select" aria-label="Period" value={period} onChange={e => setPeriod(e.target.value)}>
            {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      )}
      {error && <div className="set-hist__error"><Banner tone="danger">{error}</Banner></div>}
      {rows === null ? (
        <div className="set-hist__skel" aria-label="Loading">{[0, 1, 2, 3].map(i => <Skel key={i} h={16} w={`${90 - i * 12}%`} />)}</div>
      ) : rows.length === 0 && !error ? (
        <div className="set-hist__empty">No changes recorded yet.</div>
      ) : rows.map(e => (
        <div key={e.id} className="set-hist-row">
          <span className="set-hist-row__when" title={new Date(e.at).toLocaleString()}>{when(e.at)}</span>
          <span className="set-hist-row__table">{e.table}</span>
          <div className="set-hist-row__what">
            <span className="set-hist-row__title">
              {e.action === 'insert' ? 'Created' : e.action === 'delete' ? 'Deleted' : 'Changed'} {(TABLE_LABELS[e.table] ?? e.table).toLowerCase()}
            </span>
            {describe(e).map((line, i) => <span key={i} className="set-hist-change">{line}</span>)}
          </div>
          <span className="set-hist-row__who">{e.actor}</span>
        </div>
      ))}
    </div>
  )
}
