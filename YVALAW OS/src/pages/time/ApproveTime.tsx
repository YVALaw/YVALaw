import { useEffect, useState } from 'react'
import type { Employee, Project } from '../../data/types'
import { loadEmployees, loadProjects } from '../../services/storage'
import {
  approveTime, blocksActivity, decideRequest, loadManualRequests, loadTrackerBlocks, reopenTime,
  type ManualRequest, type TrackerBlock,
} from '../../services/trackerStorage'
import { Activity, Banner, Card, EmptyState, Field, Modal, Skel, Stepper, useIsMobile } from '../../components/ui'
import { hmClock, hmText } from '../../utils/format'

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
const md = (ms: number, year = false) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) })
function when(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

type DayCell = { tracked: number; approved: number }

/** Time Tracking → Approve: approve each person's finished days (or reopen them); decide missing-time requests */
export default function ApproveTime({ onChanged }: { onChanged?: () => void } = {}) {
  const mobile = useIsMobile()
  const [week, setWeek] = useState(() => mondayOf(Date.now()))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [blocks,    setBlocks]    = useState<TrackerBlock[] | null>(null)
  const [requests,  setRequests]  = useState<ManualRequest[]>([])
  const [busy,      setBusy]      = useState<string | null>(null)
  const [message,   setMessage]   = useState<{ ok: boolean; text: string } | null>(null)
  const [rejecting, setRejecting] = useState<ManualRequest | null>(null)
  const [reason,    setReason]    = useState('')

  useEffect(() => {
    void loadEmployees().then(setEmployees)
    void loadProjects().then(setProjects)
  }, [])

  async function load() {
    const [b, r] = await Promise.all([loadTrackerBlocks(week, addDays(week, 7)), loadManualRequests('pending')])
    setBlocks(b); setRequests(r)
  }
  useEffect(() => { setBlocks(null); void load() }, [week])   // eslint-disable-line react-hooks/exhaustive-deps

  const today = ymd(Date.now())
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const lastApprovable = days.map(ymd).filter(d => d < today).pop() ?? null   // finished days only

  const byEmployee = new Map<string, Map<string, DayCell>>()
  for (const b of blocks ?? []) {
    if (b.status !== 'tracked' && b.status !== 'approved') continue
    const cells = byEmployee.get(b.employeeId) ?? new Map<string, DayCell>()
    const day = ymd(b.blockStart)
    const c = cells.get(day) ?? { tracked: 0, approved: 0 }
    if (b.status === 'approved') c.approved += b.seconds; else c.tracked += b.seconds
    cells.set(day, c)
    byEmployee.set(b.employeeId, cells)
  }
  const activityOf = (employeeId: string, day?: string) => blocksActivity((blocks ?? []).filter(b => b.employeeId === employeeId && (!day || ymd(b.blockStart) === day)))
  const nameOf = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown employee'
  const targetOf = (r: ManualRequest) => (r.projectId ? projects.find(p => p.id === r.projectId)?.name ?? 'Project' : r.workType ?? '')
  const rows = [...byEmployee.entries()].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))

  function waitingSeconds(cells: Map<string, DayCell>): number {
    let s = 0
    for (const [day, c] of cells) if (lastApprovable && day <= lastApprovable) s += c.tracked
    return s
  }
  const waitingPeople = rows.filter(([, cells]) => waitingSeconds(cells) > 0)

  async function approve(employeeId: string) {
    if (!lastApprovable) return
    setBusy(employeeId); setMessage(null)
    try {
      const r = await approveTime(employeeId, ymd(week), lastApprovable)
      setMessage({ ok: true, text: `Approved ${nameOf(employeeId)}: ${r.entries} day/project total${r.entries === 1 ? '' : 's'} now in the time log, client portal and invoice import.` })
      await load(); onChanged?.()
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally { setBusy(null) }
  }

  /** Same approval as each person's button, for everyone with finished days waiting (one at a time) */
  async function approveAll() {
    if (!lastApprovable || waitingPeople.length === 0) return
    if (!window.confirm(`Approve the finished days (${md(week)} – ${md(new Date(`${lastApprovable}T12:00:00`).getTime())}) for ${waitingPeople.length} ${waitingPeople.length === 1 ? 'person' : 'people'}?`)) return
    setBusy('all'); setMessage(null)
    let ok = 0, entries = 0
    const failed: string[] = []
    for (const [employeeId] of waitingPeople) {
      try { const r = await approveTime(employeeId, ymd(week), lastApprovable); ok++; entries += r.entries }
      catch (e) { failed.push(`${nameOf(employeeId)} (${(e as Error).message})`) }
    }
    setMessage(failed.length
      ? { ok: false, text: `Approved ${ok} of ${waitingPeople.length}. Not approved: ${failed.join('; ')}` }
      : { ok: true, text: `Approved ${ok} ${ok === 1 ? 'person' : 'people'}: ${entries} day/project total${entries === 1 ? '' : 's'} now in the time log, client portal and invoice import.` })
    setBusy(null)
    await load(); onChanged?.()
  }

  async function reopen(employeeId: string) {
    const range = `${md(week)} – ${md(addDays(week, 6))}`
    if (!window.confirm(`Reopen ${nameOf(employeeId)}'s approved hours for ${range}?\n\nThey go back to "waiting" and leave the time log, the client portal and invoice import until you approve them again. If you already paid or invoiced them, fix that by hand.`)) return
    setBusy(`reopen:${employeeId}`); setMessage(null)
    try {
      const r = await reopenTime(employeeId, ymd(week), ymd(addDays(week, 6)))
      setMessage({ ok: true, text: `Reopened ${nameOf(employeeId)}'s week: ${r.entries} day/project total${r.entries === 1 ? '' : 's'} removed from the time log until approved again.` })
      await load(); onChanged?.()
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally { setBusy(null) }
  }

  async function decide(r: ManualRequest, ok: boolean, note?: string) {
    setBusy(r.id); setMessage(null)
    try {
      const res = await decideRequest(r.id, ok, note)
      setMessage({ ok: true, text: ok
        ? `Approved ${Math.round(res.seconds / 60)} min for ${nameOf(r.employeeId)}${res.seconds < (r.endsAt - r.startsAt) / 1000 ? ' (part of it was already tracked, so it was not added twice)' : ''}.`
        : `Rejected the request from ${nameOf(r.employeeId)}.` })
      setRejecting(null)
      await load(); onChanged?.()
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally { setBusy(null) }
  }

  const action = (employeeId: string, cells: Map<string, DayCell>) => {
    const waiting = waitingSeconds(cells)
    const approvedAny = [...cells.values()].some(c => c.approved > 0)
    return (
      <div className="ops-approve-actions">
        {waiting > 0 && (
          <button type="button" className="btn btn--primary btn--xs" disabled={busy !== null} onClick={() => void approve(employeeId)}>
            {busy === employeeId ? 'Approving…' : `Approve ${hmClock(waiting)}`}
          </button>
        )}
        {approvedAny && (
          <button type="button" className="btn btn--xs" disabled={busy !== null} title="Approved by mistake? Send this week's approved hours back to waiting" onClick={() => void reopen(employeeId)}>
            {busy === `reopen:${employeeId}` ? 'Reopening…' : waiting > 0 ? 'Reopen week' : 'Reopen'}
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="ops-toolbar">
        <Stepper label={`${md(week)} – ${md(addDays(week, 6), true)}`} onPrev={() => setWeek(w => addDays(w, -7))} onNext={() => setWeek(w => addDays(w, 7))} nextDisabled={addDays(week, 7) > Date.now()} prevLabel="Previous week" nextLabel="Next week" />
        <span className="ops-toolbar__note">Week of {md(week)} – {md(addDays(week, 6))} <span className="muted">· <span className="ops-dot-wait">●</span> = not approved yet</span></span>
        <span className="spacer" />
        <button type="button" className="btn btn--gold" disabled={busy !== null || waitingPeople.length === 0} onClick={() => void approveAll()}>{busy === 'all' ? 'Approving…' : 'Approve all finished days'}</button>
      </div>
      <p className="ops-help">Approved hours go to the time log, the client portal (client projects) and “Import YVA Time hours” on invoices. Today can't be approved until it's over.</p>

      {message && <Banner tone={message.ok ? 'success' : 'danger'} onClose={() => setMessage(null)}>{message.text}</Banner>}

      {blocks === null ? (
        <div className="card card--pad stack">{[0, 1, 2].map(i => <Skel key={i} h={44} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState>No YVA Time hours this week.</EmptyState>
      ) : mobile ? (
        <div className="mcards">
          {rows.map(([employeeId, cells]) => {
            const total = [...cells.values()].reduce((s, c) => s + c.tracked + c.approved, 0)
            return (
              <div key={employeeId} className="mcard">
                <div className="mcard__top"><span className="mcard__title">{nameOf(employeeId)}</span><span className="mono t-strong">{hmClock(total)}</span></div>
                <div className="ops-daychips">
                  {days.map((d, i) => {
                    const c = cells.get(ymd(d))
                    return (
                      <span key={d} className={`ops-daychip${c ? '' : ' ops-daychip--empty'}`}>
                        <span className="ops-daychip__d">{DAY_NAMES[i]}</span>
                        <span className={`mono${c && c.tracked === 0 ? ' t-success' : ''}`}>{c ? hmClock(c.tracked + c.approved) : '—'}{c && c.tracked > 0 && <span className="ops-dot-wait"> ●</span>}</span>
                        {c && <Activity pct={activityOf(employeeId, ymd(d))} />}
                      </span>
                    )
                  })}
                </div>
                <div className="mcard__meta">Week activity <Activity pct={activityOf(employeeId)} /></div>
                <div className="mcard__actions">{action(employeeId, cells)}</div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="table-card">
          <table className="table ops-approve-table">
            <thead>
              <tr>
                <th>Person</th>
                {days.map((d, i) => <th key={d} className="ops-c">{DAY_NAMES[i]} {new Date(d).getDate()}</th>)}
                <th className="t-right" title="Hours, and the share of tracked time with keyboard or mouse use (client team)">Total</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(([employeeId, cells]) => {
                const total = [...cells.values()].reduce((s, c) => s + c.tracked + c.approved, 0)
                return (
                  <tr key={employeeId}>
                    <td className="t-strong">{nameOf(employeeId)}</td>
                    {days.map(d => {
                      const c = cells.get(ymd(d))
                      if (!c) return <td key={d} className="ops-c soft mono">—</td>
                      const allApproved = c.tracked === 0
                      return (
                        <td key={d} className="ops-c" title={`${hmText(c.approved)} approved · ${hmText(c.tracked)} waiting`}>
                          <span className={`mono ops-cell-h${allApproved ? ' t-success' : ''}`}>{hmClock(c.tracked + c.approved)}{!allApproved && <span className="ops-dot-wait"> ●</span>}</span>
                          <span className="ops-cell-act"><Activity pct={activityOf(employeeId, ymd(d))} /></span>
                        </td>
                      )
                    })}
                    <td className="t-right">
                      <span className="mono t-strong ops-cell-h">{hmClock(total)}</span>
                      <span className="ops-cell-act">{activityOf(employeeId) !== null && <><Activity pct={activityOf(employeeId)} /> active</>}</span>
                    </td>
                    <td className="t-actions">{action(employeeId, cells)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="ops-table-foot">Hours per day (h:mm) · <span className="ops-dot-wait">●</span> = not approved yet · green = approved · % = keyboard/mouse use (client team)</div>
        </div>
      )}

      <Card title="Missing-time requests" meta={requests.length ? `${requests.length} waiting` : undefined}>
        {requests.length === 0 ? <div className="card-empty">No requests waiting.</div> : requests.map(r => (
          <div key={r.id} className="list-row ops-req">
            <div className="list-row__main">
              <span className="list-row__title">{nameOf(r.employeeId)} · {hmText((r.endsAt - r.startsAt) / 1000)}</span>
              <span className="list-row__meta">{when(r.startsAt)} – {new Date(r.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {targetOf(r)} · “{r.reason}”</span>
            </div>
            <div className="ops-req__btns">
              <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => { setReason(''); setRejecting(r) }}>Reject…</button>
              <button type="button" className="btn btn--sm btn--primary" disabled={busy !== null} onClick={() => void decide(r, true)}>{busy === r.id ? '…' : 'Approve'}</button>
            </div>
          </div>
        ))}
      </Card>

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject missing time" sub={rejecting ? `${nameOf(rejecting.employeeId)} · ${when(rejecting.startsAt)}` : undefined}
        footer={<><button type="button" className="btn" onClick={() => setRejecting(null)}>Cancel</button><button type="button" className="btn ops-btn-danger" disabled={busy !== null} onClick={() => rejecting && void decide(rejecting, false, reason)}>{busy ? 'Rejecting…' : 'Reject'}</button></>}>
        <Field label="Reason for rejecting" hint="The employee sees this."><textarea className="textarea" aria-label="Reason for rejecting" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></Field>
      </Modal>
    </>
  )
}
