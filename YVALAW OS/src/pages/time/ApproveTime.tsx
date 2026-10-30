import { useEffect, useState } from 'react'
import type { Employee, Project } from '../../data/types'
import { loadEmployees, loadProjects } from '../../services/storage'
import {
  activityColor, approveTime, blocksActivity, decideRequest, loadManualRequests, loadTrackerBlocks, reopenTime,
  type ManualRequest, type TrackerBlock,
} from '../../services/trackerStorage'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function ymd(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function mondayOf(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime()
}
function addDays(ms: number, n: number): number {
  const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime()     // DST-safe
}
const hours = (s: number) => (s / 3600).toFixed(2)
function when(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type DayCell = { tracked: number; approved: number }

/** Time Tracking → Approve: approve each person's finished days (or reopen them); decide manual time requests */
export default function ApproveTime() {
  const [week, setWeek] = useState(() => mondayOf(Date.now()))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [blocks,    setBlocks]    = useState<TrackerBlock[]>([])
  const [requests,  setRequests]  = useState<ManualRequest[]>([])
  const [busy,      setBusy]      = useState<string | null>(null)
  const [message,   setMessage]   = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void loadEmployees().then(setEmployees)
    void loadProjects().then(setProjects)
  }, [])

  async function load() {
    const [b, r] = await Promise.all([loadTrackerBlocks(week, addDays(week, 7)), loadManualRequests('pending')])
    setBlocks(b); setRequests(r)
  }
  useEffect(() => { void load() }, [week])   // eslint-disable-line react-hooks/exhaustive-deps

  const today = ymd(Date.now())
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const lastApprovable = days.map(ymd).filter(d => d < today).pop() ?? null   // finished days only

  const byEmployee = new Map<string, Map<string, DayCell>>()
  for (const b of blocks) {
    if (b.status !== 'tracked' && b.status !== 'approved') continue
    const cells = byEmployee.get(b.employeeId) ?? new Map<string, DayCell>()
    const day = ymd(b.blockStart)
    const c = cells.get(day) ?? { tracked: 0, approved: 0 }
    if (b.status === 'approved') c.approved += b.seconds; else c.tracked += b.seconds
    cells.set(day, c)
    byEmployee.set(b.employeeId, cells)
  }
  const activityOf = (employeeId: string) => blocksActivity(blocks.filter(b => b.employeeId === employeeId))
  const nameOf = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown employee'
  const targetOf = (r: ManualRequest) => (r.projectId ? projects.find(p => p.id === r.projectId)?.name ?? 'Project' : r.workType ?? '')
  const rows = [...byEmployee.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))

  function waitingSeconds(cells: Map<string, DayCell>): number {
    let s = 0
    for (const [day, c] of cells) if (lastApprovable && day <= lastApprovable) s += c.tracked
    return s
  }

  async function approve(employeeId: string) {
    if (!lastApprovable) return
    setBusy(employeeId); setMessage(null)
    try {
      const r = await approveTime(employeeId, ymd(week), lastApprovable)
      setMessage({ ok: true, text: `Approved ${nameOf(employeeId)}: ${r.entries} day/project total${r.entries === 1 ? '' : 's'} now in the time log, client portal and invoice import.` })
      await load()
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally { setBusy(null) }
  }

  async function reopen(employeeId: string) {
    const range = `${new Date(week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(addDays(week, 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    if (!window.confirm(`Reopen ${nameOf(employeeId)}'s approved hours for ${range}?\n\nThey go back to "waiting" and leave the time log, the client portal and invoice import until you approve them again. If you already paid or invoiced them, fix that by hand.`)) return
    setBusy(`reopen:${employeeId}`); setMessage(null)
    try {
      const r = await reopenTime(employeeId, ymd(week), ymd(addDays(week, 6)))
      setMessage({ ok: true, text: `Reopened ${nameOf(employeeId)}'s week: ${r.entries} day/project total${r.entries === 1 ? '' : 's'} removed from the time log until approved again.` })
      await load()
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally { setBusy(null) }
  }

  async function decide(r: ManualRequest, ok: boolean) {
    const note = ok ? undefined : window.prompt('Reason for rejecting (the employee sees this):') ?? undefined
    if (!ok && note === undefined) return
    setBusy(r.id); setMessage(null)
    try {
      const res = await decideRequest(r.id, ok, note)
      setMessage({ ok: true, text: ok
        ? `Approved ${Math.round(res.seconds / 60)} min for ${nameOf(r.employeeId)}${res.seconds < (r.endsAt - r.startsAt) / 1000 ? ' (part of it was already tracked, so it was not added twice)' : ''}.`
        : `Rejected the request from ${nameOf(r.employeeId)}.` })
      await load()
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally { setBusy(null) }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn-ghost btn-sm" onClick={() => setWeek(w => addDays(w, -7))}>← Previous week</button>
        <strong style={{ padding: '0 6px' }}>
          {new Date(week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(addDays(week, 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </strong>
        <button className="btn-ghost btn-sm" disabled={addDays(week, 7) > Date.now()} onClick={() => setWeek(w => addDays(w, 7))}>Next week →</button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          Approved hours go to the time log, the client portal (client projects) and "Import YVA Time hours" on invoices. Today can't be approved until it's over.
        </span>
      </div>

      {message && <div className={`portal-message ${message.ok ? 'portal-message-success' : 'portal-message-error'}`} style={{ marginBottom: 14 }}>{message.text}</div>}

      {rows.length === 0 ? (
        <div className="data-card" style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>No YVA Time hours this week.</div>
      ) : (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                {days.map((d, i) => <th key={d} style={{ textAlign: 'right' }}>{DAY_NAMES[i]} {new Date(d).getDate()}</th>)}
                <th style={{ textAlign: 'right' }} title="Hours, and the share of tracked time with keyboard or mouse use (client team)">Week</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(([employeeId, cells]) => {
                const total = [...cells.values()].reduce((s, c) => s + c.tracked + c.approved, 0)
                const approvedAny = [...cells.values()].some(c => c.approved > 0)
                const waiting = waitingSeconds(cells)
                const activity = activityOf(employeeId)
                return (
                  <tr key={employeeId}>
                    <td className="td-name">{nameOf(employeeId)}</td>
                    {days.map(d => {
                      const c = cells.get(ymd(d))
                      if (!c) return <td key={d} className="td-muted" style={{ textAlign: 'right' }}>—</td>
                      const allApproved = c.tracked === 0
                      return (
                        <td key={d} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}
                          title={`${hours(c.approved)} h approved · ${hours(c.tracked)} h waiting`}>
                          <span style={{ color: allApproved ? '#047857' : 'var(--text)', fontWeight: 600 }}>{hours(c.tracked + c.approved)}</span>
                          {!allApproved && <span style={{ color: '#b45309', marginLeft: 4 }}>●</span>}
                        </td>
                      )
                    })}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: 700 }}>{hours(total)}</div>
                      {activity !== null && <div style={{ fontSize: 11, fontWeight: 600, color: activityColor(activity) }}>{activity}% active</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      {waiting > 0 ? (
                        <button className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void approve(employeeId)}>
                          {busy === employeeId ? 'Approving…' : `Approve ${hours(waiting)} h`}
                        </button>
                      ) : approvedAny ? <span className="badge badge-green" style={{ fontSize: 10 }}>Approved</span> : null}
                      {approvedAny && (
                        <button className="btn-ghost btn-sm" disabled={busy !== null}
                          title="Approved by mistake? Send this week's approved hours back to waiting" onClick={() => void reopen(employeeId)}>
                          {busy === `reopen:${employeeId}` ? 'Reopening…' : 'Reopen week'}
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>
            Hours per day · <span style={{ color: '#b45309' }}>●</span> = not approved yet · green = approved · "% active" = keyboard/mouse use (client team)
          </div>
        </div>
      )}

      <div className="data-card">
        <div className="data-card-title">Manual time requests</div>
        {requests.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, paddingTop: 4 }}>No requests waiting.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
            {requests.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontWeight: 700 }}>{nameOf(r.employeeId)} · {Math.round((r.endsAt - r.startsAt) / 60000)} min · {targetOf(r)}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{when(r.startsAt)} – {new Date(r.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                  <div style={{ fontSize: 13, marginTop: 2, overflowWrap: 'anywhere' }}>"{r.reason}"</div>
                </div>
                <button className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void decide(r, true)}>{busy === r.id ? '…' : 'Approve'}</button>
                <button className="btn-ghost btn-sm" disabled={busy !== null} onClick={() => void decide(r, false)}>Reject</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
