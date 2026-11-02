import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { actorName, loadPeopleByLogin, loadRecordNames, nameInRow, recordLink, type PersonRef } from '../services/auditTrail'
import { Banner, Skel } from './ui'

type Action = 'insert' | 'update' | 'delete' | 'event'
type Entry = { id: number; at: number; actorId: string | null; actorEmail: string | null; table: string; recordId: string | null; action: Action; changes: Record<string, unknown> }

const TABLE_LABELS: Record<string, string> = {
  invoices: 'Invoice', clients: 'Client', projects: 'Project', employees: 'Employee', expenses: 'Expense', candidates: 'Candidate',
  time_entries: 'Time entry', user_roles: 'Team access', role_permissions: 'Permission', client_users: 'Portal login', settings: 'Settings',
  placement_rates: 'Rate', week_closes: 'Weekly close', time_adjustments: 'Time adjustment', client_payments: 'Client payment',
  payroll_runs: 'Payroll', payroll_lines: 'Payroll line', payroll_adjustments: 'Bonus / deduction', employee_payout_methods: 'Bank / PayPal',
  leads: 'Lead', lead_activities: 'Lead note', contacts: 'Contact', time_off_requests: 'Time off', announcements: 'Announcement',
  holidays: 'Holiday', employee_documents: 'Employee document', estimates: 'Estimate', tasks: 'Task', activity_log: 'Client note',
  recurring_invoices: 'Recurring invoice', staff_requests: 'Staff request', manual_time_requests: 'Missing time request',
  client_documents: 'Client document', invoice_templates: 'Invoice template', tags: 'Tag', contracts: 'Contract', app: 'Sign-ins & exports',
}
const HIDDEN = new Set(['id', 'status_history', 'updated_at', 'created_at'])
const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]
const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'changes', label: 'Saved changes' },
  { value: 'insert', label: 'Created' },
  { value: 'update', label: 'Changed' },
  { value: 'delete', label: 'Deleted' },
  { value: 'event', label: 'Actions (emails, exports…)' },
  { value: 'signed_in', label: 'Sign-ins' },
]

function short(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object') return '(details)'
  return String(v)
}
const label = (k: string) => k.replace(/_/g, ' ')

/** The detail lines under a row's title */
function describe(e: Entry): string[] {
  if (e.action === 'update') {
    return Object.entries(e.changes).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => {
      const [a, b] = Array.isArray(v) ? v : [undefined, v]
      return `${label(k)}: ${short(a)} → ${short(b)}`
    })
  }
  if (e.action === 'event') {
    return Object.entries(e.changes).filter(([k]) => k !== 'kind' && k !== 'label').map(([k, v]) => `${label(k)}: ${short(v)}`)
  }
  return []
}

/** The record's name: its current name, else the name its own history entry carried */
function recordName(e: Entry, names: Map<string, string>): string | null {
  const now = e.recordId ? names.get(`${e.table}:${e.recordId}`) : undefined
  if (now) return now
  if (e.action === 'insert' || e.action === 'delete') return nameInRow(e.table, e.changes)
  if (e.action === 'update') {
    const after = Object.fromEntries(Object.entries(e.changes).map(([k, v]) => [k, Array.isArray(v) ? v[1] : v]))
    return nameInRow(e.table, after)
  }
  return null
}

