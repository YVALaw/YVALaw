import { useEffect, useState } from 'react'
import type { Employee } from '../../data/types'
import { loadEmployees } from '../../services/storage'
import { LOCAL_TZ, loadTrackerBlocks, type TrackerBlock } from '../../services/trackerStorage'
import { scheduleWeek, type ScheduleDay } from '../../utils/schedule'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_MS = 86_400_000

function mondayOf(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime()
}
function addDays(ms: number, n: number): number {
  const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime()     // DST-safe
}
function clock(ms: number): string { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
function mins(m: number): string { return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
function hm(seconds: number): string { return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m` }

const RED = '#b91c1c', AMBER = '#b45309', GREEN = '#047857', BLUE = '#1d4ed8'

function chip(d: ScheduleDay): { text: string; color: string } | null {
  switch (d.status) {
    case 'on-time':         return { text: 'On time', color: GREEN }
    case 'late':            return { text: `Late ${mins(d.lateMin)}`, color: AMBER }
    case 'left-early':      return { text: `Left ${mins(d.earlyMin)} early`, color: AMBER }
    case 'late-left-early': return { text: `Late ${mins(d.lateMin)} · left ${mins(d.earlyMin)} early`, color: RED }
    case 'absent':          return { text: 'No time', color: RED }
    case 'not-started':     return { text: 'Not started', color: RED }
    case 'in-progress':     return { text: 'On shift', color: BLUE }
    case 'outside-shift':   return { text: 'Only outside shift hours', color: AMBER }
    case 'extra-day':       return { text: 'Extra day', color: BLUE }
    default:                return null
  }
}

type Row = { employee: Employee; days: ScheduleDay[] }

/** Time Tracking → Schedule: shift vs. first/last tracked moment each day (late, left early, no time) */
export default function ScheduleReport() {
  const [week, setWeek] = useState(() => mondayOf(Date.now()))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [blocks, setBlocks] = useState<TrackerBlock[]>([])
  const [grace, setGrace] = useState(5)
  const [filter, setFilter] = useState<'all' | 'client' | 'yva'>('all')
  const [loading, setLoading] = useState(false)

  useEffect(() => { void loadEmployees().then(setEmployees) }, [])
  useEffect(() => {
    let alive = true
    setLoading(true)
    // A day either side, so overnight shifts at the edges of the week are complete
    void loadTrackerBlocks(week - DAY_MS, addDays(week, 8)).then(b => { if (alive) { setBlocks(b); setLoading(false) } })
    return () => { alive = false }
  }, [week])

  const now = Date.now()
  const counted = blocks.filter(b => b.status !== 'removed' && b.status !== 'rejected')
  const rows: Row[] = employees
    .filter(e => (e.userId && !/^(inactive|terminated|former)/i.test(e.status ?? '')) || counted.some(b => b.employeeId === e.id))
    .filter(e => filter === 'all' || (filter === 'yva' ? e.worksFor === 'yva' : e.worksFor !== 'yva'))
    .map(employee => ({
      employee,
      days: scheduleWeek(counted.filter(b => b.employeeId === employee.id), employee.defaultShiftStart, employee.defaultShiftEnd, week, now, grace),
    }))
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name))

  // Saturday/Sunday only when someone worked them (keeps the table readable)
  const shownDays = [0, 1, 2, 3, 4, 5, 6].filter(i => i < 5 || rows.some(r => r.days[i].seconds > 0))
  const count = (r: Row, ...statuses: ScheduleDay['status'][]) => r.days.filter(d => statuses.includes(d.status)).length
  const lateTotal = (r: Row) => r.days.reduce((s, d) => s + (d.status === 'late' || d.status === 'late-left-early' ? d.lateMin : 0), 0)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button className="btn-ghost btn-sm" onClick={() => setWeek(w => addDays(w, -7))}>← Previous week</button>
        <strong style={{ padding: '0 6px' }}>
          {new Date(week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {new Date(addDays(week, 6)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </strong>
        <button className="btn-ghost btn-sm" disabled={addDays(week, 7) > now} onClick={() => setWeek(w => addDays(w, 7))}>Next week →</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginLeft: 8 }}>
          Allow
          <select className="form-select" style={{ width: 'auto', padding: '4px 8px' }} value={grace} onChange={e => setGrace(Number(e.target.value))}>
            {[0, 5, 10, 15].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
          before counting late / early
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          Shifts from each employee profile, Mon–Fri · times in your time zone ({LOCAL_TZ})
        </span>
      </div>

      <div className="filter-tabs">
        {(['all', 'client', 'yva'] as const).map(f => (
          <button key={f} className={`filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Everyone' : f === 'client' ? 'Client team' : 'YVA team'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="data-card" style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="data-card" style={{ color: 'var(--muted)', fontSize: 14 }}>
          No one to show. Employees appear here once they have a YVA Time login (Employee profile → YVA Time Login).
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                {shownDays.map(i => <th key={i}>{DAY_NAMES[i]} {new Date(addDays(week, i)).getDate()}</th>)}
                <th style={{ textAlign: 'right' }}>Week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const shift = r.employee.defaultShiftStart && r.employee.defaultShiftEnd
                  ? `${r.employee.defaultShiftStart} – ${r.employee.defaultShiftEnd}` : null
                const late = count(r, 'late', 'late-left-early'), early = count(r, 'left-early', 'late-left-early'), absent = count(r, 'absent')
                const total = r.days.reduce((s, d) => s + d.seconds, 0)
                return (
                  <tr key={r.employee.id}>
                    <td className="td-name" style={{ minWidth: 150 }}>
                      {r.employee.name}
                      <div style={{ fontSize: 11, fontWeight: 400, color: shift ? 'var(--muted)' : AMBER }}>
                        {shift ?? 'No shift on profile'}
                      </div>
                    </td>
                    {shownDays.map(i => {
                      const d = r.days[i], c = chip(d)
                      return (
                        <td key={d.day} style={{ fontSize: 12, verticalAlign: 'top', whiteSpace: 'nowrap', padding: '10px 8px',
                          background: d.status === 'day-off' ? 'var(--surf2)' : undefined }}>
                          {d.firstAt !== null && d.lastAt !== null ? (
                            <div>{clock(d.firstAt)} – {clock(d.lastAt)}</div>
                          ) : (
                            <div className="td-muted">{d.status === 'day-off' ? 'Off' : '—'}</div>
                          )}
                          {d.seconds > 0 && <div className="td-muted">{hm(d.seconds)}</div>}
                          {c && <div style={{ color: c.color, fontWeight: 600, marginTop: 2 }}>{c.text}</div>}
                        </td>
                      )
                    })}
                    <td style={{ textAlign: 'right', fontSize: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{hm(total)}</div>
                      {late > 0 && <div style={{ color: AMBER }}>Late {late}× ({mins(lateTotal(r))})</div>}
                      {early > 0 && <div style={{ color: AMBER }}>Left early {early}×</div>}
                      {absent > 0 && <div style={{ color: RED }}>No time {absent} day{absent === 1 ? '' : 's'}</div>}
                      {shift && late + early + absent === 0 && total > 0 && <div style={{ color: GREEN }}>All on time</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 4px' }}>
            First and last tracked moment each day from YVA Time (approved manual time included). Saturday and Sunday show when someone
            worked them. "No time" can also mean a day off or holiday — check before acting on it.
          </div>
        </div>
      )}
    </>
  )
}
