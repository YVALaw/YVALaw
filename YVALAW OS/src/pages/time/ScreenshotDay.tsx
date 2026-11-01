import { useEffect, useState } from 'react'
import type { Employee, Project } from '../../data/types'
import { loadEmployees, loadProjects } from '../../services/storage'
import { Activity, EmptyState, Field, Modal, Skel } from '../../components/ui'
import {
  activityPct, blocksActivity, deleteTrackerShot, loadTrackerBlocks, loadTrackerShots, signScreenshotUrls,
  type TrackerBlock, type TrackerShot,
} from '../../services/trackerStorage'

const BLOCK_MS = 600_000
const DAY_MS = 86_400_000

function todayInput(): string {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Staff pages stay English (lang defaults to 'en'); My workspace passes the employee's language */
function clock(ms: number, lang: 'en' | 'es' = 'en'): string { return new Date(ms).toLocaleTimeString(lang === 'es' ? 'es-DO' : 'en-US', { hour: 'numeric', minute: '2-digit' }) }
function hm(seconds: number): string { return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m` }

type Cell = { blockStart: number; seconds: number; active: number; measured: number; removed: boolean; labels: string[]; notes: string[]; shots: TrackerShot[] }

type Props = {
  /** Open on this person / day (links from the employee profile and the Live tab) */
  initialEmployee?: string
  initialDay?: string
  /** My workspace: the signed-in employee's own screenshots (no picker, no delete) */
  self?: { employeeId: string; projectNames: Record<string, string> }
  /** My workspace language */
  lang?: 'en' | 'es'
}
const L = {
  en: { day: 'Day', tracked: 'Tracked', activity: 'Activity', shot: 'screenshot', shots: 'screenshots', none: 'No tracked time on this day.', noShot: 'No screenshot', deleted: 'Deleted by employee', removed: '(time removed)', active: 'active', screen: 'Screen', taken: 'taken', close: 'Close', loading: 'Loading…', min: 'min', policy: 'CEO/Admin only · kept 60 days · never shown to clients', selfPolicy: 'Kept 60 days · never shown to clients', noTime: 'no time', del: 'Delete screenshots', employee: 'Employee (client team)', open: 'Open screenshot' },
  es: { day: 'Día', tracked: 'Registrado', activity: 'Actividad', shot: 'captura', shots: 'capturas', none: 'No hay tiempo registrado este día.', noShot: 'Sin captura', deleted: 'Borrada por ti', removed: '(tiempo quitado)', active: 'activo', screen: 'Pantalla', taken: 'tomada', close: 'Cerrar', loading: 'Cargando…', min: 'min', policy: 'Solo CEO/Admin · se guardan 60 días · nunca se muestran a clientes', selfPolicy: 'Se guardan 60 días · nunca se muestran al cliente', noTime: 'sin tiempo', del: 'Borrar capturas', employee: 'Empleado (equipo del cliente)', open: 'Abrir captura' },
}

/** Time Tracking → Screenshots (CEO/Admin), and My workspace → My screenshots: one person's day in 10-minute blocks */
export default function ScreenshotDay({ initialEmployee, initialDay, self, lang = 'en' }: Props = {}) {
  const tx = L[lang]
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [employeeId, setEmployeeId] = useState(self?.employeeId ?? initialEmployee ?? '')
  const [day, setDay] = useState(initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) ? initialDay : todayInput())
  const [blocks, setBlocks] = useState<TrackerBlock[]>([])
  const [shots,  setShots]  = useState<TrackerShot[]>([])
  const [urls,   setUrls]   = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
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
    if (!employeeId) { setLoading(false); return }
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

  const [delError, setDelError] = useState<string | null>(null)
  async function removeShots(cell: Cell) {
    if (!window.confirm('Delete these screenshots? The tracked time is not changed.')) return
    setDelError(null)
    let failed = 0
    for (const s of cell.shots) if (!(await deleteTrackerShot(s))) failed++
    if (failed) { setDelError(`${failed} screenshot${failed === 1 ? '' : 's'} could not be deleted.`); await load(); return }
    setOpen(null)
    await load()
  }
  const barClass = (c?: Cell) => {
    if (!c || c.removed) return 'ops-shot__bar'
    const a = activityPct(c.active, c.measured)
    return `ops-shot__bar ${a === null ? 'ops-shot__bar--none' : a >= 60 ? 'ops-shot__bar--high' : a >= 30 ? 'ops-shot__bar--mid' : 'ops-shot__bar--low'}`
  }

  return (
    <>
      <div className="ops-shot-tools">
        {!self && (
          <Field label={tx.employee}>
            <select className="select" aria-label={tx.employee} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              {employees.length === 0 && <option value="">No client-team employees with a login</option>}
              {employees.length > 0 && !employees.some(e => e.id === employeeId) && <option value={employeeId}>Pick an employee</option>}
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={tx.day}>
          <input className="input" type="date" aria-label={tx.day} value={day} onChange={e => setDay(e.target.value || todayInput())} />
        </Field>
        <p className="ops-shot-sum">
          {loading ? tx.loading : <>
            <b className="num">{hm(total)}</b> {tx.tracked.toLowerCase()}
            {dayActivity !== null && <> · <Activity pct={dayActivity} /> {tx.activity.toLowerCase()}</>}
            {' '}· {shots.length} {shots.length === 1 ? tx.shot : tx.shots} · {self ? tx.selfPolicy : tx.policy}
          </>}
        </p>
      </div>

      {loading ? (
        <div className="card card--pad stack">{[0, 1].map(i => <Skel key={i} h={90} />)}</div>
      ) : hours.length === 0 ? (
        <EmptyState>{tx.none}</EmptyState>
      ) : (
        <div className="card ops-shots">
          {hours.map(h => (
            <div key={h} className="ops-shot-hour tracker-hour-grid">
              <span className="ops-shot-hour__label mono">{clock(dayStart + h * 3_600_000, lang).replace(':00', '')}</span>
              {Array.from({ length: 6 }, (_, i) => {
                const bs = dayStart + h * 3_600_000 + i * BLOCK_MS
                const c = cells.get(bs)
                const first = c?.shots.find(s => s.monitor === 0) ?? c?.shots[0]
                const act = c ? activityPct(c.active, c.measured) : null
                return (
                  <div key={i} className={`ops-shot${c ? '' : ' ops-shot--empty'}`}>
                    {c?.removed ? (
                      <div className="ops-shot__img ops-shot__img--note">{tx.deleted}<br />{tx.removed}</div>
                    ) : first && urls[first.storagePath] ? (
                      <button type="button" className="ops-shot__img ops-shot__img--btn" onClick={() => setOpen(c!)} aria-label={`${tx.open} ${clock(first.takenAt, lang)}`}>
                        <img src={urls[first.storagePath]} alt={`Screenshot ${clock(first.takenAt, lang)}`} />
                        {c!.shots.length > 1 && <span className="ops-shot__count">{c!.shots.length}</span>}
                      </button>
                    ) : (
                      <div className="ops-shot__img ops-shot__img--note">{c ? tx.noShot : tx.noTime}</div>
                    )}
                    <div className={barClass(c)} aria-hidden />
                    <div className="ops-shot__cap">
                      <span className="mono">{clock(bs, lang)}</span>
                      {c && !c.removed && <span>{Math.round(c.seconds / 60)} {tx.min}{act !== null && <> · <Activity pct={act} /></>}</span>}
                    </div>
                    {c && !c.removed && c.labels.length > 0 && <div className="ops-shot__label" title={[...c.labels, ...c.notes].join(' — ')}>{c.labels.join(', ')}</div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!open} onClose={() => { setOpen(null); setDelError(null) }} size="xl"
        title={open ? `${clock(open.blockStart, lang)} – ${clock(open.blockStart + BLOCK_MS, lang)} · ${Math.round(open.seconds / 60)} ${tx.min}${activityPct(open.active, open.measured) !== null ? ` · ${activityPct(open.active, open.measured)}% ${tx.active}` : ''}` : ''}
        sub={open ? [open.labels.join(', '), open.notes.join(' — ')].filter(Boolean).join(' · ') : undefined}
        footer={<>
          {!self && open && <button type="button" className="btn ops-btn-danger-text" onClick={() => void removeShots(open)}>{tx.del}</button>}
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => setOpen(null)}>{tx.close}</button>
        </>}>
        {delError && <p className="t-danger">{delError}</p>}
        {open?.shots.map(s => urls[s.storagePath] && (
          <figure key={s.id} className="ops-shot-full">
            <figcaption>{tx.screen} {s.monitor + 1} · {tx.taken} {clock(s.takenAt, lang)}</figcaption>
            <img src={urls[s.storagePath]} alt={`Screen ${s.monitor + 1}`} />
          </figure>
        ))}
      </Modal>
    </>
  )
}
