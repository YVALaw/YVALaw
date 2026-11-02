import { useEffect, useMemo, useRef, useState } from 'react'
import { useStickyView } from '../lib/stickyView'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { uploadFile } from '../services/fileStorage'
import type { Attachment, Client, Employee, Invoice, Project } from '../data/types'
import { loadSnapshot, saveEmployees, saveProjects, loadEmployeeCounter, saveEmployeeCounter } from '../services/storage'
import { ProjectPicker, projectIdsOf, withEmployeeOn } from '../components/people/ProjectAssign'
import { formatMoney } from '../utils/money'
import { usePermission, useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { Ic, P } from '../components/Icon'
import { Banner, Drawer, EmptyState, Modal, Menu, PageHeader, Pill, SearchInput, Segmented, Skel, useIsMobile } from '../components/ui'
import EmployeeStatements from '../components/people/EmployeeStatements'
import { EMPTY_EMPLOYEE_FORM, EmployeeFields, STATUS_OPTIONS, employeeToForm, formToEmployee, type EmployeeFormData } from '../components/people/EmployeeForm'
import { AttachmentList } from '../components/people/attachments'
import { PersonAvatar, employeeStatusTone, payScheduleOf, placementOf, projectsOf, upcomingAnniversary } from '../components/people/common'
import { TIME_STATUS, loadTimeActivity, timeStatusOf } from '../components/people/teamStatus'

function uid() { return crypto.randomUUID() }

async function generateEmployeeNumber(): Promise<string> {
  const year = String(new Date().getFullYear()).slice(-2)
  const counter = await loadEmployeeCounter()
  void saveEmployeeCounter(counter + 1)
  return `YVA${year}${String(counter).padStart(3, '0')}`
}

type Team = 'all' | 'client' | 'yva'
type View = 'table' | 'projects' | 'capacity'
const isYva = (e: Employee) => e.worksFor === 'yva'

function TimeDot({ e, activity }: { e: Employee; activity: Awaited<ReturnType<typeof loadTimeActivity>> | null }) {
  const s = TIME_STATUS[timeStatusOf(e, activity)]
  return <span className="ppl-time"><span className={`ppl-time__dot ppl-time__dot--${s.tone}${s.live ? ' ppl-time__dot--live' : ''}`} />{s.label}</span>
}

export default function EmployeesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { role } = useRole()
  const allowed = usePermission()
  const mobile = useIsMobile()
  const showPayRates = can.viewPayRates(role)
  const canSchedule = allowed('rates.manage')
  const canAssign = can.viewClients(role)   // sees projects → may put people on them (same as Project → Edit → Team)

  const [loaded, setLoaded] = useState(false)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof loadTimeActivity>> | null>(null)
  useEffect(() => {
    loadSnapshot().then(snap => {
      setEmployees(snap.employees); setInvoices(snap.invoices); setProjects(snap.projects); setClients(snap.clients); setLoaded(true)
    }).catch(e => { setError(`Could not load the team: ${(e as Error).message}`); setLoaded(true) })
    void loadTimeActivity().then(setActivity).catch(() => setActivity(null))
  }, [])

  const [team, setTeam] = useState<Team>('all')
  const [view, setView] = useStickyView<View>('team', 'projects', ['projects', 'table', 'capacity'])   // by project unless changed
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [modal, setModal] = useState<null | 'add' | 'edit'>(null)
  const [form, setForm] = useState<EmployeeFormData>(EMPTY_EMPLOYEE_FORM)
  const [editId, setEditId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [projectIds, setProjectIds] = useState<string[]>([])
  const [statementsFor, setStatementsFor] = useState<Employee | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Employee | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Create menu deep link: /employees?create=1
  useEffect(() => {
    if (params.get('create')) { openAdd(); setParams({}, { replace: true }) }
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next: Employee[], ok: string) {
    const before = employees
    setEmployees(next); setError(null)
    try { await saveEmployees(next); setNotice(ok); return true }
    catch (e) { setEmployees(before); setError(`Could not save: ${(e as Error).message}`); return false }
  }

  function openAdd() { setForm({ ...EMPTY_EMPLOYEE_FORM }); setAttachments([]); setProjectIds([]); setEditId(null); setModal('add') }
  function openEdit(e: Employee) { setForm(employeeToForm(e)); setAttachments(e.attachments || []); setProjectIds(projectIdsOf(projects, e.id)); setEditId(e.id); setModal('edit') }

  /** Put the person on exactly `ids` (only projects whose team changes are written) */
  async function saveAssignments(employeeId: string, ids: string[]): Promise<boolean> {
    const next = withEmployeeOn(projects, employeeId, ids)
    if (next.every((p, i) => p === projects[i])) return true
    const before = projects
    setProjects(next)
    try { await saveProjects(next); return true }
    catch (e) { setProjects(before); setError(`Saved the employee, but not the projects: ${(e as Error).message}`); return false }
  }

  function handleFileUpload(file: File) {
    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) { alert('File too large (max 5 MB). For videos, paste a link in Resume URL instead.'); return }
    // Uploaded to Storage; the record keeps only the link (files inside records slow every list)
    void uploadFile(file, 'employees/uploads').then(({ storageUrl, storagePath }) => {
      const att: Attachment = { id: uid(), name: file.name, mimeType: file.type, size: file.size, dataUrl: '', storageUrl, storagePath, uploadedAt: Date.now() }
      setAttachments(prev => [...prev, att])
    }).catch(e => alert(`Could not upload ${file.name}: ${(e as Error).message}`))
  }

  async function saveForm() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    const payload = formToEmployee(form, { schedule: canSchedule })
    let ok = false
    if (modal === 'add') {
      const empNum = await generateEmployeeNumber()
      const id = uid()
      ok = await persist([...employees, { ...payload, id, employeeNumber: empNum, attachments }], `${form.name.trim()} added as ${empNum}.`)
      if (ok && canAssign) ok = await saveAssignments(id, projectIds)
    } else if (editId) {
      ok = await persist(employees.map(e => e.id === editId ? { ...e, ...payload, attachments } : e), 'Changes saved.')
      if (ok && canAssign) ok = await saveAssignments(editId, projectIds)
    }
    setSaving(false)
    if (ok) setModal(null)
  }

  async function doDelete(emp: Employee) {
    setConfirmDelete(null)
    await persist(employees.filter(e => e.id !== emp.id), `${emp.name} removed.`)
  }

  const counts = useMemo(() => ({ all: employees.length, client: employees.filter(e => !isYva(e)).length, yva: employees.filter(isYva).length }), [employees])
  const filtered = employees.filter(e => {
    if (team === 'client' && isYva(e)) return false
    if (team === 'yva' && !isYva(e)) return false
    const matchSearch = `${e.name} ${e.email ?? ''} ${e.role ?? ''} ${e.employeeNumber ?? ''}`.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !filterStatus || (e.status || 'Active') === filterStatus
    return matchSearch && matchStatus
  }).sort((a, b) => a.name.localeCompare(b.name))

  const rowMenu = (e: Employee) => (
    <Menu label={`More actions for ${e.name}`} buttonClass="btn btn--icon btn--sm btn--ghost" items={[
      { label: 'Open profile', icon: P.user, onClick: () => navigate('/employees/' + e.id) },
      { label: 'Edit', icon: P.edit, onClick: () => openEdit(e) },
      { label: 'Statements', icon: P.file, onClick: () => setStatementsFor(e), hidden: !showPayRates },
      'sep',
      { label: 'Remove', icon: P.trash, danger: true, onClick: () => setConfirmDelete(e) },
    ]} />
  )

  // Work anniversary within 30 days (needs a hire date): small gold marker, full text on hover
  const annivMark = (e: Employee) => {
    const a = upcomingAnniversary(e)
    return a ? <span className="pill pill--gold ppl-anniv-mark" title={a.label} aria-label={a.label}>{a.years} yr · {a.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span> : null
  }

  const invoiceCount = (e: Employee) => invoices.filter(inv => (inv.items || []).some(it => it.employeeName?.toLowerCase() === e.name.toLowerCase())).length
  const payCell = (e: Employee) => {
    const s = payScheduleOf(e, projects)
    return <>{s.label}{showPayRates && e.payRate ? <span className="t-sub">${e.payRate}/hr</span> : null}</>
  }

  /* ── Views ───────────────────────────────────────────────────────── */
  const tableView = mobile ? (
    <div className="mcards">
      {filtered.map(e => (
        <button type="button" key={e.id} className="ppl-mrow" onClick={() => navigate('/employees/' + e.id)}>
          <PersonAvatar name={e.name} photo={e.photoUrl} size="lg" />
          <span className="ppl-mrow__main">
            <span className="ppl-mrow__title">{e.name}{annivMark(e)}</span>
            <span className="ppl-mrow__meta">{placementOf(e, projects, clients)}</span>
          </span>
          <span className={`ppl-time__dot ppl-time__dot--${TIME_STATUS[timeStatusOf(e, activity)].tone}${TIME_STATUS[timeStatusOf(e, activity)].live ? ' ppl-time__dot--live' : ''}`} aria-label={TIME_STATUS[timeStatusOf(e, activity)].label} />
        </button>
      ))}
    </div>
  ) : (
    <div className="table-card">
      <table className="table ppl-team-table">
        <thead><tr><th>Person</th><th>Placement</th><th>Works for</th><th>YVA Time</th><th>Pay</th><th>Since</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {filtered.map(e => (
            <tr key={e.id} className="is-clickable" onClick={() => navigate('/employees/' + e.id)}>
              <td>
                <div className="ppl-person">
                  <PersonAvatar name={e.name} photo={e.photoUrl} />
                  <div className="ppl-person__text">
                    <span className="ppl-person__name">{e.name}{(e.status || 'Active') !== 'Active' && <Pill tone={employeeStatusTone(e.status)}>{e.status}</Pill>}</span>
                    <span className="ppl-person__sub">{e.role || e.email || 'No role set'}{e.employeeNumber ? <> · <span className="mono">{e.employeeNumber}</span></> : null}</span>
                  </div>
                </div>
              </td>
              <td className="ppl-text-2">{placementOf(e, projects, clients)}</td>
              <td><Pill tone={isYva(e) ? 'gold' : 'info'}>{isYva(e) ? 'YVA team' : 'Client'}</Pill></td>
              <td><TimeDot e={e} activity={activity} /></td>
              <td className="muted">{payCell(e)}</td>
              <td className="muted"><span className="ppl-since">{e.startYear || '—'}{annivMark(e)}</span></td>
              <td className="t-actions" onClick={ev => ev.stopPropagation()}>{rowMenu(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const groupedProjects = projects
    .map(project => ({ project, people: filtered.filter(e => (project.employeeIds || []).includes(e.id)) }))
    .filter(g => g.people.length > 0)
    .sort((a, b) => a.project.name.localeCompare(b.project.name))
  const unassigned = filtered.filter(e => !projects.some(p => (p.employeeIds || []).includes(e.id)))
  const laneCard = (key: string, title: string, sub: string, people: Employee[], status?: string) => (
    <section key={key} className="card ppl-lane">
      <div className="card__head">
        <div><h2 className="card__title">{title}</h2><span className="card__meta">{sub}</span></div>
        {status && <Pill status={status} />}
      </div>
      {people.map(e => {
        const n = invoiceCount(e)
        return (
          <button type="button" key={`${key}-${e.id}`} className="ppl-lane__row" onClick={() => navigate('/employees/' + e.id)}>
            <PersonAvatar name={e.name} photo={e.photoUrl} size="sm" />
            <span className="ppl-lane__main">
              <span className="ppl-lane__name">{e.name}</span>
              <span className="ppl-lane__meta">{e.employeeNumber ? `${e.employeeNumber} · ` : ''}{e.role || e.email || 'No email'}</span>
              <span className="ppl-lane__chips">
                {showPayRates && e.payRate ? <span className="tag-mono">${e.payRate}/hr</span> : null}
                {e.timezone && <span className="ppl-chip">{e.timezone}</span>}
                {n > 0 && <span className="ppl-chip">{n} invoices</span>}
              </span>
            </span>
            <Pill tone={employeeStatusTone(e.status)}>{e.status || 'Active'}</Pill>
          </button>
        )
      })}
    </section>
  )
  const boardView = (
    <div className="ppl-board">
      {groupedProjects.map(({ project, people }) => laneCard(project.id, project.name, `${people.length} employee${people.length !== 1 ? 's' : ''}`, people, project.status || 'Active'))}
      {unassigned.length > 0 && laneCard('unassigned', 'Unassigned', `${unassigned.length} employee${unassigned.length !== 1 ? 's' : ''}`, unassigned)}
    </div>
  )

  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  const capacityRows = filtered.filter(e => (e.status || 'Active').toLowerCase() === 'active').map(e => {
    const empProjects = projectsOf(e, projects).filter(p => (p.status || '').toLowerCase() === 'active')
    const monthInvs = invoices.filter(inv => {
      const d = inv.date || inv.billingEnd || ''
      return d >= monthStart && d <= monthEnd && (inv.items || []).some(it => it.employeeName?.toLowerCase() === e.name.toLowerCase())
    })
    const monthHours = monthInvs.reduce((s, inv) => s + (inv.items || []).filter(it => it.employeeName?.toLowerCase() === e.name.toLowerCase()).reduce((h, it) => h + (Number(it.hoursTotal) || 0), 0), 0)
    return { e, empProjects, monthHours, payRate: Number(e.payRate) || 0 }
  })
  const capacityView = (
    <div className="table-card">
      <div className="card__head"><h2 className="card__title">Team capacity — {now.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h2><span className="card__meta">Active people · hours on this month's invoices</span></div>
      {mobile ? (
        <div className="ppl-cap-cards">
          {capacityRows.map(({ e, empProjects, monthHours, payRate }) => (
            <div key={e.id} className="list-row">
              <PersonAvatar name={e.name} size="sm" />
              <div className="list-row__main"><span className="list-row__title">{e.name}</span><span className="list-row__meta">{empProjects.map(p => p.name).join(', ') || 'No active project'}</span></div>
              <div className="ppl-cap-num"><span className="num">{monthHours > 0 ? `${monthHours.toFixed(1)}h` : '—'}</span>{showPayRates && <span className="muted num">{monthHours > 0 && payRate > 0 ? formatMoney(monthHours * payRate) : ''}</span>}</div>
            </div>
          ))}
        </div>
      ) : (
        <table className="table">
          <thead><tr><th>Employee</th><th>Role</th><th>Assigned projects</th><th className="t-right">Hrs this month</th>{showPayRates && <th className="t-right">Earned (USD)</th>}</tr></thead>
          <tbody>
            {capacityRows.map(({ e, empProjects, monthHours, payRate }) => (
              <tr key={e.id} className="is-clickable" onClick={() => navigate('/employees/' + e.id)}>
                <td className="t-strong">{e.name}</td>
                <td className="muted">{e.role || '—'}</td>
                <td>{empProjects.length === 0 ? <span className="muted">None</span> : <span className="ppl-chips">{empProjects.map(p => <span key={p.id} className="ppl-chip">{p.name}</span>)}</span>}</td>
                <td className="t-num t-strong">{monthHours > 0 ? `${monthHours.toFixed(1)}h` : '—'}</td>
                {showPayRates && <td className="t-num t-strong">{monthHours > 0 && payRate > 0 ? formatMoney(monthHours * payRate) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {capacityRows.length === 0 && <div className="card-empty">No active people match.</div>}
    </div>
  )

  return (
    <div className="page">
      <PageHeader
        title="Team"
        sub={`${counts.all} ${counts.all === 1 ? 'person' : 'people'} · ${counts.client} on client projects · ${counts.yva} on the YVA team`}
        actions={<>
          <Segmented label="Team" value={team} onChange={setTeam} options={[{ value: 'all', label: 'All' }, { value: 'client', label: 'Client team' }, { value: 'yva', label: 'YVA team' }]} />
          <button type="button" className="btn btn--primary" onClick={openAdd}><Ic d={P.plus} size={15} />Add employee</button>
        </>}
      />
      {notice && <Banner onClose={() => setNotice(null)}>{notice}</Banner>}
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}

      <div className="ppl-filterbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Search team…" label="Search team" />
        <select className="select select--sm ppl-filterbar__status" aria-label="Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="spacer" />
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'projects', label: 'By project' }, { value: 'table', label: 'List' }, { value: 'capacity', label: 'Capacity' }]} />
      </div>

      {!loaded ? (
        <div className="table-card ppl-skel">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="ppl-skel__row"><Skel w={36} h={36} r={18} /><div className="stack"><Skel w={160} h={12} /><Skel w={110} h={10} /></div><Skel w={140} h={12} /><Skel w={70} h={12} /></div>)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState action={!search && !filterStatus && team === 'all' ? <button type="button" className="btn btn--primary" onClick={openAdd}>Add employee</button> : undefined}>
          {search || filterStatus || team !== 'all' ? 'No one matches these filters.' : 'No team members yet. Add your first.'}
        </EmptyState>
      ) : view === 'projects' ? boardView : view === 'capacity' ? capacityView : tableView}

      {/* Add / Edit */}
      <Drawer open={modal !== null} onClose={() => setModal(null)} size="wide"
        title={modal === 'add' ? 'Add employee' : 'Edit employee'}
        sub={modal === 'add' ? 'The employee number is assigned automatically on save (e.g. YVA26001).' : form.name}
        footer={<>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => void saveForm()} disabled={!form.name.trim() || saving}>{saving ? 'Saving…' : modal === 'add' ? 'Add employee' : 'Save changes'}</button>
        </>}>
        <EmployeeFields form={form} setForm={setForm} pay={showPayRates} schedule={canSchedule} />
        {canAssign && (
          <section className="form-section">
            <h3 className="form-section__title">Projects</h3>
            <p className="form-section__hint">The client projects this person works on. Rates per project are set on the project page (Team &amp; rates).</p>
            <ProjectPicker ids={projectIds} onChange={setProjectIds} projects={projects} clients={clients} />
          </section>
        )}
        <section className="form-section">
          <div className="row row--between">
            <h3 className="form-section__title">Files &amp; documents {attachments.length > 0 && `(${attachments.length})`}</h3>
            <button type="button" className="btn btn--sm" onClick={() => fileInputRef.current?.click()}><Ic d={P.upload} size={14} />Upload</button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
          </div>
          <AttachmentList compact items={attachments} onRemove={id => setAttachments(prev => prev.filter(a => a.id !== id))} empty="No files. Accepts images, PDFs, audio (max 5 MB each). For videos use a URL link." />
        </section>
      </Drawer>

      {/* Statements */}
      <Drawer open={!!statementsFor} onClose={() => setStatementsFor(null)} size="wide"
        title={`${statementsFor?.name ?? ''} — Statements`}
        sub={statementsFor ? `${statementsFor.employeeNumber ? `${statementsFor.employeeNumber} · ` : ''}${statementsFor.payRate ? `$${statementsFor.payRate}/hr` : 'No pay rate set'}` : undefined}>
        {statementsFor && <EmployeeStatements emp={statementsFor} invoices={invoices} onInvoicesChange={setInvoices} />}
      </Drawer>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={`Remove ${confirmDelete?.name ?? 'team member'}?`} sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button><button type="button" className="btn btn--danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Remove</button></>} />
    </div>
  )
}
