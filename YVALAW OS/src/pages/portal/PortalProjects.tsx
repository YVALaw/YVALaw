// Portal → Projects: one card per project — team avatars, hours and billing this month, outstanding, totals.
import { useEffect, useState } from 'react'
import {
  loadPortalClient,
  loadPortalProjects,
  loadPortalInvoices,
  loadPortalEmployees,
  loadPortalTimeEntries,
  fmtUSD,
} from '../../services/portalStorage'
import type { Client, Employee, Invoice, Project, TimeEntry } from '../../data/types'
import { Pill } from '../../components/ui'
import { usePortal, PersonAvatar, PortalSkeleton, hoursText, sumHours, monthKey, isUnpaid, invoiceBalance } from '../../components/PortalSection'
import { dateMed } from '../../utils/format'

function projectInvoiceStats(invoices: Invoice[], projectId: string, ym: string) {
  const projInvs    = invoices.filter(inv => inv.projectId === projectId)
  const totalBilled = projInvs.reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  const totalPaid   = projInvs.reduce((s, inv) => s + (Number(inv.amountPaid) || 0), 0)
  const outstanding = projInvs.filter(isUnpaid).reduce((s, inv) => s + invoiceBalance(inv), 0)
  const monthBilled = projInvs.filter(inv => (inv.billingStart ?? inv.date ?? '').startsWith(ym)).reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  return { totalBilled, totalPaid, outstanding, monthBilled, count: projInvs.length }
}

export default function PortalProjects() {
  const { clientId } = usePortal()

  const [client,      setClient]      = useState<Client | null>(null)
  const [projects,    setProjects]    = useState<Project[]>([])
  const [invoices,    setInvoices]    = useState<Invoice[]>([])
  const [employees,   setEmployees]   = useState<Employee[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const c = await loadPortalClient(clientId)
      setClient(c)
      if (!c) { setLoading(false); return }
      const [projs, invs] = await Promise.all([loadPortalProjects(clientId), loadPortalInvoices(c.name)])
      setProjects(projs)
      setInvoices(invs)
      const [emps, entries] = await Promise.all([loadPortalEmployees(clientId), loadPortalTimeEntries(projs.map(p => p.id))])
      setEmployees(emps)
      setTimeEntries(entries)
      setLoading(false)
    })()
  }, [clientId])

  if (loading) return <PortalSkeleton />

  const ym = monthKey()
  const mon = new Date().toLocaleString('en-US', { month: 'short' })
  const empById = Object.fromEntries(employees.map(e => [e.id, e]))
  const active = projects.filter(p => (p.status ?? '').toLowerCase() === 'active').length
  const completed = projects.filter(p => (p.status ?? '').toLowerCase() === 'completed').length
  const totalBilled = invoices.reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)

  return (
    <div className="por-page">
      <p className="por-summary">
        {client?.company ? `${client.company} · ` : ''}{projects.length} project{projects.length !== 1 ? 's' : ''} · {active} active
        {completed > 0 ? ` · ${completed} completed` : ''} · {fmtUSD(totalBilled)} billed in total
      </p>

      {projects.length === 0 ? (
        <div className="card card-empty por-empty">
          <strong>No projects yet</strong>
          <span>Your account manager will set up your first project soon.</span>
        </div>
      ) : (
        <div className="por-grid por-grid--projects">
          {projects.map(proj => {
            const stats = projectInvoiceStats(invoices, proj.id, ym)
            const team = (proj.employeeIds ?? []).map(id => empById[id]).filter(Boolean) as Employee[]
            const hours = sumHours(timeEntries.filter(e => e.projectId === proj.id), undefined, ym)
            const status = (proj.status ?? 'active').toLowerCase()
            const start = proj.startDate ? dateMed(proj.startDate) : null
            const end = proj.endDate ? dateMed(proj.endDate) : null
            return (
              <section key={proj.id} className="card por-proj">
                <div className="por-card__row">
                  <h2 className="por-proj__name">{proj.name}</h2>
                  {status !== 'active' && <Pill status={status} />}
                </div>
                {proj.description && <p className="por-proj__desc">{proj.description}</p>}
                {team.length > 0 && (
                  <div className="por-stack" aria-label={team.map(t => t.name).join(', ')}>
                    {team.slice(0, 6).map(emp => <PersonAvatar key={emp.id} emp={emp} size="sm" />)}
                    {team.length > 6 && <span className="por-av por-av--sm por-av--more">+{team.length - 6}</span>}
                    <span className="por-stack__names">{team.map(t => t.name.split(' ')[0]).join(', ')}</span>
                  </div>
                )}
                <div className="por-proj__stats">
                  <span className="por-mini"><span className="por-mini__k">Hours, {mon}</span><span className="por-mini__v num">{hoursText(hours)}</span></span>
                  <span className="por-mini"><span className="por-mini__k">Billed, {mon}</span><span className="por-mini__v num">{fmtUSD(stats.monthBilled)}</span></span>
                  <span className="por-mini"><span className="por-mini__k">Outstanding</span><span className={`por-mini__v num${stats.outstanding > 0 ? ' t-warning' : ''}`}>{fmtUSD(stats.outstanding)}</span></span>
                </div>
                <p className="por-proj__foot">
                  {stats.count > 0
                    ? `${fmtUSD(stats.totalBilled)} billed · ${fmtUSD(stats.totalPaid)} paid · ${stats.count} invoice${stats.count !== 1 ? 's' : ''}`
                    : 'No invoices yet'}
                  {start && ` · Started ${start}`}{end && ` · Ends ${end}`}
                </p>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
