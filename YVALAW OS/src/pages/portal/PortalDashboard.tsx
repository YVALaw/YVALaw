import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import {
  loadPortalClient,
  loadPortalProjects,
  loadPortalInvoices,
  loadPortalEmployees,
  loadPortalTimeEntries,
  computeOutstanding,
  computeMonthHours,
  fmtUSD,
} from '../../services/portalStorage'
import type { Client, Employee, Invoice, Project, TimeEntry } from '../../data/types'
import { IconWave, IconX, IconCreditCard, IconClock, IconFolder, IconUsers, IconDollar, IconAlert } from '../../components/Icon'

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function statusColor(s?: string): string {
  switch ((s ?? '').toLowerCase()) {
    case 'paid':     return '#22c55e'
    case 'overdue':  return '#ef4444'
    case 'partial':  return '#f97316'
    case 'sent':
    case 'viewed':   return '#3b82f6'
    default:         return 'var(--muted)'
  }
}
function statusBg(s?: string): string {
  switch ((s ?? '').toLowerCase()) {
    case 'paid':     return 'rgba(34,197,94,.1)'
    case 'overdue':  return 'rgba(239,68,68,.1)'
    case 'partial':  return 'rgba(249,115,22,.1)'
    case 'sent':
    case 'viewed':   return 'rgba(59,130,246,.1)'
    default:         return 'var(--surf2)'
  }
}
function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PortalDashboard() {
  const { clientId: roleClientId } = useRole()
  const [searchParams] = useSearchParams()
  const previewId  = searchParams.get('preview')
  const clientId   = roleClientId ?? previewId
  const navigate   = useNavigate()

  function portalNav(path: string) {
    return previewId ? `${path}?preview=${previewId}` : path
  }

  const [client,           setClient]           = useState<Client | null>(null)
  const [projects,         setProjects]         = useState<Project[]>([])
  const [invoices,         setInvoices]         = useState<Invoice[]>([])
  const [employees,        setEmployees]        = useState<Employee[]>([])
  const [timeEntries,      setTimeEntries]      = useState<TimeEntry[]>([])
  const [loading,          setLoading]          = useState(true)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const c = await loadPortalClient(clientId)
      setClient(c)

      if (!c) { setLoading(false); return }

      const [projs, invs] = await Promise.all([
        loadPortalProjects(clientId),
        loadPortalInvoices(c.name),
      ])
      setProjects(projs)
      setInvoices(invs)

      const [emps, entries] = await Promise.all([
        loadPortalEmployees(projs),
        loadPortalTimeEntries(projs.map(p => p.id)),
      ])
      setEmployees(emps)
      setTimeEntries(entries)
      setLoading(false)
    })()
  }, [clientId])

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Loading your dashboard…</div>
      </div>
    )
  }

  // Per-employee hours — sourced from time_entries, same as OS employee profile
  function empEntries(emp: Employee) {
    return timeEntries.filter(e =>
      e.employeeId === emp.id ||
      e.employeeName?.toLowerCase() === emp.name.toLowerCase()
    )
  }
  function empHoursThisMonth(emp: Employee, ym: string): number {
    return empEntries(emp)
      .filter(e => e.date.startsWith(ym))
      .reduce((s, e) => s + e.hours, 0)
  }
  function empHoursTotal(emp: Employee): number {
    return empEntries(emp).reduce((s, e) => s + e.hours, 0)
  }

  // Computed metrics
  const now          = new Date()
  const yearMonth    = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const outstanding  = computeOutstanding(invoices)
  const monthHours   = computeMonthHours(invoices, yearMonth)
  const activeProjs  = projects.filter(p => (p.status ?? '').toLowerCase() === 'active').length
  const latestInv    = invoices[0] ?? null

  const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="page-wrap">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title">
            Welcome back{client?.name ? `, ${client.name.split(' ')[0]}` : ''}
          </div>
          <div className="page-sub">
            {client?.company ? client.company + ' · ' : ''}Here&apos;s your account overview
          </div>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="kpi-grid">
        {/* Outstanding Balance */}
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: outstanding > 0 ? '#ef4444' : 'var(--success)', borderColor: outstanding > 0 ? '#ef444425' : 'rgba(5,150,105,.15)' }}>
            {outstanding > 0 ? <IconAlert size={20} /> : <IconDollar size={20} />}
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Outstanding Balance</div>
            <div className={`kpi-value${outstanding > 0 ? ' kpi-value-warn' : ''}`}>
              {fmtUSD(outstanding)}
            </div>
            <div className="kpi-sub">
              {outstanding > 0 ? 'Payment due' : 'All paid up'}
            </div>
          </div>
        </div>

        {/* Active Projects */}
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#3b82f6', borderColor: 'rgba(59,130,246,.15)' }}>
            <IconFolder size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Active Projects</div>
            <div className="kpi-value">{activeProjs}</div>
            <div className="kpi-sub">
              {projects.length} total project{projects.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Team Size */}
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#8b5cf6', borderColor: 'rgba(139,92,246,.15)' }}>
            <IconUsers size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Team Members</div>
            <div className="kpi-value">{employees.length}</div>
            <div className="kpi-sub">Assigned to your account</div>
          </div>
        </div>

        {/* Hours This Month */}
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,.15)' }}>
            <IconClock size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Hours — {monthName}</div>
            <div className="kpi-value">
              {monthHours > 0 ? `${monthHours.toFixed(1)}h` : '—'}
            </div>
            <div className="kpi-sub">Billed this billing period</div>
          </div>
        </div>
      </div>

      {/* ── My Team ───────────────────────────────────────────────────────── */}
      {employees.length > 0 && (
        <div className="portal-section-card">
          <div className="portal-section-header">
            <div>
              <div className="portal-section-title">My Team</div>
              <div className="portal-section-sub">Your assigned YVA professionals</div>
            </div>
            <button
              className="btn-ghost btn-sm"
              onClick={() => navigate(portalNav('/portal/team'))}
            >
              View all →
            </button>
          </div>
          <div className="portal-inline-list">
            {employees.slice(0, 6).map(emp => (
              <div
                key={emp.id}
                onClick={() => setSelectedEmployee(emp)}
                className="portal-team-chip"
              >
                {emp.photoUrl ? (
                  <img src={emp.photoUrl} alt={emp.name} className="avatar-sm" style={{ borderRadius: 10 }} />
                ) : (
                  <div className="avatar-sm" style={{ background: avatarColor(emp.name) }}>
                    {initials(emp.name)}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{emp.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{emp.role ?? 'Team Member'}</div>
                </div>
              </div>
            ))}
            {employees.length > 6 && (
              <div className="portal-team-chip" style={{ justifyContent: 'center', cursor: 'default' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>+{employees.length - 6} more</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Latest Invoice ─────────────────────────────────────────────────── */}
      {latestInv && (
        <div className="portal-section-card">
          <div className="portal-section-header">
            <div>
              <div className="portal-section-title">Latest Invoice</div>
              <div className="portal-section-sub">Most recent billing activity</div>
            </div>
            <button
              className="btn-ghost btn-sm"
              onClick={() => navigate(portalNav('/portal/billing'))}
            >
              All invoices →
            </button>
          </div>

          <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 16 }}>
            <div className="flex-col" style={{ gap: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{latestInv.number}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {latestInv.projectName ?? 'No project'} · Issued {fmtDate(latestInv.date)}
              </div>
              {latestInv.dueDate && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Due {fmtDate(latestInv.dueDate)}</div>
              )}
            </div>
            <div className="flex items-center" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="text-right">
                <div className="stat-value-lg">{fmtUSD(Number(latestInv.subtotal) || 0)}</div>
                {latestInv.amountPaid && Number(latestInv.amountPaid) > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {fmtUSD(Number(latestInv.amountPaid))} paid
                  </div>
                )}
              </div>
              <span
                className="badge"
                style={{ color: statusColor(latestInv.status), background: statusBg(latestInv.status), borderColor: statusColor(latestInv.status) + '33' }}
              >
                {(latestInv.status ?? 'Draft').charAt(0).toUpperCase() + (latestInv.status ?? 'draft').slice(1)}
              </span>
            </div>
          </div>

          {/* Billing page owns Stripe checkout so dashboard stays a lightweight overview. */}
          {['sent','viewed','overdue','partial'].includes((latestInv.status ?? '').toLowerCase()) && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
              <button
                className="btn-primary"
                onClick={() => navigate(portalNav('/portal/billing'))}
                title="Open billing to pay this invoice"
              >
                <IconCreditCard size={14} />
                Pay in Billing
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Active Projects ─────────────────────────────────────────────────── */}
      {projects.length > 0 && (
        <div className="portal-section-card">
          <div className="portal-section-header">
            <div>
              <div className="portal-section-title">My Projects</div>
              <div className="portal-section-sub">Active engagements</div>
            </div>
            <button
              className="btn-ghost btn-sm"
              onClick={() => navigate(portalNav('/portal/projects'))}
            >
              Details →
            </button>
          </div>
          <div className="portal-card-list">
            {projects.slice(0, 3).map(proj => (
              <div key={proj.id} className="portal-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{proj.name}</div>
                  {proj.description && (
                    <div className="card-sub" style={{ maxWidth: 320 }}>{proj.description}</div>
                  )}
                </div>
                <span className={`badge ${(proj.status ?? '').toLowerCase() === 'active' ? 'badge-green' : 'badge-gray'}`}>
                  {proj.status ?? 'Active'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {projects.length === 0 && invoices.length === 0 && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon"><IconWave size={28} /></div>
          <div className="empty-state-title">Your portal is ready</div>
          <div className="empty-state-message">
            Once your account manager sets up your projects and assignments, you&apos;ll see everything here.
          </div>
        </div>
      )}

      {/* ── Employee detail modal ────────────────────────────────────────────── */}
      {selectedEmployee && (() => {
        const emp = selectedEmployee
        const now2 = new Date()
        const ym   = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}`
        const hrsMonth = empHoursThisMonth(emp, ym)
        const hrsTotal = empHoursTotal(emp)
        const monthName2 = now2.toLocaleString('en-US', { month: 'long', year: 'numeric' })

        function Row({ label, value }: { label: string; value?: string | null }) {
          if (!value) return null
          return (
            <div className="portal-detail-row">
              <span className="portal-detail-row-label">{label}</span>
              <span className="portal-detail-row-value">{value}</span>
            </div>
          )
        }

        const hasSchedule = emp.defaultShiftStart || emp.defaultShiftEnd
        const scheduleStr = hasSchedule
          ? [emp.defaultShiftStart, emp.defaultShiftEnd].filter(Boolean).join(' – ')
          : null

        return (
          <div className="modal-overlay" onClick={() => setSelectedEmployee(null)} style={{ zIndex: 200 }}>
            <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
              {/* Modal header */}
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
                    {emp.status && (
                      <span className={`status-badge ${emp.status.toLowerCase() === 'active' ? 'status-badge-active' : 'status-badge-default'} portal-modal-status`}>
                        {emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}
                      </span>
                    )}
                  </div>
                </div>
                <button className="modal-close btn-icon" onClick={() => setSelectedEmployee(null)}><IconX size={14} /></button>
              </div>

              {/* Modal body */}
              <div className="portal-modal-body">
                {/* Hours this month */}
                <div className="portal-hours-kpi-grid">
                  <div className="portal-hours-kpi">
                    <div className={`portal-hours-kpi-value${hrsMonth > 0 ? ' portal-hours-kpi-value-gold' : ''}`}>
                      {hrsMonth > 0 ? `${hrsMonth.toFixed(1)}h` : '—'}
                    </div>
                    <div className="portal-hours-kpi-label">{monthName2}</div>
                  </div>
                  <div className="portal-hours-kpi">
                    <div className="portal-hours-kpi-value">
                      {hrsTotal > 0 ? `${hrsTotal.toFixed(1)}h` : '—'}
                    </div>
                    <div className="portal-hours-kpi-label">All time</div>
                  </div>
                </div>

                {/* Details rows */}
                <div>
                  <Row label="Employment type" value={emp.employmentType} />
                  <Row label="Timezone"        value={emp.timezone} />
                  <Row label="Schedule"        value={scheduleStr} />
                  <Row label="Location"        value={emp.location} />
                </div>

                {/* Schedule placeholder if not set */}
                {!hasSchedule && (
                  <div className="portal-info-banner">
                    <IconClock size={14} />
                    Schedule details will appear here once configured.
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
