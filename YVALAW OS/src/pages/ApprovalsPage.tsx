import { useEffect, useState } from 'react'
import type { Employee } from '../data/types'
import { loadEmployees } from '../services/storage'
import { usePermission, useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { decideTimeOff, loadTimeOff, type TimeOffRequest } from '../services/workspace'
import { decideRequest, loadManualRequests, type ManualRequest } from '../services/trackerStorage'

const KIND: Record<TimeOffRequest['kind'], string> = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', other: 'Other' }
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** HR → Approvals: time off and missing-time requests in one place (Step 7) */
export default function ApprovalsPage() {
  const allowed = usePermission()
  const { role } = useRole()
  const canTimeOff = allowed('timeoff.approve'), canManual = can.approveTime(role)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffRequest[]>([])
  const [manual, setManual] = useState<ManualRequest[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<TimeOffRequest[]>([])

  async function load() {
    const [p, r] = await Promise.all([loadTimeOff({ status: 'pending' }), loadTimeOff()])
    setTimeOff(p.rows.sort((a, b) => a.start_date.localeCompare(b.start_date))); setError(p.error)
    setRecent(r.rows.filter(x => x.status !== 'pending').slice(0, 15))
    if (canManual) setManual(await loadManualRequests('pending'))
  }
  useEffect(() => { void loadEmployees().then(setEmployees); void load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => employees.find(e => e.id === id)?.name ?? '—'

  async function decideOff(r: TimeOffRequest, approve: boolean) {
    try { await decideTimeOff(r.id, approve, notes[r.id] || ''); await load() } catch (e) { setError((e as Error).message) }
  }
  async function decideManual(r: ManualRequest, approve: boolean) {
    try { await decideRequest(r.id, approve, notes[r.id] || undefined); await load() } catch (e) { setError((e as Error).message) }
  }
  const noteInput = (id: string) => <input aria-label="Note for the employee" className="form-input form-input-sm" style={{ flex: 1, minWidth: 160 }} placeholder="Note for the employee (optional)" value={notes[id] || ''} onChange={e => setNotes(n => ({ ...n, [id]: e.target.value }))} />

  return (
    <div className="page-wrap">
      <div className="page-header"><div className="page-header-left"><h1 className="page-title">Approvals</h1><p className="page-sub">{timeOff.length + manual.length} waiting · employees are notified of every answer</p></div></div>
      {error && <div className="portal-message portal-message-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="data-card" style={{ marginBottom: 16 }}>
        <div className="data-card-title">Time off ({timeOff.length})</div>
        {timeOff.length === 0 && <div className="td-muted" style={{ fontSize: 14 }}>No time-off requests waiting.</div>}
        {timeOff.map(r => (
          <div key={r.id} className="approval-row">
            <div style={{ minWidth: 220, flex: 1 }}>
              <strong>{name(r.employee_id)}</strong> · {KIND[r.kind]}{r.half_day ? ' (half day)' : ''}
              <div className="td-muted" style={{ fontSize: 13 }}>{day(r.start_date)}{r.end_date !== r.start_date ? ` – ${day(r.end_date)}` : ''}{r.note ? ` · “${r.note}”` : ''}</div>
            </div>
            {canTimeOff ? <>{noteInput(r.id)}
              <button className="btn-primary btn-sm" onClick={() => void decideOff(r, true)}>Approve</button>
              <button className="btn-ghost btn-sm" onClick={() => void decideOff(r, false)}>Decline</button></>
              : <span className="td-muted" style={{ fontSize: 12 }}>Needs the "Approve time off" permission</span>}
          </div>
        ))}
      </div>

      {canManual && (
        <div className="data-card" style={{ marginBottom: 16 }}>
          <div className="data-card-title">Missing time ({manual.length})</div>
          {manual.length === 0 && <div className="td-muted" style={{ fontSize: 14 }}>No missing-time requests waiting.</div>}
          {manual.map(r => (
            <div key={r.id} className="approval-row">
              <div style={{ minWidth: 220, flex: 1 }}>
                <strong>{name(r.employeeId)}</strong> · {Math.round((r.endsAt - r.startsAt) / 60000)} min
                <div className="td-muted" style={{ fontSize: 13 }}>{when(r.startsAt)} – {new Date(r.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · “{r.reason}”</div>
              </div>
              {noteInput(r.id)}
              <button className="btn-primary btn-sm" onClick={() => void decideManual(r, true)}>Approve</button>
              <button className="btn-ghost btn-sm" onClick={() => void decideManual(r, false)}>Reject</button>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="data-card">
          <div className="data-card-title">Recently answered time off</div>
          {recent.map(r => (
            <div key={r.id} className="approval-row" style={{ fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 200 }}>{name(r.employee_id)} · {KIND[r.kind]} · {day(r.start_date)}{r.end_date !== r.start_date ? ` – ${day(r.end_date)}` : ''}</span>
              <span className={`badge ${r.status === 'approved' ? 'badge-green' : r.status === 'declined' ? 'badge-red' : 'badge-gray'}`} style={{ textTransform: 'capitalize' }}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
