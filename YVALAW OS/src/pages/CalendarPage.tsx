import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Employee, Estimate, Invoice, Project, Task } from '../data/types'
import { loadSnapshot, loadTasks, loadEstimates } from '../services/storage'
import { loadHolidays, loadTimeOff, type Holiday, type TimeOffRequest } from '../services/workspace'
import { Drawer, EmptyState, PageHeader, Pill, Skel, Stepper, useIsMobile } from '../components/ui'
import { Ic, P } from '../components/Icon'

// ─── Types ────────────────────────────────────────────────────────────────────

type Kind = 'money' | 'off' | 'holiday' | 'due' | 'contract' | 'project' | 'task' | 'estimate'

interface CalendarEvent {
  id: string
  kind: Kind
  date: string        // YYYY-MM-DD
  title: string
  subtitle: string
  to: string          // where "Open" goes
  meta?: string       // e.g. invoice status
}

/** Legend chips (toggleable). Money cycle = Mon weekly close · Wed payroll reminder · Fri payday */
const KINDS: { key: Kind; label: string; open: string }[] = [
  { key: 'money', label: 'Money cycle', open: 'Open' },
  { key: 'off', label: 'Time off', open: 'Open person' },
  { key: 'holiday', label: 'Holidays', open: 'Announcements' },
  { key: 'due', label: 'Invoice due', open: 'Open invoice' },
  { key: 'contract', label: 'Contracts', open: 'Open client' },
  { key: 'project', label: 'Project ends', open: 'Open project' },
  { key: 'task', label: 'Tasks', open: 'Open project' },
  { key: 'estimate', label: 'Estimates', open: 'Open estimates' },
]
const ORDER: Kind[] = KINDS.map(k => k.key)
const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HIDE_KEY = 'yva_calendar_hidden'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const shortName = (n: string) => { const [a, b] = n.split(/\s+/); return b ? `${a} ${b[0]}.` : a }

// Build the month grid (Mon-first), padded to whole weeks.
function buildGridDays(year: number, month: number): { date: Date; isCurrentMonth: boolean }[] {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const firstDow = (first.getDay() + 6) % 7
  const days: { date: Date; isCurrentMonth: boolean }[] = []
  for (let i = firstDow - 1; i >= 0; i--) days.push({ date: new Date(year, month, -i), isCurrentMonth: false })
  for (let d = 1; d <= last.getDate(); d++) days.push({ date: new Date(year, month, d), isCurrentMonth: true })
  let n = 1
  while (days.length % 7 !== 0) days.push({ date: new Date(year, month + 1, n++), isCurrentMonth: false })
  return days
}

