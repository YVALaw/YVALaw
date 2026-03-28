import { useEffect, useState } from 'react'
import type { Client, Employee, Project, TimeEntry } from '../data/types'
import { loadTimeEntries, saveTimeEntries, loadEmployees, loadProjects, loadClients } from '../services/storage'
import { supabase } from '../lib/supabase'
import { useActiveTimer, formatElapsed, elapsedSeconds } from '../hooks/useActiveTimer'

function uid() { return crypto.randomUUID() }
function getToday() { return new Date().toISOString().slice(0, 10) }

function fmtHours(h: number): string {
  const total = Math.round(h * 60)
  const hrs = Math.floor(total / 60)
  const min = total % 60
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`
}

type BillableFilter = 'all' | 'billable' | 'unbillable'

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

export default function TimeTrackingPage() {
  const [entries,   setEntries]   = useState<TimeEntry[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects,  setProjects]  = useState<Project[]>([])
  const [clients,   setClients]   = useState<Client[]>([])

  // The person whose timer this is
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

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Live timer
  const { timer, elapsed, start: startTimer, stop: stopTimer } = useActiveTimer()

  useEffect(() => {
    void (async () => {
      const [ents, emps, projs, clts, { data: { user } }] = await Promise.all([
        loadTimeEntries(),
        loadEmployees(),
        loadProjects(),
        loadClients(),
        supabase.auth.getUser(),
      ])

      setEntries(ents)
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

  function persist(next: TimeEntry[]) {
    setEntries(next)
    void saveTimeEntries(next)
  }

  // ─── Timer: direct start/stop, no modal ────────────────────────────────────

  function handleStartTimer() {
    if (!currentName) return
    startTimer({
      employeeId:   linkedEmployee?.id,
      employeeName: currentName,
      billable:     true,
    })
  }

  function handleStopTimer() {
    const finished = stopTimer()
    if (!finished) return
    const secs  = elapsedSeconds(finished.startedAt)
    const hours = Math.round((secs / 3600) * 100) / 100
    if (hours < 0.01) return
    persist([{
      id:           uid(),
      date:         new Date().toISOString().slice(0, 10),
      employeeId:   finished.employeeId,
      employeeName: finished.employeeName,
      projectId:    finished.projectId,
      projectName:  finished.projectName,
      clientName:   finished.clientName,
      hours,
      description:  finished.description,
      billable:     finished.billable,
      createdAt:    Date.now(),
    }, ...entries])
  }

  // ─── Filtering ─────────────────────────────────────────────────────────────

  const filtered = entries.filter(e => {
    if (filterFrom     && e.date < filterFrom)              return false
    if (filterTo       && e.date > filterTo)                return false
    if (filterEmployee && e.employeeId !== filterEmployee)  return false
    if (filterProject  && e.projectId  !== filterProject)   return false
    if (filterBillable === 'billable'   && !e.billable)     return false
    if (filterBillable === 'unbillable' &&  e.billable)     return false
    return true
  })

  // ─── KPIs ──────────────────────────────────────────────────────────────────

  const totalHours      = entries.reduce((s, e) => s + e.hours, 0)
  const billableHours   = entries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)
  const unbillableHours = totalHours - billableHours
  const billablePct     = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0

  // ─── Panel helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setForm(blankForm(linkedEmployee, authDisplayName))
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

  function saveEntry() {
    const hoursNum = parseFloat(form.hours)
    if (!form.employeeName.trim() || isNaN(hoursNum) || hoursNum <= 0) return
    if (editingId) {
      persist(entries.map(e => e.id === editingId
        ? { ...e, date: form.date, employeeId: form.employeeId || undefined, employeeName: form.employeeName.trim(),
            projectId: form.projectId || undefined, projectName: form.projectName || undefined,
            clientName: form.clientName || undefined, hours: hoursNum,
            description: form.description.trim() || undefined, billable: form.billable }
        : e))
    } else {
      persist([{ id: uid(), date: form.date, employeeId: form.employeeId || undefined,
        employeeName: form.employeeName.trim(), projectId: form.projectId || undefined,
        projectName: form.projectName || undefined, clientName: form.clientName || undefined,
        hours: hoursNum, description: form.description.trim() || undefined,
        billable: form.billable, createdAt: Date.now() }, ...entries])
    }
    closePanel()
  }

  function doDelete(id: string) {
    persist(entries.filter(e => e.id !== id))
    setConfirmDelete(null)
  }

  const hasFilters = filterFrom || filterTo || filterEmployee || filterProject || filterBillable !== 'all'

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Time Tracking</h1>
          {currentName && <p className="page-sub">Tracking as <strong>{currentName}</strong></p>}
        </div>
        <div className="page-actions">
          {timer ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(250,204,21,.1)', border: '1px solid rgba(250,204,21,.3)',
                borderRadius: 20, padding: '6px 14px',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#facc15', flexShrink: 0, animation: 'pulse 1.4s infinite' }} />
                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatElapsed(elapsed)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {timer.employeeName}{timer.projectName ? ` · ${timer.projectName}` : ''}
                </span>
              </div>
              <button className="btn-primary" style={{ background: '#ef4444', borderColor: '#ef4444' }} onClick={handleStopTimer}>
                ⏹ Stop & Save
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={handleStartTimer} disabled={!currentName}>
              ▶ Start Timer
            </button>
          )}
          <button className="btn-ghost btn-sm" onClick={openCreate}>+ Log Manual</button>
        </div>
      </div>

      {/* Active timer info bar */}
      {timer && (
        <div style={{
          background: 'rgba(250,204,21,.06)', border: '1px solid rgba(250,204,21,.2)',
          borderRadius: 10, padding: '10px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
        }}>
          <span style={{ fontWeight: 700, color: 'var(--text)' }}>Timer running</span>
          <span style={{ color: 'var(--muted)' }}>Employee: <strong style={{ color: 'var(--text)' }}>{timer.employeeName}</strong></span>
          {timer.projectName && <span style={{ color: 'var(--muted)' }}>Project: <strong style={{ color: 'var(--text)' }}>{timer.projectName}</strong></span>}
          {timer.description && <span style={{ color: 'var(--muted)' }}>"{timer.description}"</span>}
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
            Started {new Date(timer.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="kpi-card">
          <div className="kpi-label">Total Hours</div>
          <div className="kpi-value">{fmtHours(totalHours)}</div>
          <div className="kpi-sub">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Billable Hours</div>
          <div className="kpi-value" style={{ color: 'var(--gold)' }}>{fmtHours(billableHours)}</div>
          <div className="kpi-sub">{entries.filter(e => e.billable).length} entries</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Unbillable Hours</div>
          <div className="kpi-value" style={{ color: 'var(--muted)' }}>{fmtHours(unbillableHours)}</div>
          <div className="kpi-sub">{entries.filter(e => !e.billable).length} entries</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Billable %</div>
          <div className="kpi-value" style={{ color: billablePct >= 70 ? '#4ade80' : billablePct >= 40 ? 'var(--gold)' : '#f87171' }}>
            {billablePct}%
          </div>
          <div className="kpi-sub">of all logged hours</div>
        </div>
      </div>

      {/* Filters + table */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', padding: '14px 16px', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">From</label>
            <input className="form-input" type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ fontSize: 12, width: 130 }} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">To</label>
            <input className="form-input" type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ fontSize: 12, width: 130 }} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Employee</label>
            <select className="form-select" value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)} style={{ fontSize: 12, width: 160 }}>
              <option value="">All employees</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Project</label>
            <select className="form-select" value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ fontSize: 12, width: 160 }}>
              <option value="">All projects</option>
              {projects.map(proj => <option key={proj.id} value={proj.id}>{proj.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Billable</label>
            <div style={{ display: 'flex', border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, overflow: 'hidden' }}>
              {(['all', 'billable', 'unbillable'] as BillableFilter[]).map(val => (
                <button key={val} onClick={() => setFilterBillable(val)} style={{
                  padding: '5px 10px', fontSize: 12, border: 'none',
                  borderRight: val !== 'unbillable' ? '1px solid var(--border, #e5e7eb)' : 'none',
                  background: filterBillable === val ? 'var(--gold, #f5b533)' : '#fff',
                  color: filterBillable === val ? '#1a1a1a' : 'var(--muted, #6b7280)',
                  cursor: 'pointer', fontWeight: filterBillable === val ? 600 : 400,
                }}>
                  {val.charAt(0).toUpperCase() + val.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {hasFilters && (
            <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-end', marginBottom: 2 }}
              onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterEmployee(''); setFilterProject(''); setFilterBillable('all') }}>
              Clear
            </button>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ alignSelf: 'flex-end', fontSize: 12, color: 'var(--muted)', marginBottom: 2, whiteSpace: 'nowrap' }}>
            {filtered.length} entries &middot; {fmtHours(filtered.reduce((s, e) => s + e.hours, 0))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)', fontSize: 13 }}>
            {entries.length === 0 ? "No time entries yet. Hit Start Timer to begin." : 'No entries match the current filters.'}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th><th>Employee</th><th>Project</th><th>Client</th>
                  <th>Hours</th><th>Description</th><th>Billable</th><th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice().sort((a, b) => b.date.localeCompare(a.date)).map(entry => (
                  <tr key={entry.id}>
                    <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>{entry.date}</td>
                    <td className="td-name">{entry.employeeName}</td>
                    <td className="td-muted">{entry.projectName ?? '—'}</td>
                    <td className="td-muted">{entry.clientName ?? '—'}</td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtHours(entry.hours)}</td>
                    <td className="td-muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.description}>
                      {entry.description ?? '—'}
                    </td>
                    <td>
                      {entry.billable
                        ? <span className="badge-green" style={{ fontSize: 11 }}>✓ Billable</span>
                        : <span style={{ fontSize: 11, color: 'var(--muted)' }}>Unbillable</span>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn-ghost btn-sm" onClick={() => openEdit(entry)} style={{ padding: '3px 7px', fontSize: 13 }}>✏️</button>
                        <button className="btn-ghost btn-sm" onClick={() => setConfirmDelete(entry.id)} style={{ padding: '3px 7px', fontSize: 13, color: '#ef4444' }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide panel overlay */}
      {panelOpen && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.18)', zIndex: 299 }} onClick={closePanel} />}

      {/* Log Time slide panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, background: '#fff',
        zIndex: 300, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{editingId ? 'Edit Time Entry' : 'Log Time'}</span>
          <button className="btn-ghost btn-sm" onClick={closePanel} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>&times;</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>

          <div className="form-group">
            <label className="form-label">Employee *</label>
            {/* Locked to linked employee when creating; editable when editing or no link */}
            {linkedEmployee && !editingId ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{linkedEmployee.name}</span>
                <span style={{ fontSize: 11, background: 'rgba(250,204,21,.15)', color: '#a16207', padding: '1px 7px', borderRadius: 999, marginLeft: 4 }}>You</span>
              </div>
            ) : employees.length > 0 ? (
              <select className="form-select" value={form.employeeId} onChange={e => handlePanelEmployee(e.target.value)}>
                <option value="">— Select employee —</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            ) : (
              <input className="form-input" value={form.employeeName} onChange={e => setForm(f => ({ ...f, employeeName: e.target.value, employeeId: '' }))} placeholder="Employee name" />
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Project <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
            <select className="form-select" value={form.projectId} onChange={e => handlePanelProject(e.target.value)}>
              <option value="">— No project —</option>
              {projects.map(proj => <option key={proj.id} value={proj.id}>{proj.name}</option>)}
            </select>
            {form.clientName && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Client: <strong>{form.clientName}</strong></div>}
          </div>

          <div className="form-group">
            <label className="form-label">Hours *</label>
            <input className="form-input" type="number" step={0.25} min={0} value={form.hours}
              onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} placeholder="e.g. 2.5" />
          </div>

          <div className="form-group">
            <label className="form-label">Description <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
            <textarea className="form-input" rows={2} value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What was worked on..." style={{ resize: 'vertical', minHeight: 60 }} />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, userSelect: 'none' }}>
              <input type="checkbox" checked={form.billable} onChange={e => setForm(f => ({ ...f, billable: e.target.checked }))} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              Billable
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '16px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={saveEntry}
            disabled={!form.employeeName.trim() || !form.hours || isNaN(parseFloat(form.hours)) || parseFloat(form.hours) <= 0}>
            {editingId ? 'Save Changes' : 'Log Time'}
          </button>
          <button className="btn-ghost" onClick={closePanel}>Cancel</button>
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete time entry?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => doDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
