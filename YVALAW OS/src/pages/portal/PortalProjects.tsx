import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading projects…</div>
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
        <button
          className="btn-ghost btn-sm"
          onClick={() => navigate(portalNav('/portal/dashboard'))}
          style={{ fontSize: 12 }}
        >
          ← Dashboard
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="kpi-card" style={{ borderTop: '3px solid var(--gold)' }}>
          <div className="kpi-label">Total Projects</div>
          <div className="kpi-value">{projects.length}</div>
          <div className="kpi-sub">All engagements</div>
        </div>
        <div className="kpi-card" style={{ borderTop: '3px solid #22c55e' }}>
          <div className="kpi-label">Active</div>
          <div className="kpi-value">{active}</div>
          <div className="kpi-sub">Currently running</div>
        </div>
        <div className="kpi-card" style={{ borderTop: '3px solid #3b82f6' }}>
          <div className="kpi-label">Total Billed</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>
            {fmtUSD(invoices.reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0))}
          </div>
          <div className="kpi-sub">Across all projects</div>
        </div>
      </div>

      {/* Project cards */}
      {projects.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, color: 'var(--muted)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            No projects yet
          </div>
          <div style={{ fontSize: 13, maxWidth: 360, margin: '0 auto' }}>
            Your account manager will set up your first project soon.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {projects.map(proj => {
            const stats       = projectInvoiceStats(invoices, proj.id)
            const projEmps    = (proj.employeeIds ?? []).map(id => empById[id]).filter(Boolean)
            const startLabel  = fmtDate(proj.startDate)
            const endLabel    = fmtDate(proj.endDate)

            return (
              <div key={proj.id} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 16, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}>

                {/* Project header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>{proj.name}</div>
                    {proj.description && (
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, maxWidth: 560 }}>
                        {proj.description}
                      </div>
                    )}
                    {(startLabel || endLabel) && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, display: 'flex', gap: 12 }}>
                        {startLabel && <span>Started {startLabel}</span>}
                        {endLabel   && <span>· Ends {endLabel}</span>}
                      </div>
                    )}
                  </div>
                  <span style={{
                    padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                    color: statusColor(proj.status),
                    background: statusBg(proj.status),
                    flexShrink: 0,
                  }}>
                    {(proj.status ?? 'Active').charAt(0).toUpperCase() + (proj.status ?? 'active').slice(1)}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                  {/* Team members */}
                  {projEmps.length > 0 && (
                    <div style={{
                      flex: 1, minWidth: 220,
                      background: 'var(--surf2)', borderRadius: 12,
                      padding: '14px 16px', border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                        Assigned Team
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {projEmps.map(emp => (
                          <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {emp.photoUrl ? (
                              <img src={emp.photoUrl} alt={emp.name}
                                style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover', objectPosition: 'center top', flexShrink: 0 }} />
                            ) : (
                              <div style={{
                                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                background: avatarColor(emp.name), display: 'grid', placeItems: 'center',
                                fontSize: 11, fontWeight: 900, color: '#1b1e2b',
                              }}>
                                {initials(emp.name)}
                              </div>
                            )}
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>{emp.name}</div>
                              {emp.role && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{emp.role}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Billing summary */}
                  {stats.count > 0 ? (
                    <div style={{
                      flex: 1, minWidth: 220,
                      background: 'var(--surf2)', borderRadius: 12,
                      padding: '14px 16px', border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                        Billing Summary
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span style={{ color: 'var(--muted)' }}>Total billed</span>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{fmtUSD(stats.totalBilled)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span style={{ color: 'var(--muted)' }}>Paid</span>
                          <span style={{ fontWeight: 700, color: '#22c55e' }}>{fmtUSD(stats.totalPaid)}</span>
                        </div>
                        {stats.outstanding > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                            <span style={{ color: 'var(--muted)' }}>Outstanding</span>
                            <span style={{ fontWeight: 700, color: '#ef4444' }}>{fmtUSD(stats.outstanding)}</span>
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {stats.count} invoice{stats.count !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      flex: 1, minWidth: 220,
                      background: 'var(--surf2)', borderRadius: 12,
                      padding: '14px 16px', border: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
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
