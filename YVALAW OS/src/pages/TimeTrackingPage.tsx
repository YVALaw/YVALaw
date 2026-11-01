import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Client, Employee, Project, TimeEntry } from '../data/types'
import { loadTimeEntries, upsertTimeEntry, deleteTimeEntry, loadEmployees, loadProjects, loadClients } from '../services/storage'
import { loadManualRequests, loadTrackerBlocks } from '../services/trackerStorage'
import { supabase } from '../lib/supabase'
import { useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import LiveBoard from './time/LiveBoard'
import ScreenshotDay from './time/ScreenshotDay'
import ApproveTime from './time/ApproveTime'
import ScheduleReport from './time/ScheduleReport'
import { Banner, Checkbox, Drawer, EmptyState, Field, KpiStrip, Menu, Modal, PageHeader, Pill, Segmented, Skel, Tabs, useIsMobile } from '../components/ui'
import { dateMed, hmClock } from '../utils/format'

function uid() { return crypto.randomUUID() }
function getToday() { return new Date().toISOString().slice(0, 10) }

function fmtHours(h: number): string {
  const total = Math.round(h * 60)
  const hrs = Math.floor(total / 60)
  const min = total % 60
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`
}
const clockH = (h: number) => hmClock(h * 3600)

type BillableFilter = 'all' | 'billable' | 'unbillable'
const TABS = ['live', 'approve', 'schedule', 'screens', 'log'] as const
type Tab = typeof TABS[number]
const SUB: Record<Tab, string> = {
  live: 'Live from the YVA Time desktop app · refreshes every minute',
  approve: 'Approve YVA Time hours and missing-time requests',
  schedule: 'Shift vs. when people actually started and stopped (YVA Time)',
  screens: 'Client-team screenshots, one per 10-minute block · kept 60 days · never shown to clients',
  log: 'Every time entry. YVA Time rows are read-only.',
}

interface FormState {
  date: string
  employeeId: string
  employeeName: string
  projectId: string
  projectName: string
  clientName: string
  hours: string
  description: string
  billable: boolean
}

function startOfToday(): number { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
function mondayOf(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime() }

export default function TimeTrackingPage() {
  const mobile = useIsMobile()
  const [entries,   setEntries]   = useState<TimeEntry[]>([])
  const [loaded,    setLoaded]    = useState(false)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [clients,   setClients]   = useState<Client[]>([])

  // The person whose manual entries these are
  const [linkedEmployee,  setLinkedEmployee]  = useState<Employee | null>(null)
  const [authDisplayName, setAuthDisplayName] = useState('')   // fallback for unlinked users

  // Filters
  const [filterFrom,     setFilterFrom]     = useState('')
  const [filterTo,       setFilterTo]       = useState('')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterProject,  setFilterProject]  = useState('')
  const [filterBillable, setFilterBillable] = useState<BillableFilter>('all')

  // Panel (manual log)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form,      setForm]      = useState<FormState>(blankForm(null, ''))
  const [saving,    setSaving]    = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [flash,     setFlash]     = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<TimeEntry | null>(null)

  // YVA Time views
  const { role } = useRole()
  const canTracker = can.viewTracker(role)
  const canApprove = can.approveTime(role)
  const canShots = can.viewScreenshots(role)
  // ?tab=screens&employee=ID&day=YYYY-MM-DD opens a person's screenshots (links from profiles / Live)
  const [params, setParams] = useSearchParams()
  const tabFromUrl = (): Tab | null => (TABS as readonly string[]).includes(params.get('tab') ?? '') ? params.get('tab') as Tab : null
  const [tab, setTabState] = useState<Tab>(() => tabFromUrl() ?? (canTracker ? 'live' : 'log'))
  const picked = useRef(!!tabFromUrl())
  const setTab = (t: Tab) => { picked.current = true; setTabState(t) }
  useEffect(() => { const t = tabFromUrl(); if (t) { picked.current = true; setTabState(t) } }, [params])   // eslint-disable-line react-hooks/exhaustive-deps
  // The role can arrive after the first render: tracker roles land on Live unless they picked a tab
  useEffect(() => { if (!picked.current) setTabState(canTracker ? 'live' : 'log') }, [canTracker])

  // Approve tab badge: people with finished days waiting this week + missing-time requests
  const [approveCount, setApproveCount] = useState<number | null>(null)
  const loadApproveCount = useCallback(async () => {
    if (!canApprove) { setApproveCount(null); return }
    const [b, r] = await Promise.all([loadTrackerBlocks(mondayOf(Date.now()), startOfToday()), loadManualRequests('pending')])
    setApproveCount(new Set(b.filter(x => x.status === 'tracked').map(x => x.employeeId)).size + r.length)
  }, [canApprove])
  useEffect(() => { void loadApproveCount() }, [loadApproveCount])

  // Approvals add YVA Time entries server-side: reload the log when coming back to it
  useEffect(() => { if (tab === 'log') void loadTimeEntries().then(e => { setEntries(e); setLoaded(true) }) }, [tab])

  useEffect(() => {
    void (async () => {
      const [emps, projs, clts, { data: { user } }] = await Promise.all([
        loadEmployees(),
        loadProjects(),
        loadClients(),
        supabase.auth.getUser(),
      ])

      setEmployees(emps)
      setProjects(projs)
      setClients(clts)

      // Derive display name from auth (fallback for unlinked/internal users)
      if (user?.email) {
        const raw = user.user_metadata?.full_name as string | undefined
        const name = raw || user.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        setAuthDisplayName(name)
      }

      // Try to resolve linked employee profile
      const linkedId = sessionStorage.getItem('linkedEmployeeId')
      if (linkedId) {
        const emp = emps.find(e => e.id === linkedId)
        if (emp) setLinkedEmployee(emp)
      }
    })()
  }, [])

  // Create menu deep link: /time?create=1 opens Log manual time
  useEffect(() => {
    if (params.get('create')) { picked.current = true; setTabState('log'); openCreate(); setParams({}, { replace: true }) }
  }, [params])   // eslint-disable-line react-hooks/exhaustive-deps

  function blankForm(linked: Employee | null, fallbackName: string): FormState {
    return {
      date: getToday(),
      employeeId:   linked?.id   ?? '',
      employeeName: linked?.name ?? fallbackName,
      projectId: '', projectName: '', clientName: '',
      hours: '', description: '', billable: true,
    }
  }

  // Current user's display name (linked employee takes priority over auth name)
  const currentName = linkedEmployee?.name ?? authDisplayName

  // ─── Filtering ─────────────────────────────────────────────────────────────

  const filtered = entries.filter(e => {
    if (filterFrom     && e.date < filterFrom)              return false
    if (filterTo       && e.date > filterTo)                return false
    if (filterEmployee && e.employeeId !== filterEmployee)  return false
    if (filterProject  && e.projectId  !== filterProject)   return false
    if (filterBillable === 'billable'   && !e.billable)     return false
    if (filterBillable === 'unbillable' &&  e.billable)     return false
    return true
  }).sort((a, b) => b.date.localeCompare(a.date))

  // ─── KPIs ──────────────────────────────────────────────────────────────────

  const totalHours      = entries.reduce((s, e) => s + e.hours, 0)
  const billableHours   = entries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)
  const unbillableHours = totalHours - billableHours
  const billablePct     = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0

  // ─── Panel helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setForm(blankForm(linkedEmployee, authDisplayName))
    setPanelError(null)
    setPanelOpen(true)
  }

  function openEdit(entry: TimeEntry) {
    setEditingId(entry.id)
    setForm({
      date: entry.date, employeeId: entry.employeeId ?? '', employeeName: entry.employeeName,
      projectId: entry.projectId ?? '', projectName: entry.projectName ?? '',
      clientName: entry.clientName ?? '', hours: String(entry.hours),
      description: entry.description ?? '', billable: entry.billable,
    })
    setPanelError(null)
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    setEditingId(null)
    setForm(blankForm(linkedEmployee, authDisplayName))
  }

  function handlePanelProject(projectId: string) {
    const proj   = projects.find(p => p.id === projectId)
    const client = proj?.clientId ? clients.find(c => c.id === proj.clientId) : null
    setForm(f => ({ ...f, projectId: proj?.id ?? '', projectName: proj?.name ?? '', clientName: client?.name ?? '' }))
  }

  function handlePanelEmployee(employeeId: string) {
    const emp = employees.find(e => e.id === employeeId)
    setForm(f => ({ ...f, employeeId, employeeName: emp?.name ?? '' }))
  }

  /** One entry at a time (never a whole-table save — approved YVA Time rows are written server-side) */
  async function saveEntry() {
    const hoursNum = parseFloat(form.hours)
    if (!form.employeeName.trim() || isNaN(hoursNum) || hoursNum <= 0) return
    const existing = editingId ? entries.find(e => e.id === editingId) : undefined
    if (existing?.source === 'tracker') { closePanel(); return }   // approved YVA Time hours are read-only
    const entry: TimeEntry = existing
      ? { ...existing, date: form.date, employeeId: form.employeeId || undefined, employeeName: form.employeeName.trim(),
          projectId: form.projectId || undefined, projectName: form.projectName || undefined,
          clientName: form.clientName || undefined, hours: hoursNum,
          description: form.description.trim() || undefined, billable: form.billable }
      : { id: uid(), date: form.date, employeeId: form.employeeId || undefined,
          employeeName: form.employeeName.trim(), projectId: form.projectId || undefined,
          projectName: form.projectName || undefined, clientName: form.clientName || undefined,
          hours: hoursNum, description: form.description.trim() || undefined,
          billable: form.billable, source: 'manual', createdAt: Date.now() }
    const prev = entries
    setEntries(existing ? entries.map(e => (e.id === existing.id ? entry : e)) : [entry, ...entries])
    setSaving(true); setPanelError(null)
    try {
      await upsertTimeEntry(entry)
      setFlash({ tone: 'success', text: `${existing ? 'Saved' : 'Logged'} ${fmtHours(hoursNum)} for ${entry.employeeName} on ${dateMed(entry.date)}.` })
      closePanel()
    } catch (err) {
      setEntries(prev)
      setPanelError(`Could not save: ${(err as Error).message}`)
    } finally { setSaving(false) }
  }

  async function doDelete(entry: TimeEntry) {
    setConfirmDelete(null)
    if (entry.source === 'tracker') return
    const prev = entries
    setEntries(entries.filter(e => e.id !== entry.id))
    try { await deleteTimeEntry(entry.id); setFlash({ tone: 'success', text: 'Time entry deleted.' }) }
    catch (err) { setEntries(prev); setFlash({ tone: 'danger', text: `Could not delete: ${(err as Error).message}` }) }
  }

  const hasFilters = filterFrom || filterTo || filterEmployee || filterProject || filterBillable !== 'all'
  const hoursValid = !!form.hours && !isNaN(parseFloat(form.hours)) && parseFloat(form.hours) > 0

  // ─── Render ────────────────────────────────────────────────────────────────

  const source = (e: TimeEntry) => (e.source === 'tracker'
    ? <Pill tone="gold" className="ops-src" >YVA Time</Pill>
    : <Pill tone="neutral" className="ops-src">Manual</Pill>)
  const rowMenu = (e: TimeEntry) => e.source === 'tracker' ? null : (
    <Menu label={`Actions for ${e.employeeName} ${e.date}`} buttonClass="btn btn--xs btn--icon ops-xs-icon" items={[
      { label: 'Edit', onClick: () => openEdit(e) },
      { label: 'Delete', danger: true, onClick: () => setConfirmDelete(e) },
    ]} />
  )

  const logView = (
    <>
      <KpiStrip items={[
        { label: 'Total hours', value: fmtHours(totalHours), note: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` },
        { label: 'Billable hours', value: fmtHours(billableHours), note: `${entries.filter(e => e.billable).length} entries` },
        { label: 'Unbillable hours', value: fmtHours(unbillableHours), note: `${entries.filter(e => !e.billable).length} entries` },
        { label: 'Billable %', value: `${billablePct}%`, note: 'of all logged hours', tone: totalHours === 0 ? undefined : billablePct >= 70 ? 'success' : billablePct >= 40 ? 'warning' : 'danger' },
      ]} />

      <div className="card ops-filters">
        <Field label="From"><input className="input input--sm" type="date" aria-label="From" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input input--sm" type="date" aria-label="To" value={filterTo} onChange={e => setFilterTo(e.target.value)} /></Field>
        <Field label="Person">
          <select className="select select--sm" aria-label="Person" value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
            <option value="">Everyone</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select className="select select--sm" aria-label="Project" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map(proj => <option key={proj.id} value={proj.id}>{proj.name}</option>)}
          </select>
        </Field>
        <Field label="Billable">
          <Segmented label="Billable" value={filterBillable} onChange={setFilterBillable} options={[{ value: 'all', label: 'All' }, { value: 'billable', label: 'Billable' }, { value: 'unbillable', label: 'Unbillable' }]} />
        </Field>
        {hasFilters && <button type="button" className="btn btn--sm btn--ghost ops-filters__clear" onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterEmployee(''); setFilterProject(''); setFilterBillable('all') }}>Clear</button>}
        <span className="ops-filters__count">{filtered.length} entries · {fmtHours(filtered.reduce((s, e) => s + e.hours, 0))}</span>
      </div>

      {!loaded ? (
        <div className="card card--pad stack">{[0, 1, 2, 3].map(i => <Skel key={i} h={36} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState>{entries.length === 0 ? 'No time entries yet. Use + Log manual time to add one.' : 'No entries match the current filters.'}</EmptyState>
      ) : mobile ? (
        <div className="mcards">
          {filtered.map(e => (
            <div key={e.id} className="mcard">
              <div className="mcard__top">
                <div><div className="mcard__title">{e.employeeName}</div><div className="mcard__meta">{dateMed(e.date)} · {e.projectName ?? 'No project'}{e.clientName ? ` · ${e.clientName}` : ''}</div></div>
                <span className="mono t-strong">{clockH(e.hours)}</span>
              </div>
              {e.description && <div className="mcard__meta">{e.description}</div>}
              <div className="row row--between">
                <span className="row">{source(e)}{e.billable ? <Pill tone="success">Billable</Pill> : <span className="mcard__meta">Unbillable</span>}</span>
                {rowMenu(e)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-card">
          <table className="table ops-min-860">
            <thead>
              <tr><th>Date</th><th>Person</th><th>Project</th><th>Hours</th><th>Note</th><th>Billable</th><th>Source</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="muted ops-nowrap">{dateMed(e.date)}</td>
                  <td className="t-strong">{e.employeeName}</td>
                  <td>{e.projectName ?? '—'}{e.clientName && <span className="t-sub">{e.clientName}</span>}</td>
                  <td className="mono">{clockH(e.hours)}</td>
                  <td className="muted"><span className="ops-ellipsis" title={e.description}>{e.description ?? '—'}</span></td>
                  <td>{e.billable ? <Pill tone="success">Billable</Pill> : <span className="muted">Unbillable</span>}</td>
                  <td title={e.source === 'tracker' ? 'Approved hours from the YVA Time app — read-only' : undefined}>{source(e)}</td>
                  <td className="t-actions">{rowMenu(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )

  const showTabs = canTracker
  const sub = tab === 'log' && currentName ? `${SUB.log} Manual entries are logged as ${currentName}.` : SUB[tab]

  return (
    <div className="page">
      <PageHeader title="Time tracking" sub={sub}
        actions={tab === 'log' ? <button type="button" className="btn btn--primary" onClick={openCreate}>+ Log manual time</button> : undefined} />

      {showTabs && (
        <Tabs label="Time tracking views" value={tab} onChange={setTab} tabs={[
          { value: 'live', label: 'Live' },
          { value: 'approve', label: 'Approve', badge: approveCount || null, hidden: !canApprove },
          { value: 'schedule', label: 'Schedule' },
          { value: 'screens', label: 'Screenshots', hidden: !canShots },
          { value: 'log', label: 'Time log' },
        ]} />
      )}

      {flash && tab === 'log' && <Banner tone={flash.tone} onClose={() => setFlash(null)}>{flash.text}</Banner>}

      {tab === 'live' ? <LiveBoard />
        : tab === 'approve' ? <ApproveTime onChanged={() => void loadApproveCount()} />
        : tab === 'schedule' ? <ScheduleReport />
        : tab === 'screens' ? (canShots
            ? <ScreenshotDay key={params.toString()} initialEmployee={params.get('employee') ?? undefined} initialDay={params.get('day') ?? undefined} />
            : <EmptyState>Screenshots are only visible to the CEO and admins.</EmptyState>)
        : logView}

      <Drawer open={panelOpen} onClose={closePanel} size="narrow" title={editingId ? 'Edit time entry' : 'Log manual time'}
        sub={editingId ? undefined : 'Hours typed here go straight into the time log.'}
        footer={<><span className="spacer" /><button type="button" className="btn" onClick={closePanel}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={() => void saveEntry()} disabled={saving || !form.employeeName.trim() || !hoursValid}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Log time'}</button></>}>
        {panelError && <Banner tone="danger">{panelError}</Banner>}
        <div className="form-grid form-grid--2">
          <Field label="Date *"><input className="input" type="date" aria-label="Date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Hours *" hint="Decimal hours, e.g. 2.5 = 2h 30m">
            <input className="input" type="number" step={0.25} min={0} aria-label="Hours" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} placeholder="e.g. 2.5" />
          </Field>
          <Field label="Person *" full>
            {/* Locked to the linked employee when creating; editable when editing or not linked */}
            {linkedEmployee && !editingId ? (
              <div className="ops-locked">{linkedEmployee.name}<Pill tone="gold">You</Pill></div>
            ) : employees.length > 0 ? (
              <select className="select" aria-label="Person" value={form.employeeId} onChange={e => handlePanelEmployee(e.target.value)}>
                <option value="">— Select employee —</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            ) : (
              <input className="input" aria-label="Person" value={form.employeeName} onChange={e => setForm(f => ({ ...f, employeeName: e.target.value, employeeId: '' }))} placeholder="Employee name" />
            )}
          </Field>
          <Field label="Project (optional)" hint={form.clientName ? `Client: ${form.clientName}` : undefined} full>
            <select className="select" aria-label="Project" value={form.projectId} onChange={e => handlePanelProject(e.target.value)}>
              <option value="">— No project —</option>
              {projects.map(proj => <option key={proj.id} value={proj.id}>{proj.name}</option>)}
            </select>
          </Field>
          <Field label="Description (optional)" full>
            <textarea className="textarea" rows={2} aria-label="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What was worked on…" />
          </Field>
          <div className="field--full"><Checkbox checked={form.billable} onChange={v => setForm(f => ({ ...f, billable: v }))} label="Billable" /></div>
        </div>
      </Drawer>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete time entry?" sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button><button type="button" className="btn ops-btn-danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Delete</button></>} />
    </div>
  )
}
