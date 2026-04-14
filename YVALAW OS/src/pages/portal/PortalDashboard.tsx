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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading your dashboard…</div>
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
            {client?.company ? client.company + ' · ' : ''}Here's your account overview
          </div>
        </div>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div className="kpi-grid">
        {/* Outstanding Balance */}
        <div className="kpi-card" style={{ borderTop: `3px solid ${outstanding > 0 ? '#ef4444' : 'var(--gold)'}` }}>
          <div className="kpi-label">Outstanding Balance</div>
          <div className={`kpi-value${outstanding > 0 ? ' kpi-value-warn' : ''}`}>
            {fmtUSD(outstanding)}
          </div>
          <div className="kpi-sub">
            {outstanding > 0 ? 'Payment due' : 'All paid up'}
          </div>
        </div>

        {/* Active Projects */}
        <div className="kpi-card" style={{ borderTop: '3px solid var(--gold)' }}>
          <div className="kpi-label">Active Projects</div>
          <div className="kpi-value">{activeProjs}</div>
          <div className="kpi-sub">
            {projects.length} total project{projects.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Team Size */}
        <div className="kpi-card" style={{ borderTop: '3px solid #3b82f6' }}>
          <div className="kpi-label">Team Members</div>
          <div className="kpi-value">{employees.length}</div>
          <div className="kpi-sub">Assigned to your account</div>
        </div>

        {/* Hours This Month */}
        <div className="kpi-card" style={{ borderTop: '3px solid #22c55e' }}>
          <div className="kpi-label">Hours — {monthName}</div>
          <div className="kpi-value">
            {monthHours > 0 ? `${monthHours.toFixed(1)}h` : '—'}
          </div>
          <div className="kpi-sub">Billed this billing period</div>
        </div>
      </div>

      {/* ── My Team ───────────────────────────────────────────────────────── */}
      {employees.length > 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>My Team</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Your assigned YVA professionals</div>
            </div>
            <button
              className="btn-ghost btn-sm"
              onClick={() => navigate(portalNav('/portal/team'))}
              style={{ fontSize: 12 }}
            >
              View all →
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {employees.slice(0, 6).map(emp => (
              <div key={emp.id} onClick={() => setSelectedEmployee(emp)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px',
                background: 'var(--surf2)', borderRadius: 12,
                border: '1px solid var(--border)',
                minWidth: 0, cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--gold)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                {emp.photoUrl ? (
                  <img src={emp.photoUrl} alt={emp.name}
                    style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'cover', objectPosition: 'center top', flexShrink: 0 }} />
                ) : (
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: avatarColor(emp.name), display: 'grid', placeItems: 'center',
                    fontSize: 12, fontWeight: 900, color: '#1b1e2b', flexShrink: 0,
                  }}>
                    {initials(emp.name)}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>{emp.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{emp.role ?? 'Team Member'}</div>
                </div>
              </div>
            ))}
            {employees.length > 6 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '10px 14px', background: 'var(--surf2)', borderRadius: 12,
                border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', fontWeight: 600,
              }}>
                +{employees.length - 6} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Latest Invoice ─────────────────────────────────────────────────── */}
      {latestInv && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>Latest Invoice</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Most recent billing activity</div>
            </div>
            <button
              className="btn-ghost btn-sm"
              onClick={() => navigate(portalNav('/portal/billing'))}
              style={{ fontSize: 12 }}
            >
              All invoices →
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>{latestInv.number}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {latestInv.projectName ?? 'No project'} · Issued {fmtDate(latestInv.date)}
              </div>
              {latestInv.dueDate && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Due {fmtDate(latestInv.dueDate)}</div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>
                  {fmtUSD(Number(latestInv.subtotal) || 0)}
                </div>
                {latestInv.amountPaid && Number(latestInv.amountPaid) > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {fmtUSD(Number(latestInv.amountPaid))} paid
                  </div>
                )}
              </div>
              <span style={{
                padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                color: statusColor(latestInv.status),
                background: statusBg(latestInv.status),
              }}>
                {(latestInv.status ?? 'Draft').charAt(0).toUpperCase() + (latestInv.status ?? 'draft').slice(1)}
              </span>
            </div>
          </div>

          {/* Billing page owns Stripe checkout so dashboard stays a lightweight overview. */}
          {['sent','viewed','overdue','partial'].includes((latestInv.status ?? '').toLowerCase()) && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
              <button
                className="btn-primary"
                style={{ gap: 6 }}
                onClick={() => navigate(portalNav('/portal/billing'))}
                title="Open billing to pay this invoice"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                Pay in Billing
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Active Projects ─────────────────────────────────────────────────── */}
      {projects.length > 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>My Projects</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Active engagements</div>
            </div>
            <button
              className="btn-ghost btn-sm"
              onClick={() => navigate(portalNav('/portal/projects'))}
              style={{ fontSize: 12 }}
            >
              Details →
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {projects.slice(0, 3).map(proj => (
              <div key={proj.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', background: 'var(--surf2)',
                borderRadius: 12, border: '1px solid var(--border)',
                flexWrap: 'wrap', gap: 10,
              }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{proj.name}</div>
                  {proj.description && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, maxWidth: 320,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {proj.description}
                    </div>
                  )}
                </div>
                <span style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                  background: (proj.status ?? '').toLowerCase() === 'active' ? 'rgba(34,197,94,.1)' : 'var(--surf3)',
                  color: (proj.status ?? '').toLowerCase() === 'active' ? '#15803d' : 'var(--muted)',
                }}>
                  {proj.status ?? 'Active'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {projects.length === 0 && invoices.length === 0 && !loading && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, color: 'var(--muted)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>👋</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            Your portal is ready
          </div>
          <div style={{ fontSize: 13, maxWidth: 360, margin: '0 auto' }}>
            Once your account manager sets up your projects and assignments, you'll see everything here.
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{value}</span>
            </div>
          )
        }

        const hasSchedule = emp.defaultShiftStart || emp.defaultShiftEnd
        const scheduleStr = hasSchedule
          ? [emp.defaultShiftStart, emp.defaultShiftEnd].filter(Boolean).join(' – ')
          : null

        return (
          <div
            className="modal-overlay"
            onClick={() => setSelectedEmployee(null)}
            style={{ zIndex: 200 }}
          >
            <div
              className="modal"
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: 420, width: '100%' }}
            >
              {/* Modal header */}
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
                    {emp.status && (
                      <span style={{
                        display: 'inline-block', marginTop: 4,
                        padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                        background: emp.status.toLowerCase() === 'active' ? 'rgba(34,197,94,.1)' : 'var(--surf2)',
                        color: emp.status.toLowerCase() === 'active' ? '#15803d' : 'var(--muted)',
                      }}>
                        {emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="modal-close btn-icon"
                  onClick={() => setSelectedEmployee(null)}
                >✕</button>
              </div>

              {/* Modal body */}
              <div style={{ padding: '8px 24px 24px' }}>

                {/* Hours this month */}
                <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
                  <div style={{
                    flex: 1, background: 'var(--surf2)', borderRadius: 12,
                    padding: '12px 16px', border: '1px solid var(--border)', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--gold)' }}>
                      {hrsMonth > 0 ? `${hrsMonth.toFixed(1)}h` : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{monthName2}</div>
                  </div>
                  <div style={{
                    flex: 1, background: 'var(--surf2)', borderRadius: 12,
                    padding: '12px 16px', border: '1px solid var(--border)', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>
                      {hrsTotal > 0 ? `${hrsTotal.toFixed(1)}h` : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>All time</div>
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
      })()}

    </div>
  )
}
