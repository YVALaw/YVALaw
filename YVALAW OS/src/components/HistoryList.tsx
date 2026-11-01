import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Entry = { id: number; at: number; actor: string; table: string; recordId: string | null; action: 'insert' | 'update' | 'delete'; changes: Record<string, unknown> }

const TABLE_LABELS: Record<string, string> = {
  invoices: 'Invoice', clients: 'Client', projects: 'Project', employees: 'Employee', expenses: 'Expense', candidates: 'Candidate',
  time_entries: 'Time entry', user_roles: 'Team access', role_permissions: 'Permission', client_users: 'Portal login', settings: 'Settings',
  placement_rates: 'Rate', week_closes: 'Weekly close', time_adjustments: 'Time adjustment', client_payments: 'Client payment',
  payroll_runs: 'Payroll', payroll_lines: 'Payroll line', payroll_adjustments: 'Bonus / deduction', employee_payout_methods: 'Bank / PayPal',
  leads: 'Lead', time_off_requests: 'Time off', announcements: 'Announcement',
}
const HIDDEN = new Set(['id', 'status_history', 'updated_at', 'created_at'])

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

/** Change history (needs the history.view permission; the database enforces it) */
export default function HistoryList({ table, recordId, limit = 100 }: { table?: string; recordId?: string; limit?: number }) {
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState(table ?? '')

  useEffect(() => {
    let q = supabase.from('audit_log').select('id,at,actor_id,actor_email,table_name,record_id,action,changes').order('at', { ascending: false }).limit(limit)
    if (filter) q = q.eq('table_name', filter)
    if (recordId) q = q.eq('record_id', recordId)
    void q.then(({ data, error: e }) => {
      if (e) { setError(e.code === '42P01' ? 'Run supabase/migrate-step1-foundation.sql to start recording changes.' : e.message); setRows([]); return }
      setRows((data || []).map(r => ({ id: r.id, at: Date.parse(r.at), actor: r.actor_email || (r.actor_id ? 'A team member' : 'YVA OS (automatic)'),
        table: r.table_name, recordId: r.record_id, action: r.action, changes: r.changes || {} })))
    })
  }, [filter, recordId, limit])

  return (
    <div>
      {!table && (
        <div className="form-group" style={{ maxWidth: 240 }}>
          <label className="form-label">Show</label>
          <select className="form-select" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(TABLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}
      {error && <div className="portal-message portal-message-error">{error}</div>}
      {rows === null ? <div className="loading-text">Loading…</div> : rows.length === 0 && !error ? (
        <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>No changes recorded yet.</div>
      ) : rows.map(e => (
        <div key={e.id} className="history-row">
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            <div style={{ color: 'var(--text)', fontWeight: 600, overflowWrap: 'anywhere' }}>{e.actor}</div>
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>
              {e.action === 'insert' ? 'Created' : e.action === 'delete' ? 'Deleted' : 'Changed'} {(TABLE_LABELS[e.table] ?? e.table).toLowerCase()}
            </div>
            {describe(e).map((line, i) => <div key={i} className="history-change">{line}</div>)}
          </div>
        </div>
      ))}
    </div>
  )
}
