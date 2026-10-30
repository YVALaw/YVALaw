import { useEffect, useState } from 'react'
import type { Employee, Project } from '../../data/types'
import { loadEmployees, loadProjects } from '../../services/storage'
import { loadTrackerBlocks, type TrackerBlock } from '../../services/trackerStorage'

const DAY_MS = 86_400_000
const LIVE_WINDOW_MS = 3 * 60_000     // the app uploads about once a minute while tracking

function startOfToday(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
function hm(seconds: number): string { return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m` }
function clock(ms: number): string { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }

type Row = { employee: Employee; seconds: number; latest: TrackerBlock | null; tracking: boolean }

/** Time Tracking → Live: who is tracking right now and today's hours (YVA Time desktop app) */
export default function LiveBoard() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [blocks,    setBlocks]    = useState<TrackerBlock[]>([])
  const [loadedAt,  setLoadedAt]  = useState(0)
  const [filter,    setFilter]    = useState<'all' | 'client' | 'yva'>('all')

  useEffect(() => {
    void loadEmployees().then(setEmployees)
    void loadProjects().then(setProjects)
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      const from = startOfToday()
      const rows = await loadTrackerBlocks(from, from + DAY_MS)
      if (alive) { setBlocks(rows); setLoadedAt(Date.now()) }
    }
    void load()
    const id = setInterval(() => void load(), 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const projectName = (id: string | null) => projects.find(p => p.id === id)?.name ?? 'Project'

  const rows: Row[] = employees
    .map(employee => {
      const mine = blocks.filter(b => b.employeeId === employee.id && b.status !== 'removed')
      const latest = mine.reduce<TrackerBlock | null>((a, b) => (!a || b.updatedAt > a.updatedAt ? b : a), null)
      return {
        employee,
        seconds: mine.reduce((s, b) => s + b.seconds, 0),
        latest,
        tracking: !!latest && loadedAt - latest.updatedAt < LIVE_WINDOW_MS,
      }
    })
    .filter(r => r.employee.userId || r.seconds > 0)
    .filter(r => filter === 'all' || (filter === 'yva' ? r.employee.worksFor === 'yva' : r.employee.worksFor !== 'yva'))
    .sort((a, b) => Number(b.tracking) - Number(a.tracking) || b.seconds - a.seconds || a.employee.name.localeCompare(b.employee.name))

  const trackingNow = rows.filter(r => r.tracking).length
  const totalToday  = rows.reduce((s, r) => s + r.seconds, 0)

  return (
    <>
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card"><div className="kpi-label">Tracking now</div><div className="kpi-value">{trackingNow}</div><div className="kpi-sub">updated {loadedAt ? clock(loadedAt) : '—'}</div></div>
        <div className="kpi-card"><div className="kpi-label">Hours today</div><div className="kpi-value">{hm(totalToday)}</div><div className="kpi-sub">from YVA Time</div></div>
        <div className="kpi-card"><div className="kpi-label">People with a login</div><div className="kpi-value">{employees.filter(e => e.userId).length}</div><div className="kpi-sub">invite from an employee profile</div></div>
      </div>

      <div className="filter-tabs">
        {(['all', 'client', 'yva'] as const).map(f => (
          <button key={f} className={`filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Everyone' : f === 'client' ? 'Client team' : 'YVA team'}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="data-card" style={{ color: 'var(--muted)', fontSize: 14 }}>
          Nobody has tracked time today yet. Employees need a login (Employee profile → YVA Time Login) and the YVA Time app.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Employee</th><th>Status</th><th>Working on</th><th style={{ textAlign: 'right' }}>Today</th></tr>
            </thead>
            <tbody>
              {rows.map(({ employee, seconds, latest, tracking }) => (
                <tr key={employee.id}>
                  <td className="td-name">
                    {employee.name}
                    <span className={`badge ${employee.worksFor === 'yva' ? 'badge-yellow' : 'badge-blue'}`} style={{ marginLeft: 8, fontSize: 10 }}>
                      {employee.worksFor === 'yva' ? 'YVA team' : 'Client team'}
                    </span>
                  </td>
                  <td>
                    {tracking
                      ? <span className="badge badge-green">● Tracking now</span>
                      : latest ? <span className="td-muted">Last active {clock(latest.updatedAt)}</span>
                      : <span className="td-muted">Not today</span>}
                  </td>
                  <td className="td-muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={latest?.note ?? undefined}>
                    {latest ? (latest.projectId ? projectName(latest.projectId) : latest.workType) : '—'}
                    {latest?.note ? ` — ${latest.note}` : ''}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{hm(seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
