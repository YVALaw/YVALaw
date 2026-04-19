import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Invoice, Project, Task, Estimate } from '../data/types'
import { loadSnapshot, loadTasks, loadEstimates } from '../services/storage'

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = 'invoice' | 'project' | 'task' | 'estimate'

type FilterType = 'all' | EventType

interface CalendarEvent {
  id: string
  type: EventType
  date: string        // YYYY-MM-DD
  title: string
  subtitle: string
  entityId: string
  meta?: string       // e.g. invoice status
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<EventType, string> = {
  invoice:  '#ef4444',
  project:  '#8b5cf6',
  estimate: '#f59e0b',
  task:     '#3b82f6',
}

const TYPE_LABELS: Record<EventType, string> = {
  invoice:  'Invoice Due',
  project:  'Project End',
  estimate: 'Estimate Expiry',
  task:     'Task Due',
}

const TYPE_ICONS: Record<EventType, string> = {
  invoice:  '💳',
  project:  '📁',
  estimate: '📋',
  task:     '✅',
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayKey(): string {
  return toDateKey(new Date())
}

// Build a 6-week grid (42 cells) for the given year+month, Mon-first.
function buildGridDays(year: number, month: number): { date: Date; isCurrentMonth: boolean }[] {
  // month is 0-based
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth  = new Date(year, month + 1, 0)

  // Day of week (0=Sun..6=Sat) → convert to Mon-first (0=Mon..6=Sun)
  const firstDow = (firstOfMonth.getDay() + 6) % 7
  const lastDow  = (lastOfMonth.getDay() + 6) % 7

  const days: { date: Date; isCurrentMonth: boolean }[] = []

  // Pad from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i)
    days.push({ date: d, isCurrentMonth: false })
  }

  // Current month days
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    days.push({ date: new Date(year, month, d), isCurrentMonth: true })
  }

