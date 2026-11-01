import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PlacementRates from '../components/PlacementRates'
import HistoryList from '../components/HistoryList'
import { PAY_SCHEDULES } from '../utils/moneyRules'
import type { Client, Contract, ContractStatus, Employee, Expense, Invoice, Project, Tag, Task, TaskStatus, TimeEntry } from '../data/types'
import { loadSnapshot, saveProjects, loadTasks, saveTasks, loadExpenses, saveExpenses, loadTimeEntries } from '../services/storage'
import { loadTags, saveTags } from '../services/tagStorage'
import { uploadFile, deleteFile } from '../services/fileStorage'
import { usePermission, useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { TagBadge } from '../components/TagBadge'
import { Avatar, Banner, Card, Drawer, EmptyState, Field, KpiStrip, Menu, Modal, PageHeader, Pill, Skel, Tabs, toneFor, useIsMobile } from '../components/ui'
import { Ic, P } from '../components/Icon'
import ProjectFormFields, { formFromProject, projectFields, EMPTY_PROJECT_FORM, type ProjectFormState } from '../components/ops/ProjectForm'
import TaskBoard, { mentionsIn, type TaskDraft } from '../components/ops/TaskBoard'
import ProjectExpenses, { type ExpenseDraft } from '../components/ops/ProjectExpenses'
import { errText, hoursLabel, monthPrefix, monthShort, payShort, projectMonthHours, stageInfo, uid } from '../components/ops/opsUtils'
import { dateMed, usd } from '../utils/format'

type TabKey = 'rates' | 'overview' | 'tasks' | 'expenses' | 'invoices' | 'contracts' | 'history'
const TAB_KEYS: TabKey[] = ['rates', 'overview', 'tasks', 'expenses', 'invoices', 'contracts', 'history']
type Flash = { tone: 'success' | 'danger'; text: string } | null
const CONTRACT_TONE: Record<ContractStatus, 'neutral' | 'success' | 'partial' | 'danger'> = { draft: 'neutral', active: 'success', expired: 'partial', terminated: 'danger' }
const EMPTY_CONTRACT = { title: '', status: 'draft' as ContractStatus, startDate: '', endDate: '', value: '', notes: '' }

export default function ProjectProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { role } = useRole()
  const allowed = usePermission()
  const mobile = useIsMobile()
  const [params, setParams] = useSearchParams()

  const [loaded, setLoaded] = useState(false)
  const [projects, setProjectsState] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])

  useEffect(() => {
    void loadSnapshot().then(snap => {
      setProjectsState(snap.projects); setClients(snap.clients); setEmployees(snap.employees); setInvoices(snap.invoices); setLoaded(true)
    })
    void loadTasks().then(setAllTasks)
    void loadExpenses().then(setAllExpenses)
    void loadTags().then(setAllTags)
    void loadTimeEntries().then(setEntries).catch(() => setEntries([]))
  }, [id])

  const project = projects.find(p => p.id === id)
  const tabParam = params.get('tab') as TabKey | null
  const [tab, setTab] = useState<TabKey>(tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'rates')
  const [flash, setFlash] = useState<Flash>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<ProjectFormState>(EMPTY_PROJECT_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Contracts
  const [contractPanelOpen, setContractPanelOpen] = useState(false)
  const [contractEditId, setContractEditId] = useState<string | null>(null)
  const [contractForm, setContractForm] = useState(EMPTY_CONTRACT)
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [contractUploading, setContractUploading] = useState(false)
  const [contractError, setContractError] = useState<string | null>(null)
  const contractFileRef = useRef<HTMLInputElement>(null)

  // "Edit" on the Projects page opens this page in edit mode (?edit=1); ?tab=rates opens Team & rates
  useEffect(() => {
    if (!project) return
    const t = params.get('tab') as TabKey | null
    if (t && TAB_KEYS.includes(t)) setTab(t)
    if (params.get('edit') === '1') { setForm(formFromProject(project)); setEditing(true) }
    if (params.get('edit') || params.get('tab')) setParams({}, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  if (!loaded) {
    return <div className="page"><Skel w={120} /><Skel w="40%" h={30} /><Skel h={84} r={14} /><Skel h={260} r={14} /></div>
  }
  if (!project) {
    return (
      <div className="page">
        <button type="button" className="back-link" onClick={() => navigate('/projects')}><Ic d={P.chevL} size={14} /> Projects</button>
        <EmptyState action={<button type="button" className="btn" onClick={() => navigate('/projects')}>Back to Projects</button>}>Project not found.</EmptyState>
      </div>
    )
  }

  // project is guaranteed non-null here (early return above handles null case)
  const projectNN = project!
  const client = clients.find(c => c.id === projectNN.clientId) ?? null
  const projectInvoices = invoices.filter(inv => inv.projectId === projectNN.id || inv.projectName === projectNN.name)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const totalBilled = projectInvoices.reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  const billedMonth = projectInvoices.filter(inv => String(inv.date || '').startsWith(monthPrefix())).reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  const tasks = allTasks.filter(t => t.projectId === projectNN.id)
  const expenses = allExpenses.filter(e => e.projectId === projectNN.id)
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const assignedEmps = (projectNN.employeeIds ?? []).map(eid => employees.find(e => e.id === eid)).filter((e): e is Employee => !!e)
  const st = stageInfo(projectNN)
  const canRates = allowed('rates.manage')
  const canHistory = allowed('history.view')

  /** Optimistic update → await → roll back with a message */
  async function persistProject(updated: Project, ok?: string): Promise<boolean> {
    const prev = projects
    const next = projects.map(p => (p.id === updated.id ? updated : p))
    setProjectsState(next)
    try { await saveProjects(next); if (ok) setFlash({ tone: 'success', text: ok }); return true }
    catch (e) { setProjectsState(prev); setFlash({ tone: 'danger', text: `Could not save: ${errText(e)}` }); return false }
  }
  function openEdit() { setForm(formFromProject(projectNN)); setEditing(true) }
  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    const ok = await persistProject({ ...projectNN, ...projectFields(form) }, 'Project saved.')
    setSaving(false)
    if (ok) setEditing(false)
  }
  async function handleDelete() {
    setConfirmDelete(false)
    const prev = projects
    const next = projects.filter(p => p.id !== projectNN.id)
    setProjectsState(next)
    try { await saveProjects(next); navigate('/projects') }
    catch (e) { setProjectsState(prev); setFlash({ tone: 'danger', text: `Could not delete: ${errText(e)}` }) }
  }
  async function handleTagCreated(tag: Tag) {
    const prev = allTags
    const next = [...allTags, tag]
    setAllTags(next)
    try { await saveTags(next) } catch (e) { setAllTags(prev); setFlash({ tone: 'danger', text: `Could not save the tag: ${errText(e)}` }) }
  }

  // Tasks / expenses: the whole lists are kept so a save never treats other projects' rows as removed
  async function persistTasks(next: Task[]): Promise<boolean> {
    const prev = allTasks
    setAllTasks(next)
    try { await saveTasks(next); return true } catch (e) { setAllTasks(prev); setFlash({ tone: 'danger', text: `Could not save tasks: ${errText(e)}` }); return false }
  }
  function addTask(status: TaskStatus, d: TaskDraft) {
    const mentions = mentionsIn(d.description, employees.map(e => e.name))
    return persistTasks([...allTasks, { id: uid(), projectId: projectNN.id, title: d.title.trim(), description: d.description.trim() || undefined, mentions: mentions.length ? mentions : undefined, assigneeName: d.assigneeName || undefined, dueDate: d.dueDate || undefined, status, createdAt: Date.now() }])
  }
  async function persistExpenses(next: Expense[]): Promise<boolean> {
    const prev = allExpenses
    setAllExpenses(next)
    try { await saveExpenses(next); return true } catch (e) { setAllExpenses(prev); setFlash({ tone: 'danger', text: `Could not save expenses: ${errText(e)}` }); return false }
  }
  function addExpense(d: ExpenseDraft) {
    return persistExpenses([{ id: uid(), projectId: projectNN.id, description: d.description.trim(), amount: parseFloat(d.amount) || 0, date: d.date, category: d.category || undefined, recurring: d.recurring || undefined, createdAt: Date.now() }, ...allExpenses])
  }

  // Contracts
  function openAddContractPanel() { setContractEditId(null); setContractForm(EMPTY_CONTRACT); setContractFile(null); setContractError(null); setContractPanelOpen(true) }
  function openEditContractPanel(c: Contract) {
    setContractEditId(c.id)
    setContractForm({ title: c.title, status: c.status, startDate: c.startDate ?? '', endDate: c.endDate ?? '', value: c.value != null ? String(c.value) : '', notes: c.notes ?? '' })
    setContractFile(null); setContractError(null); setContractPanelOpen(true)
  }
  async function saveContract() {
    if (!contractForm.title.trim()) return
    setContractUploading(true); setContractError(null)
    try {
      let fileUrl: string | undefined, filePath: string | undefined, fileName: string | undefined
      if (contractFile) {
        const result = await uploadFile(contractFile, `contracts/projects/${projectNN.id}`)
        fileUrl = result.storageUrl; filePath = result.storagePath; fileName = contractFile.name
      }
      const fields = {
        title: contractForm.title.trim(), status: contractForm.status,
        startDate: contractForm.startDate || undefined, endDate: contractForm.endDate || undefined,
        value: contractForm.value ? Number(contractForm.value) : undefined, notes: contractForm.notes || undefined,
      }
      const existing: Contract[] = projectNN.contracts ?? []
      const updated: Contract[] = contractEditId
        ? existing.map(c => (c.id !== contractEditId ? c : { ...c, ...fields, ...(fileUrl ? { fileUrl, filePath, fileName } : {}) }))
        : [{ id: crypto.randomUUID(), ...fields, fileUrl, filePath, fileName, createdAt: Date.now() }, ...existing]
      if (await persistProject({ ...projectNN, contracts: updated }, contractEditId ? 'Contract saved.' : 'Contract added.')) setContractPanelOpen(false)
    } catch (e) {
      setContractError(errText(e))
    } finally { setContractUploading(false) }
  }
  async function deleteContract(contract: Contract) {
    if (!window.confirm(`Delete contract "${contract.title}"?`)) return
    if (contract.filePath) await deleteFile(contract.filePath).catch(() => { /* ignore */ })
    await persistProject({ ...projectNN, contracts: (projectNN.contracts ?? []).filter(c => c.id !== contract.id) }, 'Contract deleted.')
  }

  const payLabel = PAY_SCHEDULES.find(x => x.value === (projectNN.paySchedule ?? 'weekly'))?.label
  const sub = [client?.name ?? 'No client', `${assignedEmps.length} ${assignedEmps.length === 1 ? 'person' : 'people'}`, `pay ${payShort(projectNN).toLowerCase()}`].join(' · ')

  const teamList = (
    <Card title="Team" meta="Bill and pay rates need the “Bill & pay rates” permission" actions={<button type="button" className="btn btn--sm" onClick={openEdit}>Edit team</button>}>
      {assignedEmps.length === 0 ? <div className="card-empty">No one is assigned yet.</div> : assignedEmps.map(e => (
        <Link key={e.id} to={`/employees/${e.id}`} className="list-row ops-row-link">
          <Avatar name={e.name} size="sm" soft />
          <span className="list-row__main"><span className="list-row__title">{e.name}</span><span className="list-row__meta">{e.role || '—'}</span></span>
          <Ic d={P.chevR} size={14} />
        </Link>
      ))}
    </Card>
  )

  return (
    <div className="page">
      <button type="button" className="back-link" onClick={() => navigate('/projects')}><Ic d={P.chevL} size={14} /> Projects</button>
      <PageHeader keepTitleOnPhone title={<span className="ops-title-row">{projectNN.name}<Pill tone={st.tone}>{st.label}</Pill></span>} sub={sub} actions={<>
        <button type="button" className="btn" onClick={openEdit}>Edit project</button>
        {can.viewInvoices(role) && <button type="button" className="btn btn--primary" onClick={() => navigate(`/invoice?create=invoice&project=${encodeURIComponent(projectNN.id)}`)}>New invoice</button>}
        <Menu label="More project actions" items={[{ label: 'Delete project', danger: true, icon: P.trash, onClick: () => setConfirmDelete(true) }]} />
      </>} />

      {flash && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}

      <KpiStrip compact items={[
        { label: 'Total billed', value: usd(totalBilled), note: `${projectInvoices.length} invoice${projectInvoices.length === 1 ? '' : 's'}` },
        { label: 'Budget', value: projectNN.budget ? usd(projectNN.budget, { cents: false }) : '—', note: projectNN.budget ? `${Math.round((totalBilled / projectNN.budget) * 100)}% used` : 'No budget set', tone: projectNN.budget && totalBilled / projectNN.budget >= 0.9 ? 'danger' : undefined },
        { label: 'Expenses', value: usd(totalExpenses), note: `${expenses.length} logged`, onClick: () => setTab('expenses') },
        { label: `Hours, ${monthShort()}`, value: hoursLabel(projectMonthHours(projectNN, entries)), note: 'From the time log' },
        { label: 'Team size', value: String(assignedEmps.length), onClick: () => setTab('rates') },
      ]} />

      <Tabs label="Project sections" value={tab} onChange={setTab} tabs={[
        { value: 'rates', label: canRates ? 'Team & rates' : 'Team', count: assignedEmps.length },
        { value: 'overview', label: 'Overview' },
        { value: 'tasks', label: 'Tasks', count: tasks.filter(t => t.status !== 'done').length },
        { value: 'expenses', label: 'Expenses', count: expenses.length },
        { value: 'invoices', label: 'Invoices', count: projectInvoices.length },
        { value: 'contracts', label: 'Contracts', count: (projectNN.contracts ?? []).length },
        { value: 'history', label: 'History', hidden: !canHistory },
      ]} />

      {tab === 'rates' && (canRates
        ? <PlacementRates project={projectNN} members={assignedEmps} client={client} onAddPeople={openEdit} />
        : teamList)}

      {tab === 'overview' && (
        <div className="ops-overview">
          <Card title="Supervisor" pad>
            {projectNN.supervisorName || projectNN.supervisorEmail || projectNN.supervisorPhone ? (
              <div className="stack ops-sup">
                <span className="ops-sup__name">{projectNN.supervisorName || '—'}</span>
                <span className="ops-sup__contact">
                  {projectNN.supervisorEmail && <a href={`mailto:${projectNN.supervisorEmail}`} className="link">{projectNN.supervisorEmail}</a>}
                  {projectNN.supervisorEmail && projectNN.supervisorPhone && ' · '}
                  {projectNN.supervisorPhone && <a href={`tel:${projectNN.supervisorPhone.replace(/[^\d+]/g, '')}`} className="link">{projectNN.supervisorPhone}</a>}
                </span>
                <span className="field__hint">Shown to the team in My workspace → My client</span>
              </div>
            ) : <div className="muted">No supervisor yet. <button type="button" className="link" onClick={openEdit}>Add one</button></div>}
          </Card>
          <Card title="Instructions for the team" pad>
            {projectNN.employeeInstructions ? <p className="ops-prose">{projectNN.employeeInstructions}</p> : <div className="muted">Nothing yet. <button type="button" className="link" onClick={openEdit}>Write instructions</button></div>}
          </Card>
          <Card title="Details" pad>
            <div className="info-grid ops-info-2">
              <div className="info"><span className="info__label">Client</span><span className="info__value">{client ? <Link to={`/clients/${client.id}`} className="link">{client.name}</Link> : '—'}</span></div>
              <div className="info"><span className="info__label">Stage</span><span className="info__value">{st.label}</span></div>
              <div className="info"><span className="info__label">Pay schedule</span><span className="info__value">{payLabel}{projectNN.paySchedule === 'biweekly' && projectNN.payAnchor ? ` · from ${dateMed(projectNN.payAnchor)}` : ''}</span></div>
              <div className="info"><span className="info__label">Default bill rate</span><span className="info__value">{projectNN.rate ? `$${Number(projectNN.rate).toFixed(2)}/hr` : client?.defaultRate ? `$${Number(client.defaultRate).toFixed(2)}/hr (client)` : '—'}</span></div>
              <div className="info"><span className="info__label">Billing model</span><span className="info__value">{(projectNN.billingModel || 'hourly').replace(/^./, c => c.toUpperCase())}</span></div>
              <div className="info"><span className="info__label">Billed, {monthShort()}</span><span className="info__value">{usd(billedMonth)}</span></div>
              <div className="info"><span className="info__label">Started</span><span className="info__value">{dateMed(projectNN.startDate)}</span></div>
              <div className="info"><span className="info__label">Ends</span><span className="info__value">{dateMed(projectNN.endDate)}</span></div>
            </div>
          </Card>
          {(projectNN.description || projectNN.projectNeeds || projectNN.notes) && (
            <Card title="About this project" pad>
              <div className="stack">
                {projectNN.description && <div className="info"><span className="info__label">Description</span><p className="ops-prose">{projectNN.description}</p></div>}
                {projectNN.projectNeeds && <div className="info"><span className="info__label">Project needs</span><p className="ops-prose">{projectNN.projectNeeds}</p></div>}
                {projectNN.notes && <div className="info"><span className="info__label">Notes</span><p className="ops-prose">{projectNN.notes}</p></div>}
              </div>
            </Card>
          )}
          <Card title="Tags and links" pad>
            {(projectNN.tags ?? []).length === 0 && (projectNN.links ?? []).length === 0 ? <div className="muted">None yet. <button type="button" className="link" onClick={openEdit}>Add tags or links</button></div> : (
              <div className="ops-pcard__tags">
                {(projectNN.tags ?? []).map(label => <TagBadge key={label} label={label} color={allTags.find(t => t.label === label)?.color ?? '#3b82f6'} />)}
                {(projectNN.links ?? []).map((lk, i) => <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="ops-linkpill"><Ic d={P.link} size={12} />{lk.label}</a>)}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'tasks' && (
        <TaskBoard tasks={tasks} names={employees.map(e => e.name)} onAdd={addTask}
          onMove={(tid, s) => void persistTasks(allTasks.map(t => (t.id === tid ? { ...t, status: s } : t)))}
          onDelete={tid => void persistTasks(allTasks.filter(t => t.id !== tid))} />
      )}

      {tab === 'expenses' && (
        <ProjectExpenses expenses={expenses} budget={projectNN.budget} billed={totalBilled} onAdd={addExpense}
          onDelete={eid => void persistExpenses(allExpenses.filter(e => e.id !== eid))} />
      )}

      {tab === 'invoices' && (projectInvoices.length === 0 ? <EmptyState>No invoices for this project yet.</EmptyState> : mobile ? (
        <div className="mcards">
          {projectInvoices.map(inv => (
            <Link key={inv.id} to={`/invoice?open=${inv.id}`} className="mcard ops-row-link">
              <div className="mcard__top"><span className="mcard__title mono">{inv.number}</span><span className="num">{usd(Number(inv.subtotal) || 0)}</span></div>
              <div className="row row--between"><span className="mcard__meta">{dateMed(inv.date)}</span><Pill status={inv.status || 'draft'} /></div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="table-card">
          <table className="table ops-min-640">
            <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Status</th><th className="t-right">Amount</th></tr></thead>
            <tbody>
              {projectInvoices.map(inv => (
                <tr key={inv.id} className="is-clickable" onClick={() => navigate(`/invoice?open=${inv.id}`)}>
                  <td className="mono t-strong">{inv.number}</td>
                  <td className="muted">{dateMed(inv.date)}</td>
                  <td className="muted">{dateMed(inv.dueDate)}</td>
                  <td><Pill status={inv.status || 'draft'} /></td>
                  <td className="t-num">{usd(Number(inv.subtotal) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {tab === 'contracts' && (
        <Card title="Contracts" actions={<button type="button" className="btn btn--sm btn--primary" onClick={openAddContractPanel}>+ Add contract</button>}>
          {(projectNN.contracts ?? []).length === 0 ? <div className="card-empty">No contracts yet.</div> : (projectNN.contracts ?? []).map(c => (
            <div key={c.id} className="list-row">
              <span className="list-row__main">
                <span className="list-row__title">{c.title} <Pill tone={CONTRACT_TONE[c.status] ?? toneFor(c.status)}>{c.status.replace(/^./, x => x.toUpperCase())}</Pill></span>
                <span className="list-row__meta">
                  {[c.startDate || c.endDate ? `${dateMed(c.startDate)} → ${dateMed(c.endDate)}` : '', c.value != null ? usd(c.value, { cents: false }) : '', c.notes || ''].filter(Boolean).join(' · ') || '—'}
                </span>
              </span>
              {c.fileUrl && <a href={c.fileUrl} target="_blank" rel="noopener noreferrer" className="btn btn--xs"><Ic d={P.download} size={13} />{mobile ? 'File' : c.fileName || 'Download'}</a>}
              <button type="button" className="btn btn--xs" onClick={() => openEditContractPanel(c)}>Edit</button>
              <Menu label={`Actions for ${c.title}`} buttonClass="btn btn--xs btn--icon ops-xs-icon" items={[{ label: 'Delete contract', danger: true, onClick: () => void deleteContract(c) }]} />
            </div>
          ))}
        </Card>
      )}

      {tab === 'history' && canHistory && (
        <Card title="Change history" meta="Who changed this project and when" pad><HistoryList table="projects" recordId={projectNN.id} limit={50} /></Card>
      )}

      <Drawer open={editing} onClose={() => setEditing(false)} title="Edit project" sub={projectNN.name} size="wide"
        footer={<><span className="spacer" /><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button><button type="button" className="btn btn--primary" disabled={!form.name.trim() || saving} onClick={() => void handleSave()}>{saving ? 'Saving…' : 'Save changes'}</button></>}>
        <ProjectFormFields form={form} setForm={setForm} clients={clients} employees={employees} allTags={allTags} onTagCreated={t => void handleTagCreated(t)} />
      </Drawer>

      <Drawer open={contractPanelOpen} onClose={() => setContractPanelOpen(false)} title={contractEditId ? 'Edit contract' : 'Add contract'} size="narrow"
        footer={<><span className="spacer" /><button type="button" className="btn" onClick={() => setContractPanelOpen(false)}>Cancel</button><button type="button" className="btn btn--primary" onClick={() => void saveContract()} disabled={!contractForm.title.trim() || contractUploading}>{contractUploading ? 'Saving…' : contractEditId ? 'Save changes' : 'Add contract'}</button></>}>
        {contractError && <Banner tone="danger">{contractError}</Banner>}
        <div className="form-grid form-grid--2">
          <Field label="Title *" full><input className="input" aria-label="Contract title" value={contractForm.title} onChange={e => setContractForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Service Agreement 2026" autoFocus /></Field>
          <Field label="Status" full>
            <select className="select" aria-label="Contract status" value={contractForm.status} onChange={e => setContractForm(f => ({ ...f, status: e.target.value as ContractStatus }))}>
              <option value="draft">Draft</option><option value="active">Active</option><option value="expired">Expired</option><option value="terminated">Terminated</option>
            </select>
          </Field>
          <Field label="Start date"><input className="input" type="date" aria-label="Contract start" value={contractForm.startDate} onChange={e => setContractForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
          <Field label="End date"><input className="input" type="date" aria-label="Contract end" value={contractForm.endDate} onChange={e => setContractForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
          <Field label="Contract value (USD)" full><input className="input" type="number" aria-label="Contract value" value={contractForm.value} onChange={e => setContractForm(f => ({ ...f, value: e.target.value }))} placeholder="Optional" /></Field>
          <Field label="Notes" full><textarea className="textarea" rows={2} aria-label="Contract notes" value={contractForm.notes} onChange={e => setContractForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes about this contract…" /></Field>
          <Field label="File (.pdf, .doc, .docx)" full>
            <input ref={contractFileRef} type="file" accept=".pdf,.doc,.docx" className="sr-only" onChange={e => setContractFile(e.target.files?.[0] ?? null)} />
            <button type="button" className="dropzone" onClick={() => contractFileRef.current?.click()}>{contractFile ? contractFile.name : 'Choose a file'}</button>
          </Field>
        </div>
      </Drawer>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${projectNN.name}?`} sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="btn ops-btn-danger" onClick={() => void handleDelete()}>Delete</button></>} />
    </div>
  )
}
