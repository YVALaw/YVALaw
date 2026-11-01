import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import MissingRates, { findMissingRates, usePlacementRateRows } from '../components/MissingRates'
import type { Client, Employee, Expense, Invoice, Project, Tag, Task, TaskStatus, TimeEntry } from '../data/types'
import { loadSnapshot, saveProjects, loadTasks, saveTasks, loadExpenses, saveExpenses, loadTimeEntries } from '../services/storage'
import { loadTags, saveTags } from '../services/tagStorage'
import { rateClient, rateEmployee, rateProject } from '../services/rates'
import { localParts, num, resolveRates } from '../utils/moneyRules'
import { TagBadge } from '../components/TagBadge'
import { AvatarStack, Banner, Drawer, EmptyState, Menu, Modal, PageHeader, Pill, SearchInput, Segmented, Skel } from '../components/ui'
import ProjectFormFields, { EMPTY_PROJECT_FORM, projectFields, type ProjectFormState } from '../components/ops/ProjectForm'
import TaskBoard, { mentionsIn, type TaskDraft } from '../components/ops/TaskBoard'
import ProjectExpenses, { type ExpenseDraft } from '../components/ops/ProjectExpenses'
import { STAGES, errText, hoursLabel, matchesFilter, monthShort, payShort, projectMonthHours, stageInfo, stageOf, uid, type ProjectFilter, type ProjectStage } from '../components/ops/opsUtils'
import { usd } from '../utils/format'

