import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import { can } from '../../lib/roles'
import type { Employee, Project } from '../../data/types'
import { loadEmployees, loadProjects } from '../../services/storage'
import { blocksActivity, loadConnectedDevices, loadTrackerBlocks, type TrackerBlock } from '../../services/trackerStorage'
import { Activity, Chips, EmptyState, Pill, Skel, useIsMobile } from '../../components/ui'
import { ago, hmClock } from '../../utils/format'

const DAY_MS = 86_400_000
const LIVE_WINDOW_MS = 3 * 60_000     // the app uploads about once a minute while tracking
const CONNECTED_WINDOW_MS = DAY_MS   // a computer counts as connected when it checked in within 24 h

function startOfToday(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
function dayInput(ms: number): string {
  const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function clock(ms: number): string { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }

type Row = { employee: Employee; seconds: number; activity: number | null; latest: TrackerBlock | null; tracking: boolean }

/** Time Tracking → Live: who is tracking right now and today's hours (YVA Time desktop app) */
export default function LiveBoard() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [blocks,    setBlocks]    = useState<TrackerBlock[]>([])
  const [loadedAt,  setLoadedAt]  = useState(0)
  const [devices,   setDevices]   = useState<{ lastSeenAt: number }[] | null>(null)
  const [filter,    setFilter]    = useState<'all' | 'client' | 'yva'>('all')
  const { role } = useRole()
  const showShots = can.viewScreenshots(role)
  const mobile = useIsMobile()

  useEffect(() => {
    void loadEmployees().then(setEmployees)
    void loadProjects().then(setProjects)
  }, [])

  useEffect(() => {
    let alive = true
    const load = async () => {
      const from = startOfToday()
      const [rows, devs] = await Promise.all([loadTrackerBlocks(from, from + DAY_MS), loadConnectedDevices(Date.now() - CONNECTED_WINDOW_MS)])
      if (alive) { setBlocks(rows); setDevices(devs); setLoadedAt(Date.now()) }
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
        activity: blocksActivity(mine),
        latest,
        tracking: !!latest && loadedAt - latest.updatedAt < LIVE_WINDOW_MS,
      }
    })
    .filter(r => r.employee.userId || r.seconds > 0)
    .filter(r => filter === 'all' || (filter === 'yva' ? r.employee.worksFor === 'yva' : r.employee.worksFor !== 'yva'))
    .sort((a, b) => Number(b.tracking) - Number(a.tracking) || b.seconds - a.seconds || a.employee.name.localeCompare(b.employee.name))

  const trackingNow = rows.filter(r => r.tracking).length
  const totalToday  = rows.reduce((s, r) => s + r.seconds, 0)
  const onlineNow   = devices ? devices.filter(d => loadedAt - d.lastSeenAt < LIVE_WINDOW_MS).length : 0

  const state = (r: Row) => (r.tracking ? `Tracking · ${ago(r.latest!.updatedAt)}` : r.latest ? `Last active ${clock(r.latest.updatedAt)}` : 'Not today')
  const working = (r: Row) => (r.latest ? (r.latest.projectId ? projectName(r.latest.projectId) : r.latest.workType ?? '—') : '—')
  const shotsLink = (r: Row) => showShots && r.employee.worksFor !== 'yva' && r.seconds > 0
    ? <Link to={`/time?tab=screens&employee=${r.employee.id}&day=${dayInput(Date.now())}`} className="btn btn--xs" aria-label="View screenshots">Screenshots</Link>
    : null
  const team = (e: Employee) => <Pill tone={e.worksFor === 'yva' ? 'gold' : 'info'}>{e.worksFor === 'yva' ? 'YVA team' : 'Client team'}</Pill>

  return (
    <>
      <div className="ops-stats3">
        <div className="card ops-statcard"><span className="ops-statcard__label">Tracking now</span><span className="ops-statcard__value">{loadedAt ? trackingNow : '—'}</span><span className="ops-statcard__note">updated {loadedAt ? clock(loadedAt) : '—'}</span></div>
        <div className="card ops-statcard"><span className="ops-statcard__label">Hours today</span><span className="ops-statcard__value mono">{hmClock(totalToday)}</span><span className="ops-statcard__note">from YVA Time</span></div>
        <div className="card ops-statcard" data-stat="computers"><span className="ops-statcard__label">Computers connected</span><span className="ops-statcard__value">{devices ? devices.length : '—'}</span><span className="ops-statcard__note">{devices ? `${onlineNow} online now` : '—'}</span></div>
      </div>

      <Chips small value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Everyone' }, { value: 'client', label: 'Client team' }, { value: 'yva', label: 'YVA team' }]} />

      {!loadedAt ? (
        <div className="card card--pad stack">{[0, 1, 2, 3].map(i => <Skel key={i} h={40} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState>Nobody has tracked time today yet. Employees need a login (Employee profile → YVA Time Login) and the YVA Time app.</EmptyState>
      ) : mobile ? (
        <div className="mcards">
          {rows.map(r => (
            <div key={r.employee.id} className="mcard">
              <div className="mcard__top">
                <div className="ops-live-person">
                  <span className={r.tracking ? 'dot dot--live' : 'dot ops-dot-idle'} aria-hidden />
                  <div><div className="mcard__title">{r.employee.name}</div><div className="mcard__meta">{state(r)}</div></div>
                </div>
                <span className="mono ops-live-today">{hmClock(r.seconds)}</span>
              </div>
              <div className="mcard__meta">{working(r)}{r.latest?.note ? ` — ${r.latest.note}` : ''}</div>
              <div className="row row--between">{team(r.employee)}<span>Activity <Activity pct={r.activity} /></span></div>
              {shotsLink(r) && <div className="mcard__actions">{shotsLink(r)}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="table-card">
          <table className="table ops-min-780">
            <thead>
              <tr>
                <th>Person</th><th>Working on</th><th>Today</th>
                <th title="Share of today's tracked time with keyboard or mouse use (client team)">Activity</th>
                <th aria-label="Screenshots" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.employee.id} className="ops-live-row">
                  <td>
                    <div className="ops-live-person">
                      <span className={r.tracking ? 'dot dot--live' : 'dot ops-dot-idle'} aria-label={r.tracking ? 'Tracking now' : 'Not tracking'} />
                      <div>
                        <div className="t-strong">{r.employee.name} {team(r.employee)}</div>
                        <span className="t-sub">{state(r)}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div>{working(r)}</div>
                    <span className="t-sub ops-ellipsis" title={r.latest?.note ?? undefined}>{r.latest?.note || '—'}</span>
                  </td>
                  <td className="mono">{hmClock(r.seconds)}</td>
                  <td className="ops-strong"><Activity pct={r.activity} /></td>
                  <td className="t-actions">{shotsLink(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
