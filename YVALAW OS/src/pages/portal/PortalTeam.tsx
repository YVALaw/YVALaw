import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import { IconX, IconUsers, IconInfo, IconCheck, IconUserPlus, IconActivity, IconClock, IconFolder, IconAlert } from '../../components/Icon'
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
    <span className={`status-badge ${active ? 'status-badge-active' : 'status-badge-default'}`}>
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
      <div className="portal-detail-row">
        <span className="portal-detail-row-label">{label}</span>
        <span className="portal-detail-row-value">{value}</span>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="portal-modal-header">
          <div className="flex items-center" style={{ gap: 14 }}>
            {emp.photoUrl ? (
              <img src={emp.photoUrl} alt={emp.name} className="portal-modal-avatar" />
            ) : (
              <div className="portal-modal-avatar-fallback" style={{ background: avatarColor(emp.name) }}>
                {initials(emp.name)}
              </div>
            )}
            <div>
              <div className="portal-modal-name">{emp.name}</div>
              {emp.role && <div className="portal-modal-role">{emp.role}</div>}
              {emp.status && <div className="portal-modal-status"><StatusBadge status={emp.status} /></div>}
            </div>
          </div>
          <button className="modal-close btn-icon" onClick={onClose}><IconX size={14} /></button>
        </div>

        {/* Body */}
        <div className="portal-modal-body">
          {/* Hours KPIs */}
          <div className="portal-hours-kpi-grid">
            <div className="portal-hours-kpi">
              <div className={`portal-hours-kpi-value${hrsMonth > 0 ? ' portal-hours-kpi-value-gold' : ''}`}>
                {hrsMonth > 0 ? `${hrsMonth.toFixed(1)}h` : '—'}
              </div>
              <div className="portal-hours-kpi-label">{monthName}</div>
            </div>
            <div className="portal-hours-kpi">
              <div className="portal-hours-kpi-value">
                {hrsTotal > 0 ? `${hrsTotal.toFixed(1)}h` : '—'}
              </div>
              <div className="portal-hours-kpi-label">All time</div>
            </div>
          </div>

          {/* Detail rows */}
          <Row label="Employment type" value={emp.employmentType} />
          <Row label="Timezone"        value={emp.timezone} />
          <Row label="Schedule"        value={scheduleStr} />
          <Row label="Location"        value={emp.location} />

          {!hasSchedule && (
            <div className="portal-info-banner">
              <IconInfo size={14} />
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
      <div className="modal modal-md" onClick={e => e.stopPropagation()}>
        <div className="portal-modal-header">
          <div>
            <div className="portal-modal-name">Request Additional Staff</div>
            <div className="portal-modal-role">We&apos;ll follow up within 1 business day</div>
          </div>
          <button className="modal-close btn-icon" onClick={onClose}><IconX size={14} /></button>
        </div>

        <div style={{ padding: '24px' }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div className="portal-success-circle">
                <IconCheck size={24} />
              </div>
              <div className="portal-modal-name" style={{ marginBottom: 6 }}>Request sent!</div>
              <div className="empty-state-message" style={{ marginBottom: 20 }}>
                Your account manager will reach out within 1 business day to discuss your needs.
              </div>
              <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex-col" style={{ gap: 16 }}>
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Role needed *</label>
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    required
                    className="form-input"
                  >
                    <option value="">Select a role…</option>
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Hours per week</label>
                  <input
                    type="number" placeholder="e.g. 40" min={1} max={60}
                    value={hours} onChange={e => setHours(e.target.value)}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Ideal start date</label>
                  <input
                    type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea
                  placeholder="Tasks, tools, or experience needed…"
                  rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  className="form-textarea"
                />
              </div>
              {error && (
                <div className="portal-message portal-message-error">{error}</div>
              )}
              <div className="flex" style={{ gap: 10, paddingTop: 4 }}>
                <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={sending || !role} style={{ flex: 1 }}>
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
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Loading team…</div>
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
        <button className="btn-ghost btn-sm" onClick={() => navigate(portalNav('/portal/dashboard'))}>
          ← Dashboard
        </button>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#8b5cf6', borderColor: 'rgba(139,92,246,.15)' }}>
            <IconUsers size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Total Team</div>
            <div className="kpi-value">{employees.length}</div>
            <div className="kpi-sub">Assigned to your account</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,.15)' }}>
            <IconActivity size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Active</div>
            <div className="kpi-value">{activeCount}</div>
            <div className="kpi-sub">Currently on your account</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#3b82f6', borderColor: 'rgba(59,130,246,.15)' }}>
            <IconClock size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Hours — {monthName}</div>
            <div className="kpi-value">{totalHrsMonth > 0 ? `${totalHrsMonth.toFixed(1)}h` : '—'}</div>
            <div className="kpi-sub">Team total this month</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#a855f7', borderColor: 'rgba(168,85,247,.15)' }}>
            <IconFolder size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Projects</div>
            <div className="kpi-value">{projects.length}</div>
            <div className="kpi-sub">{projects.filter(p => p.status?.toLowerCase() === 'active').length} active</div>
          </div>
        </div>
      </div>

      {/* Project filter tabs */}
      {projects.length > 1 && (
        <div className="filter-tabs">
          <button
            onClick={() => setProjFilter('all')}
            className={`filter-tab${projFilter === 'all' ? ' filter-tab-active' : ''}`}
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
                className={`filter-tab${active ? ' filter-tab-active' : ''}`}
              >
                {p.name} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Team grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconUsers size={28} /></div>
          <div className="empty-state-title">No team members yet</div>
          <div className="empty-state-message">
            Your assigned professionals will appear here once your projects are set up.
          </div>
        </div>
      ) : (
        <div className="team-grid">
          {filtered.map(emp => {
            const hrsM     = empHrsMonth(emp)
            const empProjs = empProjects(emp)
            return (
              <div
                key={emp.id}
                onClick={() => setSelected(emp)}
                className="team-card"
              >
                {/* Avatar + name */}
                <div className="flex items-center" style={{ gap: 14, marginBottom: 14 }}>
                  {emp.photoUrl ? (
                    <img src={emp.photoUrl} alt={emp.name} className="team-card-avatar" />
                  ) : (
                    <div className="team-card-avatar-fallback" style={{ background: avatarColor(emp.name) }}>
                      {initials(emp.name)}
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="team-card-name">{emp.name}</div>
                    {emp.role && (
                      <div className="team-card-role">{emp.role}</div>
                    )}
                    <div className="mt-4"><StatusBadge status={emp.status} /></div>
                  </div>
                </div>

                {/* Hours this month */}
                <div className="team-card-hours">
                  <span className="team-card-hours-label">{monthName}</span>
                  <span className={`team-card-hours-value${hrsM > 0 ? ' team-card-hours-value-gold' : ''}`}>
                    {hrsM > 0 ? `${hrsM.toFixed(1)}h` : '—'}
                  </span>
                </div>

                {/* Projects */}
                {empProjs.length > 0 && (
                  <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {empProjs.map(p => (
                      <span key={p.id} className="project-chip">{p.name}</span>
                    ))}
                  </div>
                )}

                {/* Details hint */}
                <div className="team-card-hint">Click to view details</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Staff request CTA */}
      <div className="portal-section-card staff-request-cta">
        <div className="staff-request-cta-left">
          <div className="staff-request-cta-icon">
            <IconUserPlus size={20} />
          </div>
          <div>
            <div className="staff-request-cta-title">Need more support?</div>
            <div className="staff-request-cta-sub">
              Request additional staff and your account manager will follow up within 1 business day.
            </div>
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={() => setShowRequest(true)}
          style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
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