  // Pad to end (fill remaining cells up to 42)
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    days.push({ date: new Date(year, month + 1, d), isCurrentMonth: false })
  }

  return days
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const navigate = useNavigate()
  const now = new Date()

  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-based

  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [tasks,     setTasks]     = useState<Task[]>([])
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loading,   setLoading]   = useState(true)

  const [filter,      setFilter]      = useState<FilterType>('all')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  // ─── Load data ─────────────────────────────────────────────────────────────

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
        setInvoices(snap.invoices)
        setProjects(snap.projects)
        setTasks(taskList)
        setEstimates(estimateList)
      } catch (err) {
        console.error('CalendarPage load error', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ─── Build events ──────────────────────────────────────────────────────────

  const allEvents = useMemo<CalendarEvent[]>(() => {
    const events: CalendarEvent[] = []

    // Invoices — only actionable statuses
    const invoiceStatuses = new Set(['sent', 'viewed', 'partial', 'overdue'])
    for (const inv of invoices) {
      if (!inv.dueDate) continue
      if (!invoiceStatuses.has(inv.status ?? '')) continue
      events.push({
        id:       `inv-${inv.id}`,
        type:     'invoice',
        date:     inv.dueDate,
        title:    inv.number,
        subtitle: inv.clientName ?? inv.projectName ?? '',
        entityId: inv.id,
        meta:     inv.status,
      })
    }

    // Projects — end dates
    for (const proj of projects) {
      if (!proj.endDate) continue
      events.push({
        id:       `proj-${proj.id}`,
        type:     'project',
        date:     proj.endDate,
        title:    proj.name,
        subtitle: proj.status ?? '',
        entityId: proj.id,
      })
    }

    // Tasks — due dates, exclude done
    for (const task of tasks) {
      if (!task.dueDate) continue
      if (task.status === 'done') continue
      events.push({
        id:       `task-${task.id}`,
        type:     'task',
        date:     task.dueDate,
        title:    task.title,
        subtitle: task.assigneeName ?? '',
        entityId: task.projectId,
        meta:     task.status,
      })
    }

    // Estimates — expiry dates, exclude accepted/declined
    for (const est of estimates) {
      if (!est.expiryDate) continue
      if (est.status === 'accepted' || est.status === 'declined') continue
      events.push({
        id:       `est-${est.id}`,
        type:     'estimate',
        date:     est.expiryDate,
        title:    est.number,
        subtitle: est.clientName ?? est.projectName ?? '',
        entityId: est.id,
        meta:     est.status,
      })
    }

    return events
  }, [invoices, projects, tasks, estimates])

  // ─── Filter events ─────────────────────────────────────────────────────────

  const visibleEvents = useMemo<CalendarEvent[]>(() => {
    if (filter === 'all') return allEvents
    return allEvents.filter(e => e.type === filter)
  }, [allEvents, filter])

  // ─── Index events by date ──────────────────────────────────────────────────

  const eventsByDate = useMemo<Map<string, CalendarEvent[]>>(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const ev of visibleEvents) {
      if (!ev.date) continue
      const list = map.get(ev.date) ?? []
      list.push(ev)
      map.set(ev.date, list)
    }
    return map
  }, [visibleEvents])

  // ─── Grid ──────────────────────────────────────────────────────────────────

  const gridDays = useMemo(() => buildGridDays(year, month), [year, month])

  // ─── Navigation ────────────────────────────────────────────────────────────

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else              setMonth(m => m - 1)
    setSelectedDay(null)
  }

  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else               setMonth(m => m + 1)
    setSelectedDay(null)
  }

  // ─── Selected day events ───────────────────────────────────────────────────

  const selectedEvents = selectedDay ? (eventsByDate.get(selectedDay) ?? []) : []

  // Group selected day events by type
  const selectedByType = useMemo<Partial<Record<EventType, CalendarEvent[]>>>(() => {
    const grouped: Partial<Record<EventType, CalendarEvent[]>> = {}
    for (const ev of selectedEvents) {
      if (!grouped[ev.type]) grouped[ev.type] = []
      grouped[ev.type]!.push(ev)
    }
    return grouped
  }, [selectedEvents])

  const today = todayKey()

  // ─── Navigation to entities ────────────────────────────────────────────────

  function navigateToEvent(ev: CalendarEvent) {
    switch (ev.type) {
      case 'invoice':  navigate('/invoice'); break
      case 'project':  navigate(`/projects/${ev.entityId}`); break
      case 'task':     navigate(`/projects/${ev.entityId}`); break
      case 'estimate': navigate('/estimates'); break
    }
  }

  // ─── Format selected day label ─────────────────────────────────────────────

  function formatSelectedDay(key: string): string {
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="calendar-page">

      {/* Page header */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div className="page-header-left">
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">Invoice dues, project deadlines, tasks, and estimate expirations</p>
        </div>
        {/* Month navigation */}
        <div className="page-header-actions">
          <button
            onClick={prevMonth}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
              fontSize: 14, color: 'var(--text)', fontWeight: 600,
            }}
          >
            ← Prev
          </button>
          <span style={{
            fontSize: 16, fontWeight: 800, color: 'var(--text)',
            minWidth: 160, textAlign: 'center', letterSpacing: '-0.01em',
          }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
              fontSize: 14, color: 'var(--text)', fontWeight: 600,
            }}
          >
            Next →
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {(['all', 'invoice', 'project', 'task', 'estimate'] as FilterType[]).map(f => {
          const active = filter === f
          const color  = f === 'all' ? '#64748b' : TYPE_COLORS[f as EventType]
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 14px',
                borderRadius: 20,
                border: active ? `2px solid ${color}` : '1.5px solid var(--border)',
                background: active ? `${color}18` : 'var(--surface)',
                color: active ? color : 'var(--muted)',
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              {f === 'all' ? 'All' : TYPE_LABELS[f as EventType]}
            </button>
          )
        })}

        {/* Event count summary */}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
          {loading ? 'Loading...' : `${visibleEvents.length} event${visibleEvents.length !== 1 ? 's' : ''} this calendar`}
        </span>
      </div>

      {/* Main layout: calendar + detail panel */}
      <div className="calendar-layout">

        {/* Calendar grid */}
        <div className="calendar-panel" style={{
          flex: 1,
          minWidth: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 1px 4px rgba(0,0,0,.06)',
        }}>
          {/* Day-of-week headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            borderBottom: '1px solid var(--border)',
          }}>
            {DAY_HEADERS.map(d => (
              <div key={d} style={{
                padding: '10px 0',
                textAlign: 'center',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.07em',
                color: 'var(--muted)',
              }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
          }}>
            {gridDays.map(({ date, isCurrentMonth }, idx) => {
              const key      = toDateKey(date)
              const dayEvs   = eventsByDate.get(key) ?? []
              const isToday  = key === today
              const isSel    = key === selectedDay
              const showDots = dayEvs.slice(0, 3)
              const overflow = dayEvs.length - 3

              // Border logic: right border except last column, bottom border except last row
              const col = idx % 7
              const row = Math.floor(idx / 7)
              const totalRows = Math.ceil(gridDays.length / 7)
              const borderRight  = col < 6 ? '1px solid var(--border)' : 'none'
              const borderBottom = row < totalRows - 1 ? '1px solid var(--border)' : 'none'

              return (
                <div
                  key={key}
                  onClick={() => setSelectedDay(isSel ? null : key)}
                  style={{
                    minHeight: 90,
                    padding: '6px 8px',
                    cursor: 'pointer',
                    borderRight,
                    borderBottom,
                    background: isToday
                      ? '#fef9c3'
                      : isSel
                      ? 'rgba(59,130,246,.06)'
                      : 'transparent',
                    outline: isSel ? '2px solid #3b82f6' : 'none',
                    outlineOffset: -2,
                    transition: 'background .1s',
                    position: 'relative',
                  }}
                >
                  {/* Day number */}
                  <div style={{
                    fontSize: 13,
                    fontWeight: isToday ? 800 : 500,
                    color: isToday
                      ? '#854d0e'
                      : isCurrentMonth
                      ? 'var(--text)'
                      : 'var(--muted)',
                    marginBottom: 4,
                    lineHeight: 1,
                  }}>
                    {isToday ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: '#facc15',
                        color: '#1b1e2b',
                        fontWeight: 900,
                        fontSize: 12,
                      }}>
                        {date.getDate()}
                      </span>
                    ) : (
                      date.getDate()
                    )}
                  </div>

                  {/* Event pills */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {showDots.map(ev => (
                      <div
                        key={ev.id}
                        title={`${TYPE_LABELS[ev.type]}: ${ev.title}${ev.subtitle ? ` — ${ev.subtitle}` : ''}`}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: '#fff',
                          background: TYPE_COLORS[ev.type],
                          borderRadius: 4,
                          padding: '1px 5px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '100%',
                        }}
                      >
                        {ev.title}
                      </div>
                    ))}
                    {overflow > 0 && (
                      <div style={{
                        fontSize: 10,
                        color: 'var(--muted)',
                        fontWeight: 600,
                        paddingLeft: 2,
                      }}>
                        +{overflow} more
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Detail panel */}
        <div className="calendar-detail" style={{
          width: 380,
          flexShrink: 0,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,.06)',
          overflow: 'hidden',
          // Keep a fixed height and scroll inside
          maxHeight: 'calc(100vh - 180px)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Panel header */}
          <div style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}>
            {selectedDay ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
                  {formatSelectedDay(selectedDay)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {selectedEvents.length === 0
                    ? 'No events on this day'
                    : `${selectedEvents.length} event${selectedEvents.length !== 1 ? 's' : ''}`}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
                  Event Details
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Click a day to see its events
                </div>
              </>
            )}
          </div>

          {/* Panel body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
            {!selectedDay ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
                Select a day on the calendar to view events
              </div>
            ) : selectedEvents.length === 0 ? (
              <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>✨</div>
                No events on this day
              </div>
            ) : (
              // Group by type
              (['invoice', 'project', 'task', 'estimate'] as EventType[])
                .filter(t => selectedByType[t] && selectedByType[t]!.length > 0)
                .map(t => (
                  <div key={t} style={{ marginBottom: 16 }}>
                    {/* Type section header */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 18px 8px',
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: TYPE_COLORS[t],
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '.07em',
                        color: TYPE_COLORS[t],
                      }}>
                        {TYPE_LABELS[t]}
                      </span>
                    </div>

                    {/* Events for this type */}
                    {selectedByType[t]!.map(ev => (
                      <div
                        key={ev.id}
                        style={{
                          margin: '0 12px 6px',
                          padding: '10px 12px',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          background: '#fafbfd',
                          cursor: 'pointer',
                          transition: 'border-color .15s, box-shadow .15s',
                        }}
                        onMouseEnter={e => {
                          const el = e.currentTarget as HTMLDivElement
                          el.style.borderColor = TYPE_COLORS[t]
                          el.style.boxShadow = `0 0 0 3px ${TYPE_COLORS[t]}18`
                        }}
                        onMouseLeave={e => {
                          const el = e.currentTarget as HTMLDivElement
                          el.style.borderColor = 'var(--border)'
                          el.style.boxShadow = 'none'
                        }}
                        onClick={() => navigateToEvent(ev)}
                      >
                        {/* Icon + title row */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>
                            {TYPE_ICONS[t]}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{
                              fontSize: 13,
                              fontWeight: 700,
                              color: 'var(--text)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {ev.title}
                            </div>
                            {ev.subtitle && (
                              <div style={{
                                fontSize: 11,
                                color: 'var(--muted)',
                                marginTop: 2,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}>
                                {ev.subtitle}
                              </div>
                            )}
                          </div>
                          {/* Status badge */}
                          {ev.meta && (
                            <span style={{
                              flexShrink: 0,
                              fontSize: 10,
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: `${TYPE_COLORS[t]}18`,
                              color: TYPE_COLORS[t],
                              border: `1px solid ${TYPE_COLORS[t]}30`,
                              textTransform: 'capitalize',
                            }}>
                              {ev.meta}
                            </span>
                          )}
                        </div>

                        {/* Go-to link */}
                        <div style={{
                          marginTop: 8,
                          paddingTop: 7,
                          borderTop: '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'flex-end',
                        }}>
                          <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: TYPE_COLORS[t],
                            display: 'flex',
                            alignItems: 'center',
                            gap: 3,
                          }}>
                            View {t === 'task' ? 'project' : t} →
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Color legend */}
      <div style={{
        marginTop: 16,
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Legend:
        </span>
        {(['invoice', 'project', 'estimate', 'task'] as EventType[]).map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: TYPE_COLORS[t],
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{TYPE_LABELS[t]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
