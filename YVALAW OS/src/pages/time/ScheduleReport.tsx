import { useEffect, useState } from 'react'
import type { Employee } from '../../data/types'
import { loadEmployees } from '../../services/storage'
import { loadHolidays, loadTimeOff } from '../../services/workspace'
import { LOCAL_TZ, loadTrackerBlocks, type TrackerBlock } from '../../services/trackerStorage'
import { scheduleWeek, type ScheduleDay } from '../../utils/schedule'
import { Chips, EmptyState, Pill, Segmented, Skel, Stepper, useIsMobile, type Tone } from '../../components/ui'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_MS = 86_400_000

function mondayOf(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime()
}
function addDays(ms: number, n: number): number {
  const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime()     // DST-safe
}
function mins(m: number): string { return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
function hm(seconds: number): string { return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m` }

type DayOff = ScheduleDay & { offLabel?: string }

/** Status pill per day (same statuses as before the redesign; time off / holidays added in Step 7) */
function chip(d: DayOff): { text: string; tone: Tone } | null {
  switch (d.status) {
    case 'on-time':         return { text: 'On time', tone: 'success' }
    case 'late':            return { text: `Late ${mins(d.lateMin)}`, tone: 'warning' }
    case 'left-early':      return { text: `Left ${mins(d.earlyMin)} early`, tone: 'partial' }
    case 'late-left-early': return { text: `Late ${mins(d.lateMin)} · left ${mins(d.earlyMin)} early`, tone: 'danger' }
    case 'absent':          return { text: 'No time', tone: 'danger' }
    case 'not-started':     return { text: 'Not started', tone: 'danger' }
    case 'in-progress':     return { text: 'On shift', tone: 'info' }
    case 'outside-shift':   return { text: 'Only outside shift hours', tone: 'warning' }
    case 'extra-day':       return { text: 'Extra day', tone: 'info' }
    case 'day-off':         return { text: d.offLabel ?? 'Time off', tone: 'sent' }
    default:                return null
  }
}
const shortClock = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', 'a').replace(' PM', 'p')

type Row = { employee: Employee; days: ScheduleDay[] }

/** Time Tracking → Schedule: shift vs. first/last tracked moment each day (late, left early, no time) */
export default function ScheduleReport() {
  const mobile = useIsMobile()
  const [week, setWeek] = useState(() => mondayOf(Date.now()))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [blocks, setBlocks] = useState<TrackerBlock[]>([])
  const [grace, setGrace] = useState(5)
  const [filter, setFilter] = useState<'all' | 'client' | 'yva'>('all')
  const [loading, setLoading] = useState(true)
  // Approved time off + company holidays (Step 7): those days are "Time off", never "No time"
  const [offDays, setOffDays] = useState<Map<string, string>>(new Map())

  useEffect(() => { void loadEmployees().then(setEmployees) }, [])
  useEffect(() => {
    let alive = true
    setLoading(true)
    // A day either side, so overnight shifts at the edges of the week are complete
    void loadTrackerBlocks(week - DAY_MS, addDays(week, 8)).then(b => { if (alive) { setBlocks(b); setLoading(false) } })
    const iso = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    const from = iso(week), to = iso(addDays(week, 6))
    void Promise.all([loadTimeOff({ status: 'approved', from, to }), loadHolidays(from)]).then(([t, h]) => {
      if (!alive) return
      const m = new Map<string, string>()
      for (const r of t.rows) for (let d = r.start_date; d <= r.end_date; d = iso(addDays(new Date(`${d}T12:00:00`).getTime(), 1))) m.set(`${r.employee_id}|${d}`, r.kind === 'sick' ? 'Sick day' : 'Time off')
      for (const x of h) if (x.day <= to) m.set(`*|${x.day}`, x.name)
      setOffDays(m)
    }).catch(() => {})
    return () => { alive = false }
  }, [week])

  const now = Date.now()
  const counted = blocks.filter(b => b.status !== 'removed' && b.status !== 'rejected')
  const rows: Row[] = employees
    .filter(e => (e.userId && !/^(inactive|terminated|former)/i.test(e.status ?? '')) || counted.some(b => b.employeeId === e.id))
    .filter(e => filter === 'all' || (filter === 'yva' ? e.worksFor === 'yva' : e.worksFor !== 'yva'))
    .map(employee => ({
      employee,
      days: scheduleWeek(counted.filter(b => b.employeeId === employee.id), employee.defaultShiftStart, employee.defaultShiftEnd, week, now, grace)
        .map(d => {
          const off = offDays.get(`${employee.id}|${d.day}`) ?? offDays.get(`*|${d.day}`)
          return off && !d.seconds && ['absent', 'not-started', 'upcoming', 'none'].includes(d.status) ? { ...d, status: 'day-off' as const, offLabel: off } : d
        }),
    }))
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name))

  // Saturday/Sunday only when someone worked them (keeps the table readable)
  const shownDays = [0, 1, 2, 3, 4, 5, 6].filter(i => i < 5 || rows.some(r => r.days[i].seconds > 0))
  const count = (r: Row, ...statuses: ScheduleDay['status'][]) => r.days.filter(d => statuses.includes(d.status)).length
  const lateTotal = (r: Row) => r.days.reduce((s, d) => s + (d.status === 'late' || d.status === 'late-left-early' ? d.lateMin : 0), 0)

  const md = (ms: number, year = false) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) })
  const shiftOf = (e: Employee) => (e.defaultShiftStart && e.defaultShiftEnd ? `${e.defaultShiftStart} – ${e.defaultShiftEnd}` : null)
  const dayCell = (d: DayOff) => {
    const c = chip(d)
    return (
      <div className={`ops-sday${d.status === 'day-off' ? ' ops-sday--off' : ''}`}>
        <span className="mono ops-sday__range">{d.firstAt !== null && d.lastAt !== null ? `${shortClock(d.firstAt)}–${shortClock(d.lastAt)}` : '—'}</span>
        {d.seconds > 0 && <span className="ops-sday__hours">{hm(d.seconds)}</span>}
        {c && <Pill tone={c.tone} className="ops-sday__pill">{c.text}</Pill>}
      </div>
    )
  }
  const summary = (r: Row) => {
    const late = count(r, 'late', 'late-left-early'), early = count(r, 'left-early', 'late-left-early'), absent = count(r, 'absent')
    const total = r.days.reduce((s, d) => s + d.seconds, 0)
    return (
      <div className="ops-ssum">
        <span className="ops-ssum__total">{hm(total)}</span>
        {late > 0 && <span className="t-warning">Late {late}× ({mins(lateTotal(r))})</span>}
        {early > 0 && <span className="t-warning">Left early {early}×</span>}
        {absent > 0 && <span className="t-danger">No time {absent} day{absent === 1 ? '' : 's'}</span>}
        {shiftOf(r.employee) && late + early + absent === 0 && total > 0 && <span className="t-success">All on time</span>}
      </div>
    )
  }

  return (
    <>
      <div className="ops-toolbar">
        <Stepper label={`${md(week)} – ${md(addDays(week, 6), true)}`} onPrev={() => setWeek(w => addDays(w, -7))} onNext={() => setWeek(w => addDays(w, 7))} nextDisabled={addDays(week, 7) > now} prevLabel="Previous week" nextLabel="Next week" />
        <div className="ops-grace">
          <span id="ops-grace-label">Grace period</span>
          <Segmented label="Grace period before counting late or early" value={String(grace)} onChange={v => setGrace(Number(v))} options={[0, 5, 10, 15].map(m => ({ value: String(m), label: `${m} min` }))} />
        </div>
        <span className="spacer" />
        <Chips small value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Everyone' }, { value: 'client', label: 'Client team' }, { value: 'yva', label: 'YVA team' }]} />
      </div>
      <p className="ops-help">Shifts from each employee profile, Mon–Fri · times in your time zone ({LOCAL_TZ}).</p>

      {loading ? (
        <div className="card card--pad stack">{[0, 1, 2].map(i => <Skel key={i} h={44} />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState>No one to show. Employees appear here once they have a YVA Time login (Employee profile → YVA Time Login).</EmptyState>
      ) : mobile ? (
        <div className="mcards">
          {rows.map(r => (
            <div key={r.employee.id} className="mcard">
              <div className="mcard__top">
                <div><div className="mcard__title">{r.employee.name}</div><div className={`mcard__meta${shiftOf(r.employee) ? '' : ' t-warning'}`}>{shiftOf(r.employee) ?? 'No shift on profile'}</div></div>
              </div>
              <div className="ops-sdays-m">
                {shownDays.map(i => (
                  <div key={i} className="ops-sdays-m__row"><span className="ops-sdays-m__d">{DAY_NAMES[i]} {new Date(addDays(week, i)).getDate()}</span>{dayCell(r.days[i] as DayOff)}</div>
                ))}
              </div>
              {summary(r)}
            </div>
          ))}
        </div>
      ) : (
        <div className="table-card">
          <table className="table ops-sched-table">
            <thead>
              <tr>
                <th>Person</th><th>Shift</th>
                {shownDays.map(i => <th key={i}>{DAY_NAMES[i]} {new Date(addDays(week, i)).getDate()}</th>)}
                <th className="t-right">Week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.employee.id}>
                  <td className="t-strong">{r.employee.name}</td>
                  <td className={shiftOf(r.employee) ? 'muted ops-nowrap' : 't-warning'}>{shiftOf(r.employee) ?? 'No shift on profile'}</td>
                  {shownDays.map(i => <td key={r.days[i].day} className="ops-top">{dayCell(r.days[i] as DayOff)}</td>)}
                  <td className="t-right ops-top">{summary(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ops-table-foot">
            First and last tracked moment each day from YVA Time (approved manual time included). Saturday and Sunday show when someone
            worked them. Approved time off and company holidays show as days off, not “No time”.
          </div>
        </div>
      )}
    </>
  )
}
