import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import {
  loadPortalClient,
  loadPortalProjects,
  loadPortalEmployees,
  loadPortalTimeEntries,
  submitStaffRequest,
  fmtUSD,
} from '../../services/portalStorage'
import type { Client, Employee, Project, TimeEntry } from '../../data/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? '').toLowerCase()
  const active = s === 'active'
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: active ? 'rgba(34,197,94,.1)' : 'var(--surf2)',
      color: active ? '#15803d' : 'var(--muted)',
    }}>
      {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Active'}
    </span>
  )
}

// ── Employee modal (same as Dashboard) ───────────────────────────────────────

function EmpModal({
  emp,
  timeEntries,
  onClose,
}: {
  emp: Employee
  timeEntries: TimeEntry[]
  onClose: () => void
}) {
  const now    = new Date()
  const ym     = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  const entries = timeEntries.filter(e =>
    e.employeeId === emp.id || e.employeeName?.toLowerCase() === emp.name.toLowerCase()
  )
  const hrsMonth = entries.filter(e => e.date.startsWith(ym)).reduce((s, e) => s + e.hours, 0)
  const hrsTotal = entries.reduce((s, e) => s + e.hours, 0)

  const hasSchedule = emp.defaultShiftStart || emp.defaultShiftEnd
  const scheduleStr = hasSchedule
    ? [emp.defaultShiftStart, emp.defaultShiftEnd].filter(Boolean).join(' – ')
    : null

  function Row({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{value}</span>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: '100%' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {emp.photoUrl ? (
              <img src={emp.photoUrl} alt={emp.name}
                style={{ width: 52, height: 52, borderRadius: 14, objectFit: 'cover', objectPosition: 'center top', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                background: avatarColor(emp.name), display: 'grid', placeItems: 'center',
                fontSize: 18, fontWeight: 900, color: '#1b1e2b',
              }}>
                {initials(emp.name)}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>{emp.name}</div>
              {emp.role && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{emp.role}</div>}
              {emp.status && <div style={{ marginTop: 6 }}><StatusBadge status={emp.status} /></div>}
            </div>
          </div>
          <button className="modal-close btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '8px 24px 24px' }}>
          {/* Hours KPIs */}
          <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
            <div style={{ flex: 1, background: 'var(--surf2)', borderRadius: 12, padding: '12px 16px', border: '1px solid var(--border)', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--gold)' }}>
                {hrsMonth > 0 ? `${hrsMonth.toFixed(1)}h` : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{monthName}</div>
            </div>
            <div style={{ flex: 1, background: 'var(--surf2)', borderRadius: 12, padding: '12px 16px', border: '1px solid var(--border)', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>
                {hrsTotal > 0 ? `${hrsTotal.toFixed(1)}h` : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>All time</div>
            </div>
          </div>

          {/* Detail rows */}
          <Row label="Employment type" value={emp.employmentType} />
          <Row label="Timezone"        value={emp.timezone} />
          <Row label="Schedule"        value={scheduleStr} />
          <Row label="Location"        value={emp.location} />

          {!hasSchedule && (
            <div style={{
              marginTop: 16, padding: '12px 16px',
              background: 'rgba(245,181,51,.07)', border: '1px solid rgba(245,181,51,.2)',
              borderRadius: 10, fontSize: 12, color: 'rgba(245,181,51,.9)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              Schedule details will appear here once configured.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Staff request modal ───────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  'Legal Intake Specialist',
  'Legal Assistant',
  'Demand Writer',
  'Case Manager',
  'Admin / Virtual Assistant',
  'Other',
]

function StaffRequestModal({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  const [role,      setRole]      = useState('')
  const [hours,     setHours]     = useState('')
  const [startDate, setStartDate] = useState('')
  const [notes,     setNotes]     = useState('')
  const [sent,      setSent]      = useState(false)
  const [sending,   setSending]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!role) return
    setSending(true)
    setError(null)
    try {
      await submitStaffRequest({
        clientId,
        clientName,
        role,
        hoursPerWeek: hours ? Number(hours) : undefined,
        startDate:    startDate || undefined,
        notes:        notes || undefined,
      })
      setSent(true)
    } catch (err) {
      console.error('Staff request failed:', err)
      setError('Something went wrong. Please try again or contact your account manager.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, width: '100%' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Request Additional Staff</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>We'll follow up within 1 business day</div>
          </div>
          <button className="modal-close btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '24px' }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'rgba(34,197,94,.12)', display: 'grid', placeItems: 'center',
                margin: '0 auto 16px', color: '#22c55e',
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>Request sent!</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                Your account manager will reach out within 1 business day to discuss your needs.
              </div>
              <button className="btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 13 }}>Close</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Role needed *</label>
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    required
                    style={{
                      background: 'var(--surf2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)',
                    }}
                  >
                    <option value="">Select a role…</option>
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Hours per week</label>
                  <input
                    type="number" placeholder="e.g. 40" min={1} max={60}
                    value={hours} onChange={e => setHours(e.target.value)}
                    style={{
                      background: 'var(--surf2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Ideal start date</label>
                  <input
                    type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    style={{
                      background: 'var(--surf2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Notes</label>
                <textarea
                  placeholder="Tasks, tools, or experience needed…"
                  rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  style={{
                    background: 'var(--surf2)', border: '1px solid var(--border)',
                    borderRadius: 8, padding: '10px 12px', fontSize: 13, color: 'var(--text)',
                    resize: 'vertical', fontFamily: 'inherit',
                  }}
                />
              </div>
              {error && (
                <div style={{
                  padding: '10px 14px', borderRadius: 8, fontSize: 13,
                  background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
                  color: '#ef4444',
                }}>
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
                <button type="button" className="btn-ghost" onClick={onClose} style={{ fontSize: 13 }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={sending || !role} style={{ fontSize: 13, flex: 1 }}>
                  {sending ? 'Sending…' : 'Submit Request'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ProjectFilter = 'all' | string

export default function PortalTeam() {
  const { clientId: roleClientId } = useRole()
  const [searchParams] = useSearchParams()
  const previewId = searchParams.get('preview')
  const clientId  = roleClientId ?? previewId
  const navigate  = useNavigate()

  function portalNav(path: string) {
    return previewId ? `${path}?preview=${previewId}` : path
  }

  const [client,      setClient]      = useState<Client | null>(null)
  const [projects,    setProjects]    = useState<Project[]>([])
  const [employees,   setEmployees]   = useState<Employee[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [selected,      setSelected]      = useState<Employee | null>(null)
  const [projFilter,    setProjFilter]    = useState<ProjectFilter>('all')
  const [showRequest,   setShowRequest]   = useState(false)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const c = await loadPortalClient(clientId)
      setClient(c)
      if (!c) { setLoading(false); return }
      const projs = await loadPortalProjects(clientId)
      setProjects(projs)
      const [emps, entries] = await Promise.all([
        loadPortalEmployees(projs),
        loadPortalTimeEntries(projs.map(p => p.id)),
      ])
      setEmployees(emps)
      setTimeEntries(entries)
      setLoading(false)
    })()
  }, [clientId])

  const now      = new Date()
  const ym       = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  function empHrsMonth(emp: Employee) {
    return timeEntries
      .filter(e => (e.employeeId === emp.id || e.employeeName?.toLowerCase() === emp.name.toLowerCase()) && e.date.startsWith(ym))
      .reduce((s, e) => s + e.hours, 0)
  }
  function empProjects(emp: Employee): Project[] {
    return projects.filter(p => (p.employeeIds ?? []).includes(emp.id))
  }

  const filtered = projFilter === 'all'
    ? employees
    : employees.filter(emp => empProjects(emp).some(p => p.id === projFilter))

  const totalHrsMonth = employees.reduce((s, emp) => s + empHrsMonth(emp), 0)
  const activeCount   = employees.filter(e => (e.status ?? '').toLowerCase() === 'active').length

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading team…</div>
      </div>
    )
  }

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title">My Team</div>
          <div className="page-sub">
            {client?.company ? client.company + ' · ' : ''}
            {employees.length} team member{employees.length !== 1 ? 's' : ''}
            {activeCount > 0 && activeCount < employees.length ? ` · ${activeCount} active` : ''}
          </div>
        </div>
        <button
          className="btn-ghost btn-sm"
          onClick={() => navigate(portalNav('/portal/dashboard'))}
          style={{ fontSize: 12 }}
        >
          ← Dashboard
        </button>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card" style={{ borderTop: '3px solid var(--gold)' }}>
          <div className="kpi-label">Total Team</div>
          <div className="kpi-value">{employees.length}</div>
          <div className="kpi-sub">Assigned to your account</div>
        </div>
        <div className="kpi-card" style={{ borderTop: '3px solid #22c55e' }}>
          <div className="kpi-label">Active</div>
          <div className="kpi-value">{activeCount}</div>
          <div className="kpi-sub">Currently on your account</div>
        </div>
        <div className="kpi-card" style={{ borderTop: '3px solid #3b82f6' }}>
          <div className="kpi-label">Hours — {monthName}</div>
          <div className="kpi-value">{totalHrsMonth > 0 ? `${totalHrsMonth.toFixed(1)}h` : '—'}</div>
          <div className="kpi-sub">Team total this month</div>
        </div>
        <div className="kpi-card" style={{ borderTop: '3px solid #a855f7' }}>
          <div className="kpi-label">Projects</div>
          <div className="kpi-value">{projects.length}</div>
          <div className="kpi-sub">{projects.filter(p => p.status?.toLowerCase() === 'active').length} active</div>
        </div>
      </div>

      {/* Project filter tabs */}
      {projects.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setProjFilter('all')}
            style={{
              padding: '6px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              border: '1px solid',
              borderColor: projFilter === 'all' ? 'var(--gold)' : 'var(--border)',
              background:  projFilter === 'all' ? 'rgba(245,181,51,.12)' : 'transparent',
              color:       projFilter === 'all' ? 'var(--gold)' : 'var(--muted)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            All ({employees.length})
          </button>
          {projects.map(p => {
            const count = employees.filter(e => (p.employeeIds ?? []).includes(e.id)).length
            const active = projFilter === p.id
            return (
              <button
                key={p.id}
                onClick={() => setProjFilter(p.id)}
                style={{
                  padding: '6px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                  border: '1px solid',
                  borderColor: active ? 'var(--gold)' : 'var(--border)',
                  background:  active ? 'rgba(245,181,51,.12)' : 'transparent',
                  color:       active ? 'var(--gold)' : 'var(--muted)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {p.name} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Team grid */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 20px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, color: 'var(--muted)',
        }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>👥</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>No team members yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Your assigned professionals will appear here once your projects are set up.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {filtered.map(emp => {
            const hrsM     = empHrsMonth(emp)
            const empProjs = empProjects(emp)
            return (
              <div
                key={emp.id}
                onClick={() => setSelected(emp)}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 16, padding: '20px',
                  cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--gold)'
                  e.currentTarget.style.boxShadow   = '0 0 0 1px var(--gold)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  e.currentTarget.style.boxShadow   = 'none'
                }}
              >
                {/* Avatar + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                  {emp.photoUrl ? (
                    <img src={emp.photoUrl} alt={emp.name}
                      style={{ width: 48, height: 48, borderRadius: 13, objectFit: 'cover', objectPosition: 'center top', flexShrink: 0 }} />
                  ) : (
                    <div style={{
                      width: 48, height: 48, borderRadius: 13, flexShrink: 0,
                      background: avatarColor(emp.name), display: 'grid', placeItems: 'center',
                      fontSize: 15, fontWeight: 900, color: '#1b1e2b',
                    }}>
                      {initials(emp.name)}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {emp.name}
                    </div>
                    {emp.role && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{emp.role}</div>
                    )}
                    <div style={{ marginTop: 5 }}>
                      <StatusBadge status={emp.status} />
                    </div>
                  </div>
                </div>

                {/* Hours this month */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'var(--surf2)', borderRadius: 10, padding: '10px 14px',
                  marginBottom: 12,
                }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{monthName}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: hrsM > 0 ? 'var(--gold)' : 'var(--muted)' }}>
                    {hrsM > 0 ? `${hrsM.toFixed(1)}h` : '—'}
                  </span>
                </div>

                {/* Projects */}
                {empProjs.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {empProjs.map(p => (
                      <span key={p.id} style={{
                        padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: 'rgba(59,130,246,.1)', color: '#3b82f6',
                      }}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Details hint */}
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)', textAlign: 'right' }}>
                  Click to view details
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Staff request CTA */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '24px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 20, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: 'rgba(245,181,51,.12)', border: '1px solid rgba(245,181,51,.25)',
            display: 'grid', placeItems: 'center', color: 'var(--gold)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" x2="19" y1="8" y2="14"/>
              <line x1="22" x2="16" y1="11" y2="11"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>Need more support?</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              Request additional staff and your account manager will follow up within 1 business day.
            </div>
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowRequest(true)}
          style={{ fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          Request Staff
        </button>
      </div>

      {/* Employee detail modal */}
      {selected && (
        <EmpModal
          emp={selected}
          timeEntries={timeEntries}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Staff request modal */}
      {showRequest && (
        <StaffRequestModal
          clientId={clientId ?? ''}
          clientName={client?.name ?? ''}
          onClose={() => setShowRequest(false)}
        />
      )}

    </div>
  )
}
