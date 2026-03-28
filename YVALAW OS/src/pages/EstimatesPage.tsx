import { useEffect, useState } from 'react'
import type { Estimate, EstimateItem, EstimateStatus, Client, Project } from '../data/types'
import { loadEstimates, saveEstimates, loadSnapshot } from '../services/storage'
import { formatMoney } from '../utils/money'

function uid() { return crypto.randomUUID() }

const today = () => new Date().toISOString().slice(0, 10)

function padNum(n: number): string {
  return String(n).padStart(3, '0')
}

function autoNumber(estimates: Estimate[]): string {
  return `EST-${padNum(estimates.length + 1)}`
}

function statusBadgeClass(status: EstimateStatus): string {
  switch (status) {
    case 'draft':    return 'badge badge-gray'
    case 'sent':     return 'badge badge-blue'
    case 'accepted': return 'badge badge-green'
    case 'declined': return 'badge badge-red'
    case 'expired':  return 'badge badge-orange'
    default:         return 'badge badge-gray'
  }
}

function statusLabel(status: EstimateStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'expired']

const EMPTY_ITEM: EstimateItem = { description: '', qty: 1, unitPrice: 0 }

interface PanelState {
  open: boolean
  editing: Estimate | null
}

interface FormState {
  number: string
  date: string
  expiryDate: string
  clientId: string
  projectId: string
  status: EstimateStatus
  notes: string
  items: EstimateItem[]
}

function emptyForm(estimates: Estimate[]): FormState {
  return {
    number: autoNumber(estimates),
    date: today(),
    expiryDate: '',
    clientId: '',
    projectId: '',
    status: 'draft',
    notes: '',
    items: [{ ...EMPTY_ITEM }],
  }
}

