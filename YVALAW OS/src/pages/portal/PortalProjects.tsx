import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import { IconClipboard, IconFolder, IconActivity, IconDollar } from '../../components/Icon'
import {
  loadPortalClient,
  loadPortalProjects,
  loadPortalInvoices,
  loadPortalEmployees,
  fmtUSD,
} from '../../services/portalStorage'
import type { Client, Employee, Invoice, Project } from '../../data/types'

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function fmtDate(d?: string) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function statusColor(s?: string) {
  switch ((s ?? '').toLowerCase()) {
    case 'active':    return '#22c55e'
    case 'completed': return '#3b82f6'
    case 'paused':    return '#f97316'
    case 'cancelled': return '#ef4444'
    default:          return 'var(--muted)'
  }
}
function statusBg(s?: string) {
  switch ((s ?? '').toLowerCase()) {
    case 'active':    return 'rgba(34,197,94,.1)'
    case 'completed': return 'rgba(59,130,246,.1)'
    case 'paused':    return 'rgba(249,115,22,.1)'
    case 'cancelled': return 'rgba(239,68,68,.1)'
    default:          return 'var(--surf2)'
  }
}

function projectInvoiceStats(invoices: Invoice[], projectId: string) {
  const projInvs = invoices.filter(inv => inv.projectId === projectId)
  const totalBilled   = projInvs.reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  const totalPaid     = projInvs.reduce((s, inv) => s + (Number(inv.amountPaid) || 0), 0)
  const outstanding   = projInvs
    .filter(inv => ['sent','viewed','overdue','partial'].includes((inv.status ?? '').toLowerCase()))
    .reduce((s, inv) => s + ((Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)), 0)
  return { totalBilled, totalPaid, outstanding, count: projInvs.length }
}

export default function PortalProjects() {
  const { clientId: roleClientId } = useRole()
  const [searchParams] = useSearchParams()
  const previewId  = searchParams.get('preview')
  const clientId   = roleClientId ?? previewId
  const navigate   = useNavigate()

  function portalNav(path: string) {
    return previewId ? `${path}?preview=${previewId}` : path
  }

  const [client,    setClient]    = useState<Client | null>(null)
  const [projects,  setProjects]  = useState<Project[]>([])
  const [invoices,  setInvoices]  = useState<Invoice[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading,   setLoading]   = useState(true)

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

      const emps = await loadPortalEmployees(projs)
      setEmployees(emps)
      setLoading(false)
    })()
  }, [clientId])

  const empById = Object.fromEntries(employees.map(e => [e.id, e]))

  const active    = projects.filter(p => (p.status ?? '').toLowerCase() === 'active').length
  const completed = projects.filter(p => (p.status ?? '').toLowerCase() === 'completed').length

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Loading projects…</div>
      </div>
    )
  }

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title">My Projects</div>
          <div className="page-sub">
            {client?.company ? client.company + ' · ' : ''}
            {projects.length} project{projects.length !== 1 ? 's' : ''} · {active} active
            {completed > 0 ? ` · ${completed} completed` : ''}
          </div>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => navigate(portalNav('/portal/dashboard'))}>
          ← Dashboard
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="kpi-grid portal-kpi-3">
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#3b82f6', borderColor: 'rgba(59,130,246,.15)' }}>
            <IconFolder size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Total Projects</div>
            <div className="kpi-value">{projects.length}</div>
            <div className="kpi-sub">All engagements</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,.15)' }}>
            <IconActivity size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Active</div>
            <div className="kpi-value">{active}</div>
            <div className="kpi-sub">Currently running</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: 'var(--gold)', borderColor: 'rgba(212,168,67,.15)' }}>
            <IconDollar size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Total Billed</div>
            <div className="kpi-value" style={{ fontSize: 20 }}>
              {fmtUSD(invoices.reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0))}
            </div>
            <div className="kpi-sub">Across all projects</div>
          </div>
        </div>
      </div>

      {/* Project cards */}
      {projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconClipboard size={28} /></div>
          <div className="empty-state-title">No projects yet</div>
          <div className="empty-state-message">
            Your account manager will set up your first project soon.
          </div>
        </div>
      ) : (
        <div className="portal-card-list">
          {projects.map(proj => {
            const stats       = projectInvoiceStats(invoices, proj.id)
            const projEmps    = (proj.employeeIds ?? []).map(id => empById[id]).filter(Boolean)
            const startLabel  = fmtDate(proj.startDate)
            const endLabel    = fmtDate(proj.endDate)

            return (
              <div key={proj.id} className="portal-section-card">
                {/* Project header */}
                <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{proj.name}</div>
                    {proj.description && (
                      <div className="card-sub mt-4" style={{ maxWidth: 560 }}>{proj.description}</div>
                    )}
                    {(startLabel || endLabel) && (
                      <div className="mt-6 flex" style={{ gap: 12, fontSize: 12, color: 'var(--muted)' }}>
                        {startLabel && <span>Started {startLabel}</span>}
                        {endLabel   && <span>· Ends {endLabel}</span>}
                      </div>
                    )}
                  </div>
                  <span className="badge" style={{ color: statusColor(proj.status), background: statusBg(proj.status), borderColor: statusColor(proj.status) + '33', flexShrink: 0 }}>
                    {(proj.status ?? 'Active').charAt(0).toUpperCase() + (proj.status ?? 'active').slice(1)}
                  </span>
                </div>

                <div className="flex" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                  {/* Team members */}
                  {projEmps.length > 0 && (
                    <div className="project-sub-card">
                      <div className="project-sub-card-title">Assigned Team</div>
                      <div className="flex-col" style={{ gap: 8 }}>
                        {projEmps.map(emp => (
                          <div key={emp.id} className="project-emp-row">
                            {emp.photoUrl ? (
                              <img src={emp.photoUrl} alt={emp.name} className="project-emp-avatar" />
                            ) : (
                              <div className="project-emp-avatar-fallback" style={{ background: avatarColor(emp.name) }}>
                                {initials(emp.name)}
                              </div>
                            )}
                            <div>
                              <div className="project-emp-name">{emp.name}</div>
                              {emp.role && <div className="project-emp-role">{emp.role}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Billing summary */}
                  {stats.count > 0 ? (
                    <div className="project-sub-card">
                      <div className="project-sub-card-title">Billing Summary</div>
                      <div className="flex-col" style={{ gap: 8 }}>
                        <div className="labeled-row">
                          <span className="labeled-row-label">Total billed</span>
                          <span className="labeled-row-value">{fmtUSD(stats.totalBilled)}</span>
                        </div>
                        <div className="labeled-row">
                          <span className="labeled-row-label">Paid</span>
                          <span className="labeled-row-value text-green">{fmtUSD(stats.totalPaid)}</span>
                        </div>
                        {stats.outstanding > 0 && (
                          <div className="labeled-row">
                            <span className="labeled-row-label">Outstanding</span>
                            <span className="labeled-row-value text-warn">{fmtUSD(stats.outstanding)}</span>
                          </div>
                        )}
                        <div className="mt-2" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {stats.count} invoice{stats.count !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="project-sub-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>No invoices yet</span>
                    </div>
                  )}

                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
