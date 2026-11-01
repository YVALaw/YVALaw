// Portal → Team: project filter chips, gold "Request more staff" modal (→ staff_requests), team cards → member modal.
import { useEffect, useState } from 'react'
import {
  loadPortalClient,
  loadPortalProjects,
  loadPortalEmployees,
  loadPortalTimeEntries,
  submitStaffRequest,
} from '../../services/portalStorage'
import type { Client, Employee, Project, TimeEntry } from '../../data/types'
import { Chips, Modal } from '../../components/ui'
import { Ic, P } from '../../components/Icon'
import { usePortal, MemberModal, PersonAvatar, PortalSkeleton, entriesFor, hoursText, sumHours, weekStartIso, monthKey, monthLabel } from '../../components/PortalSection'

// Suggestions for the Role field (free text is allowed)
const ROLE_OPTIONS = [
  'Legal Intake Specialist',
  'Legal Assistant',
  'Demand Writer',
  'Case Manager',
  'Admin / Virtual Assistant',
]

function StaffRequestModal({ open, clientId, clientName, projects, onClose }: { open: boolean; clientId: string; clientName: string; projects: Project[]; onClose: () => void }) {
  const [role,      setRole]      = useState('')
  const [headcount, setHeadcount] = useState('1')
  const [hours,     setHours]     = useState('')
  const [startDate, setStartDate] = useState('')
  const [projectId, setProjectId] = useState('')
  const [notes,     setNotes]     = useState('')
  const [sent,      setSent]      = useState(false)
  const [sending,   setSending]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRole(''); setHeadcount('1'); setHours(''); setStartDate(''); setProjectId(projects.length === 1 ? projects[0].id : ''); setNotes('')
    setSent(false); setError(null)
  }, [open, projects])

  async function handleSubmit() {
    if (!role.trim()) { setError('Tell us which role you need.'); return }
    setSending(true)
    setError(null)
    const project = projects.find(p => p.id === projectId)
    try {
      await submitStaffRequest({
        clientId,
        clientName,
        role:         role.trim(),
        headcount:    Math.max(1, Math.min(50, Number(headcount) || 1)),
        hoursPerWeek: hours ? Number(hours) : undefined,
        startDate:    startDate || undefined,
        projectId:    project?.id,
        projectName:  project?.name,
        notes:        notes.trim() || undefined,
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
    <Modal open={open} onClose={onClose} title={sent ? 'Request sent' : 'Request more staff'}
      sub={sent ? undefined : 'We’ll follow up within 1 business day.'}
      footer={sent
        ? <button type="button" className="btn btn--primary por-btn-lg" onClick={onClose}>Done</button>
        : <>
            <button type="button" className="btn por-btn-lg" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn--primary por-btn-lg" disabled={sending || !role.trim()} onClick={() => void handleSubmit()}>{sending ? 'Sending…' : 'Send request'}</button>
          </>}>
      {sent ? (
        <div className="por-done">
          <span className="por-pay__icon por-pay__icon--ok"><Ic d={P.check} size={24} stroke={2.4} /></span>
          <span className="muted">Your account manager will reach out within 1 business day to discuss your needs.</span>
        </div>
      ) : (
        <div className="form-grid form-grid--2 por-req">
          <label className="field field--full">
            <span className="field__label">Role</span>
            <input className="input por-input-lg" list="por-role-options" value={role} onChange={e => setRole(e.target.value)} placeholder="e.g. Front desk assistant" autoFocus />
            <datalist id="por-role-options">{ROLE_OPTIONS.map(r => <option key={r} value={r} />)}</datalist>
          </label>
          <label className="field">
            <span className="field__label">How many</span>
            <input className="input por-input-lg" type="number" min={1} max={50} inputMode="numeric" value={headcount} onChange={e => setHeadcount(e.target.value)} placeholder="1" />
          </label>
          <label className="field">
            <span className="field__label">Hours per week</span>
            <input className="input por-input-lg" type="number" min={1} max={60} inputMode="numeric" value={hours} onChange={e => setHours(e.target.value)} placeholder="40" />
          </label>
          <label className="field">
            <span className="field__label">Start date</span>
            <input className="input por-input-lg" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Project</span>
            <select className="select por-input-lg" aria-label="Project" value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">New or not sure</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field field--full">
            <span className="field__label">Notes</span>
            <textarea className="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Languages, software, shift…" />
          </label>
          {error && <div className="banner banner--danger field--full" role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  )
}

export default function PortalTeam() {
  const { clientId } = usePortal()

  const [client,      setClient]      = useState<Client | null>(null)
  const [projects,    setProjects]    = useState<Project[]>([])
  const [employees,   setEmployees]   = useState<Employee[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState<Employee | null>(null)
  const [projFilter,  setProjFilter]  = useState<string>('all')
  const [showRequest, setShowRequest] = useState(false)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const c = await loadPortalClient(clientId)
      setClient(c)
      if (!c) { setLoading(false); return }
      const projs = await loadPortalProjects(clientId)
      setProjects(projs)
      const [emps, entries] = await Promise.all([loadPortalEmployees(clientId), loadPortalTimeEntries(projs.map(p => p.id))])
      setEmployees(emps)
      setTimeEntries(entries)
      setLoading(false)
    })()
  }, [clientId])

  if (loading) return <PortalSkeleton />

  const weekFrom = weekStartIso()
  const empProjects = (emp: Employee) => projects.filter(p => (p.employeeIds ?? []).includes(emp.id))
  const filtered = projFilter === 'all' ? employees : employees.filter(emp => empProjects(emp).some(p => p.id === projFilter))
  const monthHours = employees.reduce((s, emp) => s + sumHours(entriesFor(emp, timeEntries), undefined, monthKey()), 0)
  const activeCount = employees.filter(e => (e.status ?? '').toLowerCase() === 'active').length

  return (
    <div className="por-page">
      <p className="por-summary">
        {client?.company ? `${client.company} · ` : ''}{employees.length} team member{employees.length !== 1 ? 's' : ''}
        {activeCount > 0 && activeCount < employees.length ? ` · ${activeCount} active` : ''}
        {monthHours > 0 ? ` · ${hoursText(monthHours)} in ${monthLabel()}` : ''}
        {` · ${projects.length} project${projects.length !== 1 ? 's' : ''}`}
      </p>

      <div className="por-toolbar">
        {projects.length > 1 ? (
          <Chips value={projFilter} onChange={setProjFilter} options={[
            { value: 'all', label: 'All', count: employees.length },
            ...projects.map(p => ({ value: p.id, label: p.name, count: employees.filter(e => (p.employeeIds ?? []).includes(e.id)).length })),
          ]} />
        ) : <span />}
        <button type="button" className="btn btn--gold por-btn-lg" onClick={() => setShowRequest(true)}>Request more staff</button>
      </div>

      {filtered.length === 0 ? (
        <div className="card card-empty por-empty">
          <strong>No team members yet</strong>
          <span>Your assigned professionals will appear here once your projects are set up.</span>
        </div>
      ) : (
        <div className="por-grid por-grid--cards">
          {filtered.map(emp => {
            const projs = empProjects(emp)
            return (
              <button key={emp.id} type="button" className="card card--hover por-tcard" onClick={() => setSelected(emp)}>
                <span className="por-tcard__top">
                  <PersonAvatar emp={emp} size="lg" />
                  <span className="por-person__text">
                    <span className="por-tcard__name">{emp.name}</span>
                    <span className="por-tcard__role">{emp.role || 'Team member'}</span>
                  </span>
                </span>
                <span className="por-tcard__stats">
                  <span className="por-mini"><span className="por-mini__k">This week</span><span className="por-mini__v num">{hoursText(sumHours(entriesFor(emp, timeEntries), weekFrom))}</span></span>
                  <span className="por-mini"><span className="por-mini__k">Project</span><span className="por-mini__v">{projs.length === 0 ? '—' : projs.length === 1 ? projs[0].name : `${projs.length} projects`}</span></span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      <MemberModal emp={selected} entries={timeEntries} projects={projects} onClose={() => setSelected(null)} />
      <StaffRequestModal open={showRequest} clientId={clientId ?? ''} clientName={client?.name ?? ''} projects={projects} onClose={() => setShowRequest(false)} />
    </div>
  )
}