function when(ms: number): string {
  const d = new Date(ms), now = new Date()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  if (d.toDateString() === now.toDateString()) return `Today ${time}`
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) })} ${time}`
}

/** Change history (needs the history.view permission; the database enforces it).
 *  - no props: Settings → History, with table / person / kind / period filters
 *  - `table` (+ `recordId`): the compact list on a record's page
 *  - `actorId`: everything one login did (employee profile → Activity), with kind / period filters */
export default function HistoryList({ table, recordId, actorId, limit }: { table?: string; recordId?: string; actorId?: string; limit?: number }) {
  const navigate = useNavigate()
  const embedded = !!table
  const personal = !!actorId && !embedded
  const max = limit ?? (personal ? 200 : 100)
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState(table ?? '')
  const [actor, setActor] = useState('')
  const [kind, setKind] = useState('')
  const [period, setPeriod] = useState(embedded ? 'all' : '30')
  const [seen, setSeen] = useState<Map<string, string | null>>(new Map())   // actor id → email, everyone seen so far
  const [people, setPeople] = useState<Map<string, PersonRef>>(new Map())
  const [names, setNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let alive = true
    void loadPeopleByLogin().then(p => { if (alive) setPeople(p) }).catch(() => { /* names fall back to emails */ })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    setRows(null)
    let q = supabase.from('audit_log').select('id,at,actor_id,actor_email,table_name,record_id,action,changes').order('at', { ascending: false }).limit(max)
    if (filter) q = q.eq('table_name', filter)
    if (recordId) q = q.eq('record_id', recordId)
    if (actorId) q = q.eq('actor_id', actorId)
    else if (actor === 'auto') q = q.is('actor_id', null)
    else if (actor) q = q.eq('actor_id', actor)
    if (kind === 'changes') q = q.in('action', ['insert', 'update', 'delete'])
    else if (kind === 'signed_in') q = q.eq('action', 'event').eq('changes->>kind', 'signed_in')
    else if (kind) q = q.eq('action', kind)
    if (period !== 'all') q = q.gte('at', new Date(Date.now() - Number(period) * 86400000).toISOString())
    void q.then(({ data, error: e }) => {
      if (!alive) return
      if (e) { setError(e.code === '42P01' ? 'Run supabase/migrate-step1-foundation.sql to start recording changes.' : e.message); setRows([]); return }
      setError(null)
      const list: Entry[] = (data || []).map(r => ({
        id: r.id, at: Date.parse(r.at), actorId: r.actor_id ?? null, actorEmail: r.actor_email ?? null,
        table: r.table_name, recordId: r.record_id, action: r.action, changes: r.changes || {},
      }))
      setRows(list)
      // Remember everyone seen so far, so the "Anyone" list doesn't shrink when a filter is applied
      setSeen(prev => {
        let next: Map<string, string | null> | null = null
        for (const x of list) if (x.actorId && !prev.has(x.actorId)) (next ??= new Map(prev)).set(x.actorId, x.actorEmail)
        return next ?? prev
      })
      // Names of the records on screen (record pages already show their own name)
      if (!recordId) {
        const refs = list.filter(x => x.recordId && x.table !== 'app').map(x => ({ table: x.table, id: x.recordId! }))
        void loadRecordNames(refs).then(n => { if (alive) setNames(n) })
      }
    })
    return () => { alive = false }
  }, [filter, recordId, actorId, max, actor, kind, period])

  // "Who": people by name (logins linked to an employee record), then anyone else seen, by email
  const whoOptions = useMemo(() => {
    const opts = new Map<string, string>()
    for (const [id, p] of people) opts.set(id, p.name)
    for (const [id, email] of seen) if (!opts.has(id)) opts.set(id, email || 'A team member')
    return [...opts].sort((a, b) => a[1].localeCompare(b[1]))
  }, [people, seen])

  return (
    <div className={`set-hist${embedded ? ' set-hist--embedded' : ''}${personal ? ' set-hist--person' : ''}`}>
      {!embedded && (
        <div className="set-hist__filters">
          {!personal && (
            <select className="select" aria-label="Table" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="">All tables</option>
              {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          {!personal && (
            <select className="select" aria-label="Who" value={actor} onChange={e => setActor(e.target.value)}>
              <option value="">Anyone</option>
              <option value="auto">Automatic</option>
              {whoOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          <select className="select" aria-label="Kind" value={kind} onChange={e => setKind(e.target.value)}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
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
        <div className="set-hist__empty">{personal ? 'Nothing recorded for this person in this period.' : 'No changes recorded yet.'}</div>
      ) : rows.map(e => {
        const what = (TABLE_LABELS[e.table] ?? label(e.table)).toLowerCase()
        const name = recordId ? null : recordName(e, names)
        const to = !recordId && e.recordId && names.has(`${e.table}:${e.recordId}`) ? recordLink(e.table, e.recordId) : null
        const nameEl = name ? (to ? <button type="button" className="link set-hist-row__rec" onClick={() => navigate(to)}>{name}</button> : <span className="set-hist-row__rec">{name}</span>) : null
        const label0 = typeof e.changes.label === 'string' && e.changes.label ? e.changes.label : label(String(e.changes.kind || 'action'))
        return (
          <div key={e.id} className={`set-hist-row${e.action === 'event' ? ' set-hist-row--event' : ''}`} data-action={e.action}>
            <span className="set-hist-row__when" title={new Date(e.at).toLocaleString()}>{when(e.at)}</span>
            <span className="set-hist-row__table">{e.action === 'event' ? (e.table === 'app' ? 'action' : e.table) : e.table}</span>
            <div className="set-hist-row__what">
              <span className="set-hist-row__title">
                {e.action === 'event'
                  ? <>{label0}{to && name && !label0.includes(name) && <> · {nameEl}</>}{to && name && label0.includes(name) && <> · <button type="button" className="link set-hist-row__rec" onClick={() => navigate(to)}>Open</button></>}</>
                  : <>{e.action === 'insert' ? 'Created' : e.action === 'delete' ? 'Deleted' : 'Changed'} {what}{nameEl && <> {nameEl}</>}</>}
              </span>
              {describe(e).map((line, i) => <span key={i} className="set-hist-change">{line}</span>)}
            </div>
            {!personal && <span className="set-hist-row__who" title={e.actorEmail ?? undefined}>{actorName(e.actorId, e.actorEmail, people)}</span>}
          </div>
        )
      })}
      {personal && rows && rows.length >= max && <div className="set-hist__more">Showing the latest {max}. Pick a shorter period or a kind to see older ones.</div>}
    </div>
  )
}