function calcTotal(items: EstimateItem[]): number {
  return items.reduce((sum, it) => sum + (it.qty || 0) * (it.unitPrice || 0), 0)
}

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [clients, setClients]     = useState<Client[]>([])
  const [projects, setProjects]   = useState<Project[]>([])
  const [loading, setLoading]     = useState(true)

  const [filterStatus, setFilterStatus] = useState<EstimateStatus | ''>('')
  const [filterSearch, setFilterSearch] = useState('')

  const [panel, setPanel]   = useState<PanelState>({ open: false, editing: null })
  const [form, setForm]     = useState<FormState>(emptyForm([]))
  const [saving, setSaving] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [toast, setToast]                 = useState<string | null>(null)

  // Load data on mount
  useEffect(() => {
    Promise.all([loadEstimates(), loadSnapshot()]).then(([ests, snap]) => {
      setEstimates(ests)
      setClients(snap.clients)
      setProjects(snap.projects)
      setLoading(false)
    })
  }, [])

  function persist(next: Estimate[]) {
    setEstimates(next)
    void saveEstimates(next)
  }

  // ── Panel helpers ──────────────────────────────────────────────────────────

  function openNew() {
    setForm(emptyForm(estimates))
    setPanel({ open: true, editing: null })
  }

  function openEdit(est: Estimate) {
    setForm({
      number:     est.number,
      date:       est.date,
      expiryDate: est.expiryDate ?? '',
      clientId:   est.clientId  ?? '',
      projectId:  est.projectId ?? '',
      status:     est.status,
      notes:      est.notes ?? '',
      items:      est.items.length > 0 ? est.items.map(i => ({ ...i })) : [{ ...EMPTY_ITEM }],
    })
    setPanel({ open: true, editing: est })
  }

  function closePanel() {
    setPanel({ open: false, editing: null })
  }

  // ── Form field helpers ─────────────────────────────────────────────────────

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function setItemField(index: number, key: keyof EstimateItem, value: string | number) {
    setForm(f => {
      const items = f.items.map((it, i) => i === index ? { ...it, [key]: value } : it)
      return { ...f, items }
    })
  }

  function addLine() {
    setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))
  }

  function removeLine(index: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== index) }))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function handleSave() {
    if (!form.number.trim()) return
    setSaving(true)

    const selectedClient = clients.find(c => c.id === form.clientId)
    const selectedProject = projects.find(p => p.id === form.projectId)
    const total = calcTotal(form.items)

    if (panel.editing) {
      const updated: Estimate = {
        ...panel.editing,
        number:      form.number.trim(),
        date:        form.date,
        expiryDate:  form.expiryDate || undefined,
        clientId:    form.clientId   || undefined,
        clientName:  selectedClient?.name,
        projectId:   form.projectId  || undefined,
        projectName: selectedProject?.name,
        status:      form.status,
        notes:       form.notes.trim() || undefined,
        items:       form.items,
        total,
      }
      const next = estimates.map(e => e.id === updated.id ? updated : e)
      persist(next)
    } else {
      const created: Estimate = {
        id:          uid(),
        number:      form.number.trim(),
        date:        form.date,
        expiryDate:  form.expiryDate || undefined,
        clientId:    form.clientId   || undefined,
        clientName:  selectedClient?.name,
        projectId:   form.projectId  || undefined,
        projectName: selectedProject?.name,
        status:      form.status,
        notes:       form.notes.trim() || undefined,
        items:       form.items,
        total,
        createdAt:   Date.now(),
      }
      persist([...estimates, created])
    }

    setSaving(false)
    closePanel()
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  function doDelete(id: string) {
    persist(estimates.filter(e => e.id !== id))
    setConfirmDelete(null)
  }

  // ── Convert to Invoice ────────────────────────────────────────────────────

  function convertToInvoice() {
    showToast('Invoice creation coming soon — Recurring Invoices tab handles auto-billing.')
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filtered = estimates.filter(e => {
    if (filterStatus && e.status !== filterStatus) return false
    const q = filterSearch.trim().toLowerCase()
    if (q) {
      const matchClient  = (e.clientName  ?? '').toLowerCase().includes(q)
      const matchNumber  = e.number.toLowerCase().includes(q)
      if (!matchClient && !matchNumber) return false
    }
    return true
  })

  // ── KPI values ────────────────────────────────────────────────────────────

  const totalCount    = estimates.length
  const totalValue    = estimates.reduce((s, e) => s + e.total, 0)
  const acceptedCount = estimates.filter(e => e.status === 'accepted').length

  // ── Project filter by client ──────────────────────────────────────────────

  const filteredProjects = form.clientId
    ? projects.filter(p => p.clientId === form.clientId)
    : projects

  // ── Derived panel total ───────────────────────────────────────────────────

  const panelTotal = calcTotal(form.items)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="page-wrap">

      {/* Page header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Estimates</h1>
        </div>
        <div className="page-header-actions">
          <button className="btn-primary" onClick={openNew}>
            + New Estimate
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total Estimates</div>
          <div className="kpi-value">{totalCount}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Value</div>
          <div className="kpi-value">{formatMoney(totalValue)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Accepted</div>
          <div className="kpi-value" style={{ color: '#15803d' }}>{acceptedCount}</div>
        </div>
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="form-select"
          style={{ width: 160, fontSize: 13 }}
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as EstimateStatus | '')}
        >
          <option value="">All Statuses</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <input
          className="form-input"
          style={{ width: 240, fontSize: 13 }}
          placeholder="Search by client or estimate #..."
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
        />
        {(filterStatus || filterSearch) && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => { setFilterStatus(''); setFilterSearch('') }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Main table card */}
      <div style={{
        background: '#ffffff',
        borderRadius: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        {loading ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Loading estimates...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            {estimates.length === 0
              ? 'No estimates yet. Create your first estimate.'
              : 'No estimates match the current filters.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Client</th>
                  <th>Project</th>
                  <th>Date</th>
                  <th>Expiry</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(est => (
                  <tr key={est.id}>
                    <td className="td-name" style={{ fontFamily: 'monospace', fontSize: 12 }}>{est.number}</td>
                    <td className="td-name">{est.clientName ?? <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td className="td-muted">{est.projectName ?? '—'}</td>
                    <td className="td-muted">{est.date}</td>
                    <td className="td-muted">{est.expiryDate ?? '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(est.total)}</td>
                    <td>
                      <span className={statusBadgeClass(est.status)}>
                        {statusLabel(est.status)}
                      </span>
                    </td>
                    <td className="td-actions">
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {est.status === 'accepted' && (
                          <button
                            className="btn-ghost btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => convertToInvoice()}
                            title="Convert to Invoice"
                          >
                            → Invoice
                          </button>
                        )}
                        <button
                          className="btn-ghost btn-sm"
                          title="Edit"
                          onClick={() => openEdit(est)}
                          style={{ padding: '5px 9px' }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          className="btn-ghost btn-sm"
                          title="Delete"
                          onClick={() => setConfirmDelete(est.id)}
                          style={{ padding: '5px 9px', color: 'var(--danger)' }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14H6L5 6"/>
                            <path d="M10 11v6"/>
                            <path d="M14 11v6"/>
                            <path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Slide panel ─────────────────────────────────────────────────────── */}
      {panel.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            pointerEvents: 'none',
          }}
        >
          {/* Backdrop (click to close) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(15,18,30,0.35)',
              pointerEvents: 'all',
            }}
            onClick={closePanel}
          />

          {/* Panel */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 520,
              height: '100%',
              background: '#ffffff',
              boxShadow: '-4px 0 32px rgba(0,0,0,0.14)',
              zIndex: 300,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'all',
              overflowY: 'auto',
            }}
          >
            {/* Panel header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '18px 22px 14px',
              borderBottom: '1px solid var(--border)',
              background: '#ffffff',
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
                {panel.editing ? 'Edit Estimate' : 'New Estimate'}
              </span>
              <button className="modal-close" onClick={closePanel} title="Close">×</button>
            </div>

            {/* Panel body */}
            <div style={{ padding: '20px 22px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Row: Number + Date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Estimate #</label>
                  <input
                    className="form-input"
                    value={form.number}
                    onChange={e => setField('number', e.target.value)}
                    placeholder="EST-001"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.date}
                    onChange={e => setField('date', e.target.value)}
                  />
                </div>
              </div>

              {/* Row: Expiry + Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Expiry Date</label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.expiryDate}
                    onChange={e => setField('expiryDate', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={form.status}
                    onChange={e => setField('status', e.target.value as EstimateStatus)}
                  >
                    {STATUSES.map(s => (
                      <option key={s} value={s}>{statusLabel(s)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Client */}
              <div className="form-group">
                <label className="form-label">Client</label>
                <select
                  className="form-select"
                  value={form.clientId}
                  onChange={e => {
                    setField('clientId', e.target.value)
                    setField('projectId', '')
                  }}
                >
                  <option value="">— No Client —</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Project */}
              <div className="form-group">
                <label className="form-label">Project</label>
                <select
                  className="form-select"
                  value={form.projectId}
                  onChange={e => setField('projectId', e.target.value)}
                >
                  <option value="">— No Project —</option>
                  {filteredProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div className="form-group">
                <label className="form-label">Notes</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={form.notes}
                  onChange={e => setField('notes', e.target.value)}
                  placeholder="Optional notes or terms..."
                />
              </div>

              {/* Line items */}
              <div>
                <div style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.07em',
                  color: 'var(--muted)',
                  marginBottom: 10,
                }}>
                  Line Items
                </div>

                {/* Items table */}
                <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                          Description
                        </th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', width: 64 }}>
                          Qty
                        </th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', width: 100 }}>
                          Unit Price
                        </th>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', width: 90 }}>
                          Subtotal
                        </th>
                        <th style={{ width: 32 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 6px 6px 0' }}>
                            <input
                              className="form-input"
                              style={{ fontSize: 12, padding: '6px 8px' }}
                              value={item.description}
                              onChange={e => setItemField(idx, 'description', e.target.value)}
                              placeholder="Description..."
                            />
                          </td>
                          <td style={{ padding: '6px 4px' }}>
                            <input
                              className="form-input"
                              type="number"
                              min="0"
                              step="1"
                              style={{ fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                              value={item.qty}
                              onChange={e => setItemField(idx, 'qty', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td style={{ padding: '6px 4px' }}>
                            <input
                              className="form-input"
                              type="number"
                              min="0"
                              step="0.01"
                              style={{ fontSize: 12, padding: '6px 8px', textAlign: 'right' }}
                              value={item.unitPrice}
                              onChange={e => setItemField(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600, fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                            {formatMoney(item.qty * item.unitPrice)}
                          </td>
                          <td style={{ padding: '6px 0 6px 4px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              disabled={form.items.length <= 1}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: form.items.length <= 1 ? 'not-allowed' : 'pointer',
                                color: form.items.length <= 1 ? 'var(--soft)' : 'var(--danger)',
                                fontSize: 16,
                                lineHeight: 1,
                                padding: '2px 4px',
                                borderRadius: 4,
                              }}
                              title="Remove line"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button className="btn-ghost btn-sm" onClick={addLine} type="button">
                  + Add Line
                </button>

                {/* Total */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '2px solid var(--border)',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
                    Total
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)' }}>
                    {formatMoney(panelTotal)}
                  </span>
                </div>
              </div>

            </div>

            {/* Save button */}
            <div style={{
              padding: '14px 22px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surf2)',
              flexShrink: 0,
            }}>
              <button
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleSave}
                disabled={saving || !form.number.trim()}
              >
                {saving ? 'Saving…' : panel.editing ? 'Save Changes' : 'Create Estimate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm delete dialog ────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete estimate?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => doDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 28,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1b1e2b',
          color: '#ffffff',
          padding: '12px 22px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 600,
          boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
          zIndex: 999,
          maxWidth: 480,
          textAlign: 'center',
          lineHeight: 1.5,
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
