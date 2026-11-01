import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import EmployeePayRates from '../components/EmployeePayRates'
import EmployeePayoutMethod from '../components/EmployeePayoutMethod'
import EmployeeDocuments from '../components/EmployeeDocuments'
import RecordHistory from '../components/RecordHistory'
import type { Attachment, Client, Employee, Invoice, Project, TimeEntry } from '../data/types'
import { loadSnapshot, saveEmployees, loadTimeEntries } from '../services/storage'
import { uploadFile, deleteFile } from '../services/fileStorage'
import { usePermission, useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { fmtHoursHM } from '../utils/money'
import { Ic, P } from '../components/Icon'
import { Activity, Banner, Card, EmptyState, KpiStrip, Menu, Modal, Pill, Skel, Tabs, useIsMobile } from '../components/ui'
import EmployeeStatements from '../components/people/EmployeeStatements'
import EmployeePayslips from '../components/people/EmployeePayslips'
import YvaTimeLogin from '../components/people/YvaTimeLogin'
import { AttachmentList } from '../components/people/attachments'
import { EmployeeFields, employeeToForm, formToEmployee, EMPTY_EMPLOYEE_FORM, type EmployeeFormData } from '../components/people/EmployeeForm'
import { PersonAvatar, employeeStatusTone, firstName, hireDateLabel, payScheduleOf, placementOf, projectsOf, upcomingAnniversary } from '../components/people/common'
import { useEmployeeWeekStats } from '../components/people/weekStats'

function uid() { return crypto.randomUUID() }

type Tab = 'overview' | 'pay' | 'time' | 'docs' | 'history'
const TABS: Tab[] = ['overview', 'pay', 'time', 'docs', 'history']

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { role: myRole } = useRole()
  const allowed = usePermission()
  const mobile = useIsMobile()
  const showPayRates = can.viewPayRates(myRole)
  const canSchedule = allowed('rates.manage')
  const canTracker = can.viewTracker(myRole)

  const [loaded, setLoaded] = useState(false)
  const [employees, setEmployeesState] = useState<Employee[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    loadSnapshot().then(snap => {
      setEmployeesState(snap.employees); setInvoices(snap.invoices); setProjects(snap.projects); setClients(snap.clients); setLoaded(true)
    }).catch(e => { setError(`Could not load: ${(e as Error).message}`); setLoaded(true) })
    void loadTimeEntries().then(setTimeEntries)
  }, [])

  const emp = employees.find(e => e.id === id)
  const week = useEmployeeWeekStats(emp)
  const tabParam = params.get('tab') as Tab | null
  const [tab, setTabState] = useState<Tab>(tabParam && TABS.includes(tabParam) ? tabParam : 'overview')
  function setTab(t: Tab) { setTabState(t); setParams(t === 'overview' ? {} : { tab: t }, { replace: true }) }

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EmployeeFormData>(EMPTY_EMPLOYEE_FORM)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Sync form/attachments/photo from emp once data loads
  useEffect(() => {
    if (emp && !editing) {
      setForm(employeeToForm(emp))
      setAttachments(emp.attachments ?? [])
      setPhotoUrl(emp.photoUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp?.id])

  if (!loaded) {
    return (
      <div className="page">
        <Skel w={80} h={14} />
        <div className="ppl-prof-head"><Skel w={64} h={64} r={32} /><div className="stack"><Skel w={220} h={24} /><Skel w={300} h={14} /></div></div>
        <div className="grid-auto"><div className="card card--pad stack"><Skel h={14} /><Skel h={14} w="70%" /><Skel h={14} w="80%" /></div><div className="card card--pad stack"><Skel h={14} /><Skel h={14} w="60%" /></div></div>
      </div>
    )
  }
  if (!emp) {
    return (
      <div className="page">
        <EmptyState action={<button type="button" className="btn" onClick={() => navigate('/employees')}>← Back to Team</button>}>Employee not found.</EmptyState>
      </div>
    )
  }

  // emp is guaranteed non-null here (early return above handles null case)
  const empNN = emp!
  const first = firstName(empNN.name)
  const assignedProjects = projectsOf(empNN, projects)
  const client = empNN.worksFor !== 'yva'
  const canScreens = !!empNN.userId && client && can.viewScreenshots(myRole)
  const viewScreens = () => navigate(`/time?tab=screens&employee=${empNN.id}`)
  const payTab = showPayRates || canSchedule || allowed('bank.view') || allowed('bank.manage') || allowed('payroll.view') || allowed('payroll.manage')

  async function persistUpdate(updated: Employee, ok?: string) {
    const before = employees
    const next = employees.map(e => e.id === updated.id ? updated : e)
    setEmployeesState(next); setError(null)
    try { await saveEmployees(next); if (ok) setNotice(ok); return true }
    catch (e) { setEmployeesState(before); setError(`Could not save: ${(e as Error).message}`); return false }
  }

  async function handleSave() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    const updated: Employee = { ...empNN, ...formToEmployee(form, { schedule: canSchedule }), status: form.status, photoUrl, attachments }
    const ok = await persistUpdate(updated, 'Profile saved.')
    setSaving(false)
    if (ok) setEditing(false)
  }

  function handleCancel() {
    setForm(employeeToForm(empNN))
    setAttachments(empNN.attachments ?? [])
    setEditing(false)
  }

  function startEdit() { setForm(employeeToForm(empNN)); setTab('overview'); setEditing(true) }

  async function handleDelete() {
    setConfirmDelete(false)
    const before = employees
    const next = employees.filter(e => e.id !== empNN.id)
    setEmployeesState(next)
    try { await saveEmployees(next); navigate('/employees') }
    catch (e) { setEmployeesState(before); setError(`Could not delete: ${(e as Error).message}`) }
  }

  function handlePhotoUpload(file: File) {
    if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { alert('Image too large (max 5 MB).'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const url = ev.target?.result as string
      const prev = photoUrl
      setPhotoUrl(url)
      void persistUpdate({ ...empNN, photoUrl: url, attachments }, 'Photo updated.').then(ok => { if (!ok) setPhotoUrl(prev) })
    }
    reader.readAsDataURL(file)
  }

  function handleFileUpload(file: File) {
    if (file.size > 200 * 1024 * 1024) { alert('File too large (max 200 MB).'); return }
    void (async () => {
      try {
        const { storageUrl, storagePath } = await uploadFile(file, `employees/${empNN.id}`)
        const att: Attachment = { id: uid(), name: file.name, mimeType: file.type, size: file.size, dataUrl: storageUrl, storageUrl, storagePath, uploadedAt: Date.now() }
        const next = [...attachments, att]
        setAttachments(next)
        if (!(await persistUpdate({ ...empNN, attachments: next }, `${file.name} uploaded.`))) setAttachments(attachments)
      } catch (e) {
        console.error('Upload failed', e)
        alert('Upload failed. Please try again.')
      }
    })()
  }

  function removeAttachment(attId: string) {
    const att = attachments.find(a => a.id === attId)
    if (att?.storagePath) void deleteFile(att.storagePath)
    const next = attachments.filter(a => a.id !== attId)
    setAttachments(next)
    void persistUpdate({ ...empNN, attachments: next }).then(ok => { if (!ok) setAttachments(attachments) })
  }

  /* ── Overview pieces ─────────────────────────────────────────────── */
  const sched = payScheduleOf(empNN, projects)
  const info: { k: string; v?: string | null; mono?: boolean }[] = [
    { k: 'Employee number', v: empNN.employeeNumber, mono: true },
    { k: 'Email', v: empNN.email },
    { k: 'Phone', v: empNN.phone },
    { k: 'Position', v: empNN.role },
    { k: 'Status', v: empNN.status || 'Active' },
    { k: 'Employment type', v: empNN.employmentType },
    { k: 'Hire date', v: hireDateLabel(empNN.hireDate) },
    { k: 'Start year', v: !empNN.hireDate && empNN.startYear ? String(empNN.startYear) : undefined },
    { k: 'Default shift', v: empNN.defaultShiftStart || empNN.defaultShiftEnd ? `${empNN.defaultShiftStart || '—'} to ${empNN.defaultShiftEnd || '—'}` : undefined },
    { k: 'Time zone', v: empNN.timezone },
    { k: 'Location', v: empNN.location },
    ...(showPayRates ? [
      { k: 'Pay rate', v: empNN.payRate ? `$${empNN.payRate}/hr` : undefined },
      { k: 'Night premium', v: empNN.premiumEnabled ? `+${empNN.premiumPercent || 0}% after ${empNN.premiumStartTime || '21:00'}` : undefined },
    ] : []),
    { k: 'Pay schedule', v: sched.own ? sched.label : `Follows project (${sched.label.toLowerCase()})` },
    { k: 'Works for', v: client ? 'Client project' : 'YVA team' },
    { k: 'Manual time', v: empNN.manualTimeAllowed ? 'On (admin approves)' : 'Off' },
  ]

  const empTime = timeEntries.filter(e => e.employeeId === empNN.id || e.employeeName?.toLowerCase() === empNN.name.toLowerCase()).sort((a, b) => b.date.localeCompare(a.date))
  const totalTracked = empTime.reduce((s, e) => s + e.hours, 0)
  const billableTracked = empTime.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)
  const byProject: Record<string, number> = {}
  for (const e of empTime) { const k = e.projectName || 'No project'; byProject[k] = (byProject[k] || 0) + e.hours }
  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthEntries = empTime.filter(e => e.date.startsWith(monthKey))
  const monthHours = monthEntries.reduce((s, e) => s + e.hours, 0)

  // On time this week (Time → Schedule rules): needs a shift on the profile and a YVA Time login
  const hasShift = !!(empNN.defaultShiftStart && empNN.defaultShiftEnd)
  const onTime = hasShift && empNN.userId ? week.onTime : null
  const onTimeNote = !hasShift ? 'No shift on profile' : !empNN.userId ? 'No YVA Time login'
    : week.loading ? 'This week' : !onTime || onTime.days === 0 ? 'No finished shift this week' : `${onTime.onTime} of ${onTime.days} days this week`

  const overview = (
    <div className="stack stack--lg">
      <div className="grid-auto ppl-tabgrid">
        <Card title="Profile" actions={!editing && <button type="button" className="link" onClick={startEdit}>Edit</button>}>
          <div className="card__body">
            {editing ? <EmployeeFields form={form} setForm={setForm} pay={showPayRates} schedule={canSchedule} /> : (
              <>
                <div className="info-grid ppl-info">
                  {info.filter(i => i.v).map(i => (
                    <div key={i.k} className="info"><span className="info__label">{i.k}</span><span className={`info__value ppl-info__v${i.mono ? ' mono' : ''}`}>{i.v}</span></div>
                  ))}
                </div>
                {empNN.notes && <div className="info ppl-notes"><span className="info__label">Notes</span><span className="info__value ppl-prewrap">{empNN.notes}</span></div>}
              </>
            )}
          </div>
          {editing && (
            <div className="card__foot">
              <button type="button" className="btn" onClick={handleCancel}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => void handleSave()} disabled={!form.name.trim() || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          )}
        </Card>
        <div className="stack stack--lg">
          <Card title="Assigned projects">
            {assignedProjects.length === 0 ? <div className="card-empty">{client ? 'Not on a project yet — add them from the project’s Team & rates.' : 'YVA team — no client project.'}</div>
              : assignedProjects.map(p => (
                <button type="button" key={p.id} className="list-row ppl-rowbtn" onClick={() => navigate('/projects/' + p.id)}>
                  <span className="list-row__main">
                    <span className="list-row__title">{p.name}</span>
                    <span className="list-row__meta">{clients.find(c => c.id === p.clientId)?.name || 'No client'}{p.paySchedule ? ` · paid ${p.paySchedule}` : ''}</span>
                  </span>
                  {p.status && <Pill status={p.status} />}
                  <Ic d={P.chevR} size={15} />
                </button>
              ))}
          </Card>
          <div className="card ppl-mini-stats">
            <div className="ppl-mini-stat"><span className="info__label">Hours, {now.toLocaleString('en-US', { month: 'short' })}</span><span className="ppl-mini-stat__v num">{fmtHoursHM(monthHours)}</span></div>
            {canTracker && (
              <div className="ppl-mini-stat" data-stat="activity">
                <span className="info__label">Activity</span>
                <span className="ppl-mini-stat__v">{week.loading ? <Skel w={44} h={18} /> : <Activity pct={client ? week.activity : null} />}</span>
                <span className="ppl-mini-stat__note">{!client ? 'Not measured for the YVA team' : week.activity === null && !week.loading ? 'Nothing measured this week' : 'This week'}</span>
              </div>
            )}
            <div className="ppl-mini-stat" data-stat="ontime">
              <span className="info__label">On time</span>
              <span className="ppl-mini-stat__v num">{week.loading ? <Skel w={44} h={18} /> : onTime && onTime.days > 0 ? `${Math.round(onTime.onTime / onTime.days * 100)}%` : <span className="soft">—</span>}</span>
              <span className="ppl-mini-stat__note">{onTimeNote}</span>
            </div>
          </div>
        </div>
      </div>

      {empTime.length > 0 && (
        <section className="stack ppl-timelog">
          <div className="row row--between"><h2 className="ppl-h2">Time log</h2><button type="button" className="link" onClick={() => navigate('/time')}>Open Time tracking →</button></div>
          <KpiStrip compact items={[
            { label: 'Total tracked', value: fmtHoursHM(totalTracked), note: `${empTime.length} entries` },
            { label: 'Billable', value: fmtHoursHM(billableTracked), note: `${totalTracked > 0 ? Math.round(billableTracked / totalTracked * 100) : 0}% of total` },
            { label: 'Projects', value: Object.keys(byProject).length, note: Object.entries(byProject).sort((a, b) => b[1] - a[1])[0]?.[0] || '—' },
          ]} />
          {mobile ? (
            <div className="mcards">
              {empTime.slice(0, 20).map(e => (
                <div key={e.id} className="mcard">
                  <div className="mcard__top"><span className="mcard__title">{e.projectName || '—'}</span><span className="num t-strong">{fmtHoursHM(e.hours)}</span></div>
                  <span className="mcard__meta"><span className="mono">{e.date}</span>{e.description ? ` · ${e.description}` : ''}</span>
                  <span className="row row--wrap">{e.source === 'tracker' && <span className="tag-mono">YVA Time</span>}{e.billable && <Pill tone="success">Billable</Pill>}</span>
                </div>
              ))}
              {empTime.length > 20 && <button type="button" className="link" onClick={() => navigate('/time')}>Showing 20 of {empTime.length} — view all in Time tracking</button>}
            </div>
          ) : <div className="table-card">
            <table className="table ppl-timelog__table">
              <thead><tr><th>Date</th><th>Project</th><th className="t-right">Hours</th><th>Description</th><th>Billable</th></tr></thead>
              <tbody>
                {empTime.slice(0, 20).map(e => (
                  <tr key={e.id}>
                    <td className="mono muted">{e.date}</td>
                    <td>{e.projectName || '—'}{e.source === 'tracker' && <> <span className="tag-mono">YVA Time</span></>}</td>
                    <td className="t-num t-strong">{fmtHoursHM(e.hours)}</td>
                    <td className="muted ppl-ellipsis">{e.description || '—'}</td>
                    <td>{e.billable ? <Pill tone="success">Billable</Pill> : <span className="soft">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {empTime.length > 20 && <div className="pager">Showing 20 of {empTime.length} entries <button type="button" className="link" onClick={() => navigate('/time')}>View all in Time tracking</button></div>}
          </div>}
        </section>
      )}
    </div>
  )

  const pay = (
    <div className="grid-auto ppl-tabgrid">
      <EmployeePayRates employee={empNN} />
      <EmployeePayoutMethod employeeId={empNN.id} employeeName={empNN.name} />
      <EmployeePayslips employeeId={empNN.id} employeeName={empNN.name} employeeNumber={empNN.employeeNumber} />
      {showPayRates && (
        <Card title="Earnings statements" meta="From client invoices and approved YVA Time work" className="ppl-span-all">
          <div className="card__body"><EmployeeStatements emp={empNN} invoices={invoices} onInvoicesChange={setInvoices} timeEntries={timeEntries} /></div>
        </Card>
      )}
    </div>
  )

  const docs = (
    <div className="grid-auto ppl-tabgrid">
      <EmployeeDocuments employeeId={empNN.id} firstName={first} />
      <Card title="Internal files" meta="CVs, voice notes, videos — staff only"
        actions={<button type="button" className="btn btn--sm" onClick={() => fileInputRef.current?.click()}><Ic d={P.upload} size={14} />Upload</button>}>
        <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*,video/*,.mp4,.mov,.avi,.webm,.mkv,.m4v,.wmv" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
        <div className="card__body"><AttachmentList items={attachments} onRemove={removeAttachment} empty="No files yet. Upload CVs, audio notes, videos, or documents." /></div>
      </Card>
    </div>
  )

  const anniversary = upcomingAnniversary(empNN)
  const since = empNN.startYear ? `since ${empNN.startYear}` : ''
  const subParts = [empNN.role, placementOf(empNN, projects, clients), since].filter(Boolean)

  return (
    <div className="page ppl-profile">
      <button type="button" className="back-link" onClick={() => navigate('/employees')}><Ic d={P.chevL} size={15} />Team</button>
      {notice && <Banner onClose={() => setNotice(null)}>{notice}</Banner>}
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}

      <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }} />
      <div className="ppl-prof-head">
        <div className="ppl-prof-head__who">
          <button type="button" className="ppl-photo" title="Change photo" aria-label="Change photo" onClick={() => photoInputRef.current?.click()}>
            <PersonAvatar name={empNN.name} photo={photoUrl} size="xl" />
            <span className="ppl-photo__cam"><Ic d={P.image} size={13} /></span>
          </button>
          <div className="ppl-prof-head__text">
            <h1 className="page-title">{empNN.name}</h1>
            <span className="page-sub">{empNN.employeeNumber && <><span className="mono t-gold">{empNN.employeeNumber}</span>{subParts.length ? ' · ' : ''}</>}{subParts.join(' · ')}</span>
            <div className="row row--wrap ppl-pills">
              <Pill tone={client ? 'info' : 'gold'}>{client ? 'Client project' : 'YVA team'}</Pill>
              <Pill tone={empNN.userId ? 'success' : 'neutral'}>{empNN.userId ? 'YVA Time login' : 'No YVA Time login'}</Pill>
              <Pill tone={employeeStatusTone(empNN.status)}>{empNN.status || 'Active'}</Pill>
              {anniversary && <Pill tone="gold" className="ppl-anniv">{anniversary.label}</Pill>}
            </div>
          </div>
        </div>
        <div className="page-actions">
          {editing ? (
            <>
              <button type="button" className="btn" onClick={handleCancel}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => void handleSave()} disabled={!form.name.trim() || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </>
          ) : (
            <>
              {canScreens && tab !== 'time' && <button type="button" className="btn" onClick={viewScreens}>View screenshots</button>}
              <button type="button" className="btn btn--primary" onClick={startEdit}>Edit profile</button>
              <Menu label="More profile actions" items={[
                { label: 'Change photo', icon: P.image, onClick: () => photoInputRef.current?.click() },
                { label: 'Statements', icon: P.file, onClick: () => setTab('pay'), hidden: !showPayRates },
                'sep',
                { label: `Delete ${first}`, icon: P.trash, danger: true, onClick: () => setConfirmDelete(true) },
              ]} />
            </>
          )}
        </div>
      </div>

      <Tabs label="Employee sections" value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'pay', label: 'Pay & payout', hidden: !payTab },
        { value: 'time', label: 'YVA Time' },
        { value: 'docs', label: 'Documents', count: attachments.length || null },
        { value: 'history', label: 'History', hidden: !allowed('history.view') },
      ]} />

      {tab === 'overview' && overview}
      {tab === 'pay' && payTab && pay}
      {tab === 'time' && <YvaTimeLogin emp={empNN} onLinked={userId => setEmployeesState(prev => prev.map(e => e.id === empNN.id ? { ...e, userId } : e))} onViewScreens={canScreens ? viewScreens : undefined} />}
      {tab === 'docs' && docs}
      {tab === 'history' && <RecordHistory inline table="employees" recordId={empNN.id} />}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${empNN.name}?`} sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="btn btn--danger" onClick={() => void handleDelete()}>Delete</button></>} />
    </div>
  )
}