function readHidden(): Set<Kind> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]') as Kind[]) } catch { return new Set() }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const now = new Date()

  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-based

  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [clients,   setClients]   = useState<Client[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [tasks,     setTasks]     = useState<Task[]>([])
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [timeOff,   setTimeOff]   = useState<TimeOffRequest[]>([])
  const [holidays,  setHolidays]  = useState<Holiday[]>([])
  const [loading,   setLoading]   = useState(true)

  const [hidden, setHidden] = useState<Set<Kind>>(readHidden)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  // ─── Load data (each source may fail on its own: RLS hides what a role can't see) ─────

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [snap, taskList, estimateList] = await Promise.all([
          loadSnapshot(),
          loadTasks().catch(() => [] as Task[]),
          loadEstimates().catch(() => [] as Estimate[]),
        ])
        if (cancelled) return
        setInvoices(snap.invoices); setProjects(snap.projects); setClients(snap.clients); setEmployees(snap.employees)
        setTasks(taskList); setEstimates(estimateList)
      } catch (err) {
        console.error('CalendarPage load error', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Approved time off + holidays for the visible month
  useEffect(() => {
    let alive = true
    const from = toDateKey(new Date(year, month, 1)), to = toDateKey(new Date(year, month + 1, 0))
    void loadTimeOff({ status: 'approved', from, to }).then(r => { if (alive) setTimeOff(r.rows) }).catch(() => {})
    void loadHolidays(from).then(h => { if (alive) setHolidays(h.filter(x => x.day <= to)) }).catch(() => {})
    return () => { alive = false }
  }, [year, month])

  function toggle(k: Kind) {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      try { localStorage.setItem(HIDE_KEY, JSON.stringify([...next])) } catch { /* per-device convenience only */ }
      return next
    })
  }

  // ─── Build events ──────────────────────────────────────────────────────────

  const gridDays = useMemo(() => buildGridDays(year, month), [year, month])

  const allEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = []
    const gridKeys = gridDays.map(g => toDateKey(g.date))

    // Money cycle on every visible Mon / Wed / Fri (weekly close prepares Monday 12:05 am; payroll reminder Wednesday; payday Friday)
    for (const g of gridDays) {
      const key = toDateKey(g.date), dow = g.date.getDay()
      if (dow === 1) events.push({ id: `wc-${key}`, kind: 'money', date: key, title: 'Weekly close', subtitle: 'Last week’s hours become draft invoices (12:05 am)', to: '/weekly-close' })
      if (dow === 3) events.push({ id: `pr-${key}`, kind: 'money', date: key, title: 'Payroll reminder', subtitle: 'Friday’s payroll is prepared for review', to: '/payroll' })
      if (dow === 5) events.push({ id: `pd-${key}`, kind: 'money', date: key, title: 'Payday', subtitle: 'Pay in DOP, payslips sent', to: '/payroll' })
    }

    // Approved time off, one chip per day
    for (const r of timeOff) {
      const emp = employees.find(e => e.id === r.employee_id)
      const name = emp ? shortName(emp.name) : 'Someone'
      for (const key of gridKeys) {
        if (key < r.start_date || key > r.end_date) continue
        events.push({ id: `off-${r.id}-${key}`, kind: 'off', date: key, title: `${name} off`, subtitle: `${r.kind === 'sick' ? 'Sick day' : r.kind.replace(/^./, c => c.toUpperCase())}${r.half_day ? ' · half day' : ''}${r.note ? ` · ${r.note}` : ''}`, to: emp ? `/employees/${emp.id}` : '/approvals' })
      }
    }

    for (const h of holidays) events.push({ id: `hol-${h.id}`, kind: 'holiday', date: h.day, title: h.name, subtitle: h.paid ? 'Paid holiday' : 'Holiday', to: '/announcements' })

    // Invoices — only actionable statuses
    const invoiceStatuses = new Set(['sent', 'viewed', 'partial', 'overdue'])
    for (const inv of invoices) {
      if (!inv.dueDate || !invoiceStatuses.has(inv.status ?? '')) continue
      events.push({ id: `inv-${inv.id}`, kind: 'due', date: inv.dueDate, title: inv.number, subtitle: inv.clientName ?? inv.projectName ?? '', to: `/invoice?open=${inv.id}`, meta: inv.status })
    }

    for (const c of clients) {
      if (!c.contractEnd) continue
      events.push({ id: `con-${c.id}`, kind: 'contract', date: c.contractEnd, title: `${c.name} contract ends`, subtitle: c.company ?? '', to: `/clients/${c.id}` })
    }

    for (const proj of projects) {
      if (!proj.endDate) continue
      events.push({ id: `proj-${proj.id}`, kind: 'project', date: proj.endDate, title: `${proj.name} ends`, subtitle: proj.status ?? '', to: `/projects/${proj.id}` })
    }

    // Tasks — due dates, exclude done
    for (const task of tasks) {
      if (!task.dueDate || task.status === 'done') continue
      const proj = projects.find(p => p.id === task.projectId)
      events.push({ id: `task-${task.id}`, kind: 'task', date: task.dueDate, title: task.title, subtitle: [proj?.name, task.assigneeName].filter(Boolean).join(' · '), to: `/projects/${task.projectId}?tab=tasks`, meta: task.status })
    }

    // Estimates — expiry dates, exclude accepted/declined
    for (const est of estimates) {
      if (!est.expiryDate || est.status === 'accepted' || est.status === 'declined') continue
      events.push({ id: `est-${est.id}`, kind: 'estimate', date: est.expiryDate, title: `${est.number} expires`, subtitle: est.clientName ?? est.projectName ?? '', to: '/estimates', meta: est.status })
    }

    return events.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  }, [gridDays, invoices, projects, clients, employees, tasks, estimates, timeOff, holidays])

  const eventsByDate = useMemo<Map<string, CalendarEvent[]>>(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of allEvents) {
      if (hidden.has(ev.kind)) continue
      const list = map.get(ev.date) ?? []
      list.push(ev)
      map.set(ev.date, list)
    }
    return map
  }, [allEvents, hidden])

  function prevMonth() { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1); setSelectedDay(null) }
  function nextMonth() { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1); setSelectedDay(null) }
  function goToday() { setYear(now.getFullYear()); setMonth(now.getMonth()); setSelectedDay(null) }

  const today = toDateKey(now)
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthTitle = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const monthCount = [...eventsByDate.entries()].filter(([d]) => d.startsWith(monthKey)).reduce((s, [, l]) => s + l.length, 0)
  const selectedEvents = selectedDay ? (eventsByDate.get(selectedDay) ?? []) : []
  const fullDay = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }

  const legend = (
    <div className="ops-legend" role="group" aria-label="Show on the calendar">
      {KINDS.map(k => (
        <button key={k.key} type="button" className={`ops-legend__chip${hidden.has(k.key) ? ' ops-legend__chip--off' : ''}`} aria-pressed={!hidden.has(k.key)} onClick={() => toggle(k.key)}>
          <span className={`ops-legend__dot ops-k-${k.key}`} aria-hidden />{k.label}
        </button>
      ))}
    </div>
  )

  const agendaDays = [...eventsByDate.entries()].filter(([d]) => d.startsWith(monthKey)).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="page">
      <PageHeader keepTitleOnPhone title={monthTitle} sub="Money cycle, time off, holidays, due dates and contract ends" actions={<>
        <Stepper label={<span className="ops-cal-count">{loading ? 'Loading…' : `${monthCount} event${monthCount === 1 ? '' : 's'}`}</span>} onPrev={prevMonth} onNext={nextMonth} prevLabel="Previous month" nextLabel="Next month" />
        <button type="button" className="btn btn--sm" onClick={goToday}>Today</button>
      </>} />
      {legend}

      {loading ? (
        <Skel h={mobile ? 320 : 560} r={14} />
      ) : mobile ? (
        agendaDays.length === 0 ? <EmptyState>Nothing on the calendar this month.</EmptyState> : (
          <div className="ops-agenda">
            {agendaDays.map(([key, evs]) => {
              const d = new Date(`${key}T12:00:00`)
              return (
                <div key={key} className={`ops-agenda__day${key === today ? ' ops-agenda__day--today' : ''}`}>
                  <div className="ops-agenda__date"><span>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span><b>{d.getDate()}</b></div>
                  <div className="ops-agenda__events">
                    {evs.map(ev => (
                      <button key={ev.id} type="button" className={`ops-ev ops-ev--lg ops-k-${ev.kind}`} onClick={() => navigate(ev.to)}>
                        <span className="ops-ev__t">{ev.title}</span>
                        {ev.subtitle && <span className="ops-ev__s">{ev.subtitle}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="card ops-cal">
          <div className="ops-cal__dows">{DAY_HEADERS.map(d => <span key={d}>{d}</span>)}</div>
          <div className="ops-cal__grid">
            {gridDays.map(({ date, isCurrentMonth }) => {
              const key = toDateKey(date)
              const evs = eventsByDate.get(key) ?? []
              const shown = evs.slice(0, 3)
              return (
                <button key={key} type="button" className={`ops-cal__cell${isCurrentMonth ? '' : ' ops-cal__cell--out'}${key === selectedDay ? ' ops-cal__cell--sel' : ''}`}
                  onClick={() => setSelectedDay(key)} aria-label={`${fullDay(key)}: ${evs.length} event${evs.length === 1 ? '' : 's'}`}>
                  <span className={`ops-cal__n${key === today ? ' ops-cal__n--today' : ''}`}>{date.getDate()}</span>
                  {shown.map(ev => <span key={ev.id} className={`ops-ev ops-k-${ev.kind}`} title={`${ev.title}${ev.subtitle ? ` — ${ev.subtitle}` : ''}`}>{ev.title}</span>)}
                  {evs.length > 3 && <span className="ops-cal__more">+{evs.length - 3} more</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <Drawer open={!!selectedDay} onClose={() => setSelectedDay(null)} size="narrow" title={selectedDay ? fullDay(selectedDay) : ''}
        sub={selectedEvents.length === 0 ? 'No events on this day' : `${selectedEvents.length} event${selectedEvents.length === 1 ? '' : 's'}`}>
        {selectedEvents.length === 0 ? <div className="card card-empty">Nothing on this day{hidden.size ? ' (some types are hidden in the legend)' : ''}.</div> : (
          KINDS.filter(k => selectedEvents.some(e => e.kind === k.key)).map(k => (
            <div key={k.key} className="stack ops-dayk">
              <div className="section-label ops-dayk__label"><span className={`ops-legend__dot ops-k-${k.key}`} aria-hidden />{k.label}</div>
              {selectedEvents.filter(e => e.kind === k.key).map(ev => (
                <button key={ev.id} type="button" className="ops-dayev" onClick={() => navigate(ev.to)}>
                  <span className="ops-dayev__main"><span className="ops-dayev__t">{ev.title}</span>{ev.subtitle && <span className="ops-dayev__s">{ev.subtitle}</span>}</span>
                  {ev.meta && <Pill status={ev.meta} />}
                  <span className="link ops-dayev__go">{k.open}<Ic d={P.chevR} size={13} /></span>
                </button>
              ))}
            </div>
          ))
        )}
      </Drawer>
    </div>
  )
}
