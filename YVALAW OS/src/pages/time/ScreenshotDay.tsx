import { useEffect, useState } from 'react'
import type { Employee, Project } from '../../data/types'
import { loadEmployees, loadProjects } from '../../services/storage'
import {
  activityColor, activityPct, blocksActivity, deleteTrackerShot, loadTrackerBlocks, loadTrackerShots, signScreenshotUrls,
  type TrackerBlock, type TrackerShot,
} from '../../services/trackerStorage'

const BLOCK_MS = 600_000
const DAY_MS = 86_400_000

function todayInput(): string {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function clock(ms: number): string { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
function hm(seconds: number): string { return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m` }

type Cell = { blockStart: number; seconds: number; active: number; measured: number; removed: boolean; labels: string[]; notes: string[]; shots: TrackerShot[] }

type Props = {
  /** Open on this person / day (links from the employee profile and the Live tab) */
  initialEmployee?: string
  initialDay?: string
  /** My workspace: the signed-in employee's own screenshots (no picker, no delete) */
  self?: { employeeId: string; projectNames: Record<string, string> }
}

/** Time Tracking → Screenshots (CEO/Admin), and My workspace → My screenshots: one person's day in 10-minute blocks */
export default function ScreenshotDay({ initialEmployee, initialDay, self }: Props = {}) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [employeeId, setEmployeeId] = useState(self?.employeeId ?? initialEmployee ?? '')
  const [day, setDay] = useState(initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) ? initialDay : todayInput())
  const [blocks, setBlocks] = useState<TrackerBlock[]>([])
  const [shots,  setShots]  = useState<TrackerShot[]>([])
  const [urls,   setUrls]   = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<Cell | null>(null)

  useEffect(() => {
    if (self) return                                     // employees can't (and needn't) list other people
    void loadEmployees().then(list => {
      const tracked = list.filter(e => e.userId && e.worksFor !== 'yva')
      setEmployees(tracked)
      if (tracked[0]) setEmployeeId(id => id || tracked[0].id)
    })
    void loadProjects().then(setProjects)
  }, [])

  async function load() {
    if (!employeeId) return
    setLoading(true)
    const from = new Date(`${day}T00:00:00`).getTime()
    const [b, s] = await Promise.all([loadTrackerBlocks(from, from + DAY_MS, employeeId), loadTrackerShots(employeeId, from, from + DAY_MS)])
    setBlocks(b); setShots(s)
    setUrls(await signScreenshotUrls(s.map(x => x.storagePath)))
    setLoading(false)
  }
  useEffect(() => { void load() }, [employeeId, day])   // eslint-disable-line react-hooks/exhaustive-deps

  const label = (b: TrackerBlock) => (b.projectId
    ? (self ? self.projectNames[b.projectId] : projects.find(p => p.id === b.projectId)?.name) ?? 'Project'
    : b.workType ?? '')
  const cells = new Map<number, Cell>()
  const cellAt = (bs: number) => {
    let c = cells.get(bs)
    if (!c) { c = { blockStart: bs, seconds: 0, active: 0, measured: 0, removed: false, labels: [], notes: [], shots: [] }; cells.set(bs, c) }
    return c
  }
  for (const b of blocks) {
    const c = cellAt(b.blockStart)
    if (b.status === 'removed') { c.removed = true; continue }
    c.seconds += b.seconds
    if (b.activeSeconds !== null) { c.active += b.activeSeconds; c.measured += b.seconds }
    if (!c.labels.includes(label(b))) c.labels.push(label(b))
    if (b.note && !c.notes.includes(b.note)) c.notes.push(b.note)
  }
  for (const s of shots) cellAt(s.blockStart).shots.push(s)

  const hours = [...new Set([...cells.keys()].map(bs => new Date(bs).getHours()))].sort((a, b) => a - b)
  const dayStart = new Date(`${day}T00:00:00`).getTime()
  const total = [...cells.values()].reduce((s, c) => s + (c.removed ? 0 : c.seconds), 0)
  const dayActivity = blocksActivity(blocks)

  async function removeShots(cell: Cell) {
    if (!window.confirm('Delete these screenshots? The tracked time is not changed.')) return
    for (const s of cell.shots) await deleteTrackerShot(s)
    setOpen(null)
    await load()
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        {!self && (
          <div className="form-group" style={{ minWidth: 220, margin: 0 }}>
            <label className="form-label">Employee (client team)</label>
            <select className="form-select" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              {employees.length === 0 && <option value="">No client-team employees with a login</option>}
              {employees.length > 0 && !employees.some(e => e.id === employeeId) && <option value={employeeId}>Pick an employee</option>}
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Day</label>
          <input className="form-input" type="date" value={day} onChange={e => setDay(e.target.value || todayInput())} />
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)' }}>
          {loading ? 'Loading…' : <>
            Tracked <strong style={{ color: 'var(--text)' }}>{hm(total)}</strong>
            {dayActivity !== null && <> · Activity <strong style={{ color: activityColor(dayActivity) }}>{dayActivity}%</strong></>}
            {' '}· {shots.length} screenshot{shots.length === 1 ? '' : 's'}
          </>}
        </div>
      </div>

      {!loading && hours.length === 0 && (
        <div className="data-card" style={{ color: 'var(--muted)', fontSize: 14 }}>No tracked time on this day.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {hours.map(h => (
          <div key={h} className="data-card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>{clock(dayStart + h * 3_600_000)}</div>
            <div className="tracker-hour-grid">
              {Array.from({ length: 6 }, (_, i) => {
                const bs = dayStart + h * 3_600_000 + i * BLOCK_MS
                const c = cells.get(bs)
                const first = c?.shots.find(s => s.monitor === 0) ?? c?.shots[0]
                return (
                  <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 8, fontSize: 12, background: c ? 'var(--surface)' : 'var(--surf2)', opacity: c ? 1 : 0.6 }}>
                    <div style={{ color: 'var(--muted)', marginBottom: 6 }}>{clock(bs)}</div>
                    {c?.removed ? (
                      <div style={{ height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', textAlign: 'center' }}>Deleted by employee<br />(time removed)</div>
                    ) : first && urls[first.storagePath] ? (
                      <img src={urls[first.storagePath]} alt={`Screenshot ${clock(first.takenAt)}`} onClick={() => setOpen(c!)}
                        style={{ width: '100%', height: 84, objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', background: '#111' }} />
                    ) : (
                      <div style={{ height: 84, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>{c ? 'No screenshot' : '—'}</div>
                    )}
                    {c && !c.removed && (
                      <div style={{ marginTop: 6 }}>
                        <strong>{Math.round(c.seconds / 60)} min</strong>
                        {activityPct(c.active, c.measured) !== null && (
                          <span title="Keyboard/mouse use in this block" style={{ marginLeft: 6, fontWeight: 600, color: activityColor(activityPct(c.active, c.measured)!) }}>
                            {activityPct(c.active, c.measured)}%
                          </span>
                        )}
                        <div style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={[...c.labels, ...c.notes].join(' — ')}>
                          {c.labels.join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(null)}>
          <div className="modal" style={{ maxWidth: 1100, width: '95vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                {clock(open.blockStart)} – {clock(open.blockStart + BLOCK_MS)} · {Math.round(open.seconds / 60)} min
                {activityPct(open.active, open.measured) !== null && ` · ${activityPct(open.active, open.measured)}% active`} · {open.labels.join(', ')}
              </div>
              <button className="modal-close btn-icon" onClick={() => setOpen(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {open.notes.length > 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{open.notes.join(' — ')}</div>}
              {open.shots.map(s => urls[s.storagePath] && (
                <div key={s.id}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Screen {s.monitor + 1} · taken {clock(s.takenAt)}</div>
                  <img src={urls[s.storagePath]} alt={`Screen ${s.monitor + 1}`} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                </div>
              ))}
            </div>
            <div className="modal-footer">
              {!self && <button className="btn-danger btn-sm" onClick={() => void removeShots(open)}>Delete screenshots</button>}
              <button className="btn-ghost btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