type ViewMode = 'cards' | 'kanban'
type Flash = { tone: 'success' | 'danger'; text: string } | null

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [loaded, setLoaded] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [allExpenses, setAllExpenses] = useState<Expense[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const rates = usePlacementRateRows()

  useEffect(() => {
    void loadSnapshot().then(snap => {
      setProjects(snap.projects); setClients(snap.clients); setEmployees(snap.employees); setInvoices(snap.invoices); setLoaded(true)
    })
    void loadTasks().then(setAllTasks)
    void loadExpenses().then(setAllExpenses)
    void loadTags().then(setAllTags)
    void loadTimeEntries().then(setEntries).catch(() => setEntries([]))
  }, [])

  const [view, setView] = useState<ViewMode>('cards')
  const [filter, setFilter] = useState<ProjectFilter>('active')
  const [search, setSearch] = useState('')
  const [flash, setFlash] = useState<Flash>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<ProjectFormState>(EMPTY_PROJECT_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)
  const [taskProject, setTaskProject] = useState<Project | null>(null)
  const [expenseProject, setExpenseProject] = useState<Project | null>(null)
  const [dropStage, setDropStage] = useState<ProjectStage | null>(null)
  const dragId = useRef<string | null>(null)

  // Create menu deep link: /projects?create=1 opens New project
  useEffect(() => {
    if (params.get('create')) { openAdd(); setParams({}, { replace: true }) }
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Optimistic update → await the save → roll back with a message on failure */
  async function persist(next: Project[], ok?: string): Promise<boolean> {
    const prev = projects
    setProjects(next)
    try { await saveProjects(next); if (ok) setFlash({ tone: 'success', text: ok }); return true }
    catch (e) { setProjects(prev); setFlash({ tone: 'danger', text: `Could not save: ${errText(e)}` }); return false }
  }

  function openAdd() { setForm({ ...EMPTY_PROJECT_FORM }); setCreating(true) }
  async function saveNew() {
    if (!form.name.trim()) return
    setSaving(true)
    const created = { id: uid(), ...projectFields(form) } as Project
    const ok = await persist([...projects, created], `Project “${created.name}” created.`)
    setSaving(false)
    if (ok) setCreating(false)
  }
  async function doDelete(p: Project) {
    setConfirmDelete(null)
    await persist(projects.filter(x => x.id !== p.id), `Project “${p.name}” removed.`)
  }
  function moveStage(id: string, stage: ProjectStage) {
    const p = projects.find(x => x.id === id)
    if (!p || stageOf(p) === stage) return
    void persist(projects.map(x => (x.id === id ? { ...x, status: stage } : x)))
  }
  async function handleTagCreated(tag: Tag) {
    const prev = allTags
    const next = [...allTags, tag]
    setAllTags(next)
    try { await saveTags(next) } catch (e) { setAllTags(prev); setFlash({ tone: 'danger', text: `Could not save the tag: ${errText(e)}` }) }
  }

  // Tasks and expenses (whole-list saves; the safe save only deletes rows this page loaded)
  async function persistTasks(next: Task[]): Promise<boolean> {
    const prev = allTasks
    setAllTasks(next)
    try { await saveTasks(next); return true } catch (e) { setAllTasks(prev); setFlash({ tone: 'danger', text: `Could not save tasks: ${errText(e)}` }); return false }
  }
  function addTask(p: Project, status: TaskStatus, d: TaskDraft) {
    const mentions = mentionsIn(d.description)
    return persistTasks([...allTasks, { id: uid(), projectId: p.id, title: d.title.trim(), description: d.description.trim() || undefined, mentions: mentions.length ? mentions : undefined, assigneeName: d.assigneeName || undefined, dueDate: d.dueDate || undefined, status, createdAt: Date.now() }])
  }
  async function persistExpenses(next: Expense[]): Promise<boolean> {
    const prev = allExpenses
    setAllExpenses(next)
    try { await saveExpenses(next); return true } catch (e) { setAllExpenses(prev); setFlash({ tone: 'danger', text: `Could not save expenses: ${errText(e)}` }); return false }
  }
  function addExpense(p: Project, d: ExpenseDraft) {
    return persistExpenses([{ id: uid(), projectId: p.id, description: d.description.trim(), amount: parseFloat(d.amount) || 0, date: d.date, category: d.category || undefined, recurring: d.recurring || undefined, createdAt: Date.now() }, ...allExpenses])
  }

  const clientOf = (p: Project) => clients.find(c => c.id === p.clientId) ?? null
  const billedOf = (p: Project) => invoices.filter(inv => inv.projectId === p.id || inv.projectName === p.name).reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  const expensesOf = (p: Project) => allExpenses.filter(e => e.projectId === p.id)
  const membersOf = (p: Project) => (p.employeeIds ?? []).map(id => employees.find(e => e.id === id)).filter((e): e is Employee => !!e)
  const missing = rates ? findMissingRates(projects, employees, clients, rates) : []
  const day = localParts(Date.now()).date

  /** Bill rate shown on the card: resolved per person when rates are visible, else the project / client default */
  function billLabel(p: Project): string {
    const client = clientOf(p)
    const members = membersOf(p)
    if (rates && members.length) {
      const vals = members.map(e => resolveRates({ employee: rateEmployee(e), project: rateProject(p), client: client ? rateClient(client) : null, rates, day }).bill.rate).filter(v => v > 0)
      if (!vals.length) return '—'
      const lo = Math.min(...vals), hi = Math.max(...vals)
      return lo === hi ? `$${lo.toFixed(2)}` : `$${lo.toFixed(2)}–${hi.toFixed(2)}`
    }
    const r = num(p.rate) || num(client?.defaultRate)
    return r ? `$${r.toFixed(2)}` : '—'
  }
  function warnLine(p: Project): string {
    const m = missing.filter(x => x.project.id === p.id)
    if (!m.length) return ''
    if (m.length > 1) return `${m.length} people are missing a rate`
    const w = m[0].bill && m[0].pay ? 'bill + pay rate' : m[0].bill ? 'bill rate' : 'pay rate'
    return membersOf(p).length === 1 ? `Missing ${w}` : `${m[0].employee.name} has no ${w}`
  }

  const needle = search.trim().toLowerCase()
  const searched = projects.filter(p => !needle || p.name.toLowerCase().includes(needle) || (clientOf(p)?.name ?? '').toLowerCase().includes(needle))
  const shown = searched.filter(p => matchesFilter(p, filter))
  const activeProjects = projects.filter(p => matchesFilter(p, 'active'))
  const placements = activeProjects.reduce((s, p) => s + membersOf(p).length, 0)
  const clientCount = new Set(activeProjects.map(p => p.clientId).filter(Boolean)).size
  const sub = loaded ? `${placements} active placement${placements === 1 ? '' : 's'} across ${clientCount} client${clientCount === 1 ? '' : 's'}` : 'Loading projects…'
  const month = monthShort()

  const cardMenu = (p: Project) => (
    <Menu label={`Actions for ${p.name}`} buttonClass="btn btn--xs btn--icon btn--ghost ops-xs-icon" items={[
      { label: 'Open project', onClick: () => navigate(`/projects/${p.id}`) },
      { label: 'Edit', onClick: () => navigate(`/projects/${p.id}?edit=1`) },
      { label: 'Tasks', onClick: () => setTaskProject(p) },
      { label: 'Expenses', onClick: () => setExpenseProject(p) },
      'sep',
      { label: 'Remove project', danger: true, onClick: () => setConfirmDelete(p) },
    ]} />
  )

  function card(p: Project) {
    const st = stageInfo(p)
    const members = membersOf(p)
    const client = clientOf(p)
    const warn = warnLine(p)
    const billed = billedOf(p)
    const expTotal = expensesOf(p).reduce((s, e) => s + e.amount, 0)
    const budgetPct = p.budget && p.budget > 0 ? Math.min(100, Math.round((billed / p.budget) * 100)) : null
    const tc = allTasks.filter(t => t.projectId === p.id && t.status !== 'done').length
    const extra = [p.budget ? `Budget ${usd(p.budget, { cents: false })}${budgetPct !== null ? ` · ${budgetPct}% used` : ''}` : '', expTotal > 0 ? `Expenses ${usd(expTotal)}` : '', tc > 0 ? `${tc} open task${tc === 1 ? '' : 's'}` : ''].filter(Boolean)
    return (
      <article key={p.id} className="ops-pcard" role="link" tabIndex={0} aria-label={p.name}
        onClick={() => navigate(`/projects/${p.id}`)} onKeyDown={e => { if (e.key === 'Enter') navigate(`/projects/${p.id}`) }}>
        <div className="ops-pcard__top">
          <div className="ops-pcard__name">
            <span className="ops-pcard__title">{p.name}</span>
            <span className="ops-pcard__client">{client?.name ?? 'No client'}</span>
          </div>
          <div className="ops-pcard__right" onClick={e => e.stopPropagation()}>
            <Pill tone={st.tone}>{st.label}</Pill>
            {cardMenu(p)}
          </div>
        </div>
        <div className="ops-pcard__team">
          {members.length ? <AvatarStack names={members.map(m => m.name)} max={5} /> : null}
          <span className="ops-pcard__size">{members.length ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : 'No one assigned yet'}</span>
        </div>
        <div className="ops-pcard__stats">
          <div className="ops-stat"><span className="ops-stat__label">Bill rate</span><span className="ops-stat__value">{billLabel(p)}</span></div>
          <div className="ops-stat"><span className="ops-stat__label">Hours, {month}</span><span className="ops-stat__value">{hoursLabel(projectMonthHours(p, entries))}</span></div>
          <div className="ops-stat"><span className="ops-stat__label">Pay</span><span className="ops-stat__value">{payShort(p)}</span></div>
        </div>
        {extra.length > 0 && <div className={`ops-pcard__extra${budgetPct !== null && budgetPct >= 90 ? ' t-danger' : ''}`}>{extra.join(' · ')}</div>}
        {((p.tags ?? []).length > 0 || (p.links ?? []).length > 0) && (
          <div className="ops-pcard__tags" onClick={e => e.stopPropagation()}>
            {(p.tags ?? []).map(label => <TagBadge key={label} label={label} color={allTags.find(t => t.label === label)?.color ?? '#3b82f6'} />)}
            {(p.links ?? []).map((lk, i) => <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="ops-linkpill">{lk.label}</a>)}
          </div>
        )}
        {warn && <span className="ops-pcard__warn">{warn}</span>}
      </article>
    )
  }

  return (
    <div className="page">
      <PageHeader title="Projects" sub={sub} actions={<>
        <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" label="Search projects" />
        {view === 'cards' && <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'all', label: 'All' }]} />}
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'cards', label: 'Cards' }, { value: 'kanban', label: 'Pipeline' }]} />
        <button type="button" className="btn btn--primary" onClick={openAdd}>+ New project</button>
      </>} />

      {flash && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}
      <MissingRates projects={projects} employees={employees} clients={clients} rates={rates} />

      {!loaded ? (
        <div className="ops-pgrid">{[0, 1, 2, 3].map(i => <div key={i} className="ops-pcard ops-pcard--skel"><Skel w="60%" h={16} /><Skel w="40%" /><Skel h={28} /><Skel h={36} /></div>)}</div>
      ) : view === 'cards' ? (
        shown.length === 0
          ? <EmptyState action={!needle && filter !== 'all' ? undefined : <button type="button" className="btn btn--primary" onClick={openAdd}>+ New project</button>}>
              {needle ? 'No projects match your search.' : projects.length === 0 ? 'No projects yet. Add your first.' : filter === 'paused' ? 'No paused projects.' : 'No active projects. Switch to All to see completed ones.'}
            </EmptyState>
          : <div className="ops-pgrid">{shown.map(card)}</div>
      ) : (
        <div className="kanban ops-kanban">
          {STAGES.map(({ key, label }) => {
            const col = searched.filter(p => stageOf(p) === key)
            return (
              <div key={key} className={`kanban__col${dropStage === key ? ' kanban__col--drop' : ''}`} aria-label={label}
                onDragOver={e => { e.preventDefault(); setDropStage(key) }} onDragLeave={() => setDropStage(s => (s === key ? null : s))}
                onDrop={() => { setDropStage(null); if (dragId.current) { moveStage(dragId.current, key); dragId.current = null } }}>
                <div className="kanban__head"><span>{label}</span><span className="kanban__count">{col.length}</span></div>
                {col.map(p => (
                  <div key={p.id} className="kanban__card ops-kcard" draggable role="link" tabIndex={0} aria-label={p.name}
                    onDragStart={() => { dragId.current = p.id }} onClick={() => navigate(`/projects/${p.id}`)} onKeyDown={e => { if (e.key === 'Enter') navigate(`/projects/${p.id}`) }}>
                    <div className="ops-kcard__top"><span className="ops-kcard__name">{p.name}</span><span onClick={e => e.stopPropagation()}>{cardMenu(p)}</span></div>
                    <span className="ops-kcard__meta">{clientOf(p)?.name ?? 'No client'} · {billLabel(p)}/hr</span>
                    {membersOf(p).length > 0 && <AvatarStack names={membersOf(p).map(m => m.name)} max={4} />}
                    {(p.tags ?? []).length > 0 && <div className="ops-pcard__tags">{(p.tags ?? []).map(t => <TagBadge key={t} label={t} color={allTags.find(x => x.label === t)?.color ?? '#3b82f6'} />)}</div>}
                    {(p.links ?? []).length > 0 && <div className="ops-pcard__tags" onClick={e => e.stopPropagation()}>{(p.links ?? []).map((lk, i) => <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="ops-linkpill">{lk.label}</a>)}</div>}
                    {warnLine(p) && <span className="ops-pcard__warn">{warnLine(p)}</span>}
                  </div>
                ))}
                {col.length === 0 && <div className="kanban__empty">Drop here</div>}
              </div>
            )
          })}
        </div>
      )}

      <Drawer open={creating} onClose={() => setCreating(false)} title="New project" sub="Rates per person are set on the project page after you add the team." size="wide"
        footer={<><span className="spacer" /><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button><button type="button" className="btn btn--primary" disabled={!form.name.trim() || saving} onClick={() => void saveNew()}>{saving ? 'Saving…' : 'Create project'}</button></>}>
        <ProjectFormFields form={form} setForm={setForm} clients={clients} employees={employees} allTags={allTags} onTagCreated={t => void handleTagCreated(t)} />
      </Drawer>

      <Modal open={!!taskProject} onClose={() => setTaskProject(null)} title={`Tasks — ${taskProject?.name ?? ''}`} size="xl">
        {taskProject && <TaskBoard tasks={allTasks.filter(t => t.projectId === taskProject.id)} names={employees.map(e => e.name)}
          onAdd={(s, d) => addTask(taskProject, s, d)}
          onMove={(id, s) => void persistTasks(allTasks.map(t => (t.id === id ? { ...t, status: s } : t)))}
          onDelete={id => void persistTasks(allTasks.filter(t => t.id !== id))} />}
      </Modal>

      <Modal open={!!expenseProject} onClose={() => setExpenseProject(null)} title={`Expenses — ${expenseProject?.name ?? ''}`} size="wide">
        {expenseProject && <ProjectExpenses expenses={expensesOf(expenseProject)} budget={expenseProject.budget} billed={billedOf(expenseProject)}
          onAdd={d => addExpense(expenseProject, d)} onDelete={id => void persistExpenses(allExpenses.filter(e => e.id !== id))} />}
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={`Remove ${confirmDelete?.name ?? 'project'}?`} sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button><button type="button" className="btn ops-btn-danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Remove</button></>} />
    </div>
  )
}
