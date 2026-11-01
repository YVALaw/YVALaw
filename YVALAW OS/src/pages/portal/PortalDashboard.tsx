// Portal → Home: navy balance-due hero with gold Pay now, stats, team cards → member modal.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadPortalClient,
  loadPortalProjects,
  loadPortalInvoices,
  loadPortalEmployees,
  loadPortalTimeEntries,
  computeOutstanding,
  fmtUSD,
} from '../../services/portalStorage'
import type { Client, Employee, Invoice, Project, TimeEntry } from '../../data/types'
import {
  usePortal, MemberModal, PersonAvatar, PortalSkeleton, entriesFor, hoursText, sumHours, weekStartIso, monthKey, monthLabel,
  oldestUnpaid, invoiceBalance,
} from '../../components/PortalSection'
import { dateShort } from '../../utils/format'

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function PortalDashboard() {
  const { clientId, isPreview, portalNav } = usePortal()
  const navigate = useNavigate()

  const [client,      setClient]      = useState<Client | null>(null)
  const [projects,    setProjects]    = useState<Project[]>([])
  const [invoices,    setInvoices]    = useState<Invoice[]>([])
  const [employees,   setEmployees]   = useState<Employee[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState<Employee | null>(null)

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

  if (loading) return <PortalSkeleton hero />

  const outstanding = computeOutstanding(invoices)
  const due = oldestUnpaid(invoices)
  const latest = invoices[0] ?? null
  const today = new Date().toISOString().slice(0, 10)
  const overdue = due ? (due.status ?? '').toLowerCase() === 'overdue' || Boolean(due.dueDate && due.dueDate < today) : false
  const weekFrom = weekStartIso()
  const weekHours = sumHours(timeEntries, weekFrom)
  const monthHours = sumHours(timeEntries, undefined, monthKey())
  const activeProjects = projects.filter(p => (p.status ?? 'active').toLowerCase() === 'active').length
  const unpaidCount = invoices.filter(i => ['sent', 'viewed', 'overdue', 'partial'].includes((i.status ?? '').toLowerCase())).length

  const stats = [
    { label: 'Team members', value: String(employees.length) },
    { label: 'Hours this week', value: hoursText(weekHours) },
    { label: `Hours in ${monthLabel()}`, value: hoursText(monthHours) },
    { label: 'Active projects', value: String(activeProjects) },
  ]

  return (
    <div className="por-page">
      <h1 className="por-greeting">{greeting()}{client?.name ? `, ${client.name}` : ''}</h1>

      <section className="por-hero" aria-label="Balance due">
        <div className="por-hero__text">
          <span className="por-hero__label">Balance due</span>
          <span className="por-hero__amount num">{fmtUSD(outstanding)}</span>
          {due ? (
            <span className={`por-hero__meta${overdue ? ' por-hero__meta--late' : ''}`}>
              <span className="mono">{due.number}</span>
              {due.dueDate ? ` · ${overdue ? 'was due' : 'due'} ${dateShort(due.dueDate)}` : ''}
              {unpaidCount > 1 ? ` · ${unpaidCount} unpaid invoices` : ''}
            </span>
          ) : (
            <span className="por-hero__meta">
              All paid up{latest ? <> · last invoice <span className="mono">{latest.number}</span></> : ''}
            </span>
          )}
        </div>
        {due && (
          <button type="button" className="btn btn--gold por-hero__pay"
            onClick={() => navigate(portalNav(`/portal/billing?pay=${encodeURIComponent(due.id)}`))}
            title={isPreview ? 'Opens Billing (payment is disabled in preview)' : `Pay ${fmtUSD(invoiceBalance(due))}`}>
            Pay now
          </button>
        )}
      </section>

      <div className="por-stats">
        {stats.map(s => (
          <div key={s.label} className="card por-stat">
            <span className="por-stat__label">{s.label}</span>
            <span className="por-stat__value num">{s.value}</span>
          </div>
        ))}
      </div>

      {employees.length > 0 && (
        <>
          <div className="por-section-head">
            <h2 className="por-section-title">Your team this week</h2>
            <button type="button" className="link" onClick={() => navigate(portalNav('/portal/team'))}>All team →</button>
          </div>
          <div className="por-grid por-grid--team">
            {employees.map(emp => (
              <button key={emp.id} type="button" className="card card--hover por-person" onClick={() => setSelected(emp)}>
                <PersonAvatar emp={emp} />
                <span className="por-person__text">
                  <span className="por-person__name">{emp.name}</span>
                  <span className="por-person__role">{emp.role || 'Team member'}</span>
                </span>
                <span className="por-person__hours mono">{hoursText(sumHours(entriesFor(emp, timeEntries), weekFrom))}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {projects.length === 0 && invoices.length === 0 && employees.length === 0 && (
        <div className="card card-empty por-empty">
          <strong>Your portal is ready</strong>
          <span>Once your account manager sets up your projects and assignments, you&apos;ll see everything here.</span>
        </div>
      )}

      <MemberModal emp={selected} entries={timeEntries} projects={projects} onClose={() => setSelected(null)} />
    </div>
  )
}
