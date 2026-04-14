import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { AppSettings, Client, Invoice, Project, RecurringInvoice, RecurringFrequency } from '../data/types'
import {
  loadInvoices, saveInvoices,
  loadInvoiceCounter, saveInvoiceCounter,
  loadSnapshot, loadSettings,
  loadRecurringInvoices, saveRecurringInvoices,
  logComm,
} from '../services/storage'
import { formatMoney } from '../utils/money'
import { buildInvoiceHTML as buildInvoiceHTMLUtil, printInvoice as printInvoiceUtil } from '../utils/invoiceHtml'
import InvoiceBuilder from '../components/InvoiceBuilder'
import { sendEmail } from '../services/gmail'

type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'partial'

const STATUSES: { key: InvoiceStatus; label: string }[] = [
  { key: 'draft',   label: 'Draft' },
  { key: 'sent',    label: 'Sent' },
  { key: 'viewed',  label: 'Viewed' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid',    label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
]

function uid() { return crypto.randomUUID() }

function statusBadge(s?: string): string {
  switch ((s || '').toLowerCase()) {
    case 'paid':    return 'badge-green'
    case 'overdue': return 'badge-red'
    case 'sent':    return 'badge-blue'
    case 'viewed':  return 'badge-purple'
    case 'partial': return 'badge-orange'
    default:        return 'badge-gray'
  }
}

function dopLabel(usd: number, rate: number): string {
  if (!rate || rate <= 0) return ''
  return `RD$${(usd * rate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// ── Invoice HTML builder / printer — thin wrappers around shared utility ─────
function buildInvoiceHTML(inv: Invoice, rate: number, settings: AppSettings, autoPrint = false): string {
  return buildInvoiceHTMLUtil(inv, {
    rate,
    companyName:    settings.companyName,
    companyAddress: settings.companyAddress,
    companyEmail:   settings.companyEmail,
    companyPhone:   settings.companyPhone,
    autoPrint,
  })
}

function printInvoice(inv: Invoice, rate: number, settings: AppSettings) {
  printInvoiceUtil(inv, {
    rate,
    companyName:    settings.companyName,
    companyAddress: settings.companyAddress,
    companyEmail:   settings.companyEmail,
    companyPhone:   settings.companyPhone,
  })
}

// ── Share portal link ──────────────────────────────────────
function shareInvoice(inv: Invoice, dopRate: number) {
  const payload = { inv, dopRate: dopRate > 0 ? dopRate : undefined }
  const b64 = btoa(encodeURIComponent(JSON.stringify(payload)))
  const url = `${window.location.origin}/invoice-view#${b64}`
  navigator.clipboard.writeText(url).then(
    () => alert('Portal link copied to clipboard!'),
    () => prompt('Copy this link:', url),
  )
}

const DEFAULT_INVOICE_EMAIL = `Hi {clientName},\n\nPlease find attached invoice {invoiceNumber} for {amount}.\n\nBilling period: {period}\n{dueDate}\nPlease don't hesitate to reach out with any questions.\n\n{companyName}`
const DEFAULT_REMINDER_EMAIL = `Hi {clientName},\n\nThis is a friendly reminder that invoice {invoiceNumber} for {amount} is past due.\n\nOriginal due date: {dueDate}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n{companyName}`

function applyInvoiceTemplate(template: string, inv: Invoice, settings: AppSettings): string {
  const period = `${inv.billingStart || inv.date || '—'} – ${inv.billingEnd || ''}`
  return template
    .replace(/\{clientName\}/g,    inv.clientName || 'Client')
    .replace(/\{invoiceNumber\}/g, inv.number || '')
    .replace(/\{amount\}/g,        formatMoney(Number(inv.subtotal) || 0))
    .replace(/\{dueDate\}/g,       inv.dueDate ? `Due date: ${inv.dueDate}` : '')
    .replace(/\{period\}/g,        period)
    .replace(/\{companyName\}/g,   settings.emailSignature || settings.companyName || 'YVA Staffing')
}

// ── Email invoice ──────────────────────────────────────────
function emailInvoice(inv: Invoice, settings: AppSettings) {
  const to      = inv.clientEmail || ''
  const subject = `Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body    = applyInvoiceTemplate(settings.invoiceEmailTemplate || DEFAULT_INVOICE_EMAIL, inv, settings)
  // Attach invoice HTML (no DOP for client invoices — pass rate 0)
  const invoiceHtml = buildInvoiceHTML(inv, 0, settings, false)
  sendEmail(to, subject, body, {
    name:     `invoice-${inv.number}.html`,
    content:  invoiceHtml,
    mimeType: 'text/html',
  })
}

// ── Payment reminder email ──────────────────────────────────
function reminderEmail(inv: Invoice, settings: AppSettings) {
  const to      = inv.clientEmail || ''
  const subject = `Payment Reminder — Invoice ${inv.number} — ${settings.companyName || 'YVA Staffing'}`
  const body    = applyInvoiceTemplate(settings.reminderEmailTemplate || DEFAULT_REMINDER_EMAIL, inv, settings)
  sendEmail(to, subject, body)
}

type QuickForm = {
  clientName: string; date: string; dueDate: string
  subtotal: string; notes: string; status: InvoiceStatus
}
const EMPTY_FORM: QuickForm = {
  clientName: '', date: new Date().toISOString().slice(0, 10),
  dueDate: '', subtotal: '', notes: '', status: 'draft',
}

export default function InvoicePage() {
  const location = useLocation()
  const [invoices,    setInvoices]    = useState<Invoice[]>([])
  const [clients,     setClients]     = useState<Client[]>([])
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [settings,    setSettings]    = useState<AppSettings>({ usdToDop: 0 })
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderProjectId, setBuilderProjectId] = useState<string | undefined>()
  const [editingInvoice, setEditingInvoice] = useState<Invoice | undefined>()
  const [sendConfirmInv, setSendConfirmInv] = useState<Invoice | null>(null)
  const [quickModal, setQuickModal] = useState(false)
  const [quickProjectId, setQuickProjectId] = useState<string | undefined>()
  const [statusModal, setStatusModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState<InvoiceStatus>('draft')
  const [newAmountPaid, setNewAmountPaid] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM)
  const urlQ = new URLSearchParams(location.search).get('q') || ''
  const [search, setSearch] = useState(urlQ)
  const [toast, setToast] = useState<string | null>(null)
  const [previewInv, setPreviewInv] = useState<Invoice | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'invoices' | 'recurring'>('invoices')
  const [recurring, setRecurring] = useState<RecurringInvoice[]>([])
  const [recurringPanel, setRecurringPanel] = useState(false)
  const [editingRec, setEditingRec] = useState<RecurringInvoice | null>(null)
  type RecForm = { clientId: string; clientName: string; projectId: string; projectName: string; amount: string; description: string; frequency: RecurringFrequency; nextDueDate: string; active: boolean }
  const EMPTY_REC: RecForm = { clientId: '', clientName: '', projectId: '', projectName: '', amount: '', description: '', frequency: 'monthly', nextDueDate: new Date().toISOString().slice(0,10), active: true }
  const [recForm, setRecForm] = useState<RecForm>(EMPTY_REC)

  useEffect(() => {
    loadSnapshot().then(snap => {
      setInvoices(snap.invoices)
      setClients(snap.clients)
      setAllProjects(snap.projects)
      // If navigated here with ?q=, expand all project groups so the invoice is visible
      if (urlQ) {
        const keys = new Set<string>()
        for (const inv of snap.invoices) keys.add(inv.projectId || inv.projectName || '__unassigned__')
        setExpanded(keys)
      }
    })
    loadSettings().then(setSettings)
    loadRecurringInvoices().then(setRecurring)
  }, [])

  function persist(next: Invoice[]) { setInvoices(next); void saveInvoices(next) }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function openBuilder(projectId?: string) { setBuilderProjectId(projectId); setBuilderOpen(true) }
  function openEditInvoice(inv: Invoice) { setEditingInvoice(inv); setBuilderProjectId(inv.projectId || undefined); setBuilderOpen(true) }
  async function closeBuilder(inv?: Invoice) {
    const fresh = await loadInvoices()
    setInvoices(fresh)
    setBuilderOpen(false)
    setBuilderProjectId(undefined)
    setEditingInvoice(undefined)
    if (inv && inv.status === 'draft') setSendConfirmInv(inv)
  }

  function openQuickForProject(projectId?: string) {
    const proj = allProjects.find(p => p.id === projectId)
    const client = proj ? clients.find(c => c.id === proj.clientId) : undefined
    setForm({
      ...EMPTY_FORM,
      date: new Date().toISOString().slice(0, 10),
      clientName: client?.name || '',
      status: 'draft',
    })
    setQuickProjectId(projectId)
    setQuickModal(true)
  }

  async function saveQuick() {
    if (!form.clientName.trim() || !form.subtotal) return
    const counter = await loadInvoiceCounter()
    const client = clients.find(c => c.name === form.clientName)
    const proj = allProjects.find(p => p.id === quickProjectId)
    const inv: Invoice = {
      id: uid(),
      number: `INV-${String(counter).padStart(3, '0')}`,
      date: form.date,
      dueDate: form.dueDate || undefined,
      clientName: form.clientName,
      clientEmail: client?.email,
      projectId: proj?.id || null,
      projectName: proj?.name || undefined,
      subtotal: parseFloat(form.subtotal) || 0,
      notes: form.notes || undefined,
      status: 'sent',
      items: [],
      statusHistory: [{ status: 'sent', changedAt: Date.now() }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    persist([inv, ...invoices])
    void saveInvoiceCounter(counter + 1)
    setQuickModal(false)
    setQuickProjectId(undefined)
    if (inv.clientEmail) {
      emailInvoice(inv, settings)
      if (client?.id) void logComm(client.id, `Invoice ${inv.number} emailed (${formatMoney(inv.subtotal || 0)})`, 'email')
    } else if (client?.id) {
      void logComm(client.id, `Invoice ${inv.number} created (${formatMoney(inv.subtotal || 0)})`, 'system')
    }
  }

  function toggleCollapse(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function openStatusEdit(inv: Invoice) {
    setEditId(inv.id)
    setNewStatus((inv.status as InvoiceStatus) || 'draft')
    setNewAmountPaid(inv.amountPaid != null ? String(inv.amountPaid) : '')
    setStatusModal(true)
  }
  function saveStatus() {
    if (!editId) return
    const amtPaid = newStatus === 'partial' ? (parseFloat(newAmountPaid) || 0) : undefined
    const targetInv = invoices.find(i => i.id === editId)
    persist(invoices.map((inv) => {
      if (inv.id !== editId) return inv
      const histEntry = { status: newStatus, changedAt: Date.now() }
      return {
        ...inv, status: newStatus, amountPaid: amtPaid, updatedAt: Date.now(),
        statusHistory: [...(inv.statusHistory || []), histEntry],
      }
    }))
    if (targetInv) {
      const clientId = clients.find(c => c.name === targetInv.clientName)?.id
      if (clientId) {
        void logComm(clientId, `Invoice ${targetInv.number} status changed to ${newStatus}`, 'system')
      }
    }
    setStatusModal(false)
  }

  function duplicateInvoice(inv: Invoice) {
    void loadInvoiceCounter().then(counter => {
      const dup: Invoice = {
        ...inv,
        id:        uid(),
        number:    `INV-${String(counter).padStart(3, '0')}`,
        status:    'draft',
        amountPaid: undefined,
        date:      new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      persist([dup, ...invoices])
      void saveInvoiceCounter(counter + 1)
    })
  }
  function doDelete(id: string) { persist(invoices.filter((inv) => inv.id !== id)); setConfirmDelete(null) }

  const filtered = invoices.filter((inv) =>
    `${inv.number} ${inv.clientName} ${inv.projectName}`.toLowerCase().includes(search.toLowerCase()),
  )

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; projectId: string | null; invoices: Invoice[] }>()
    for (const inv of filtered) {
      const key = inv.projectId || inv.projectName || '__unassigned__'
      if (!map.has(key)) {
        const proj = allProjects.find(p => p.id === inv.projectId || p.name === inv.projectName)
        map.set(key, { label: proj?.name || inv.projectName || 'Unassigned', projectId: proj?.id || null, invoices: [] })
      }
      map.get(key)!.invoices.push(inv)
    }
    return Array.from(map.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => {
        if (a.key === '__unassigned__') return 1
        if (b.key === '__unassigned__') return -1
        return a.label.localeCompare(b.label)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.map(i=>i.id+i.status).join(), allProjects.map(p=>p.id).join()])

  const totalBilled = invoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)

  // ── Recurring helpers ────────────────────────────────────────────────────────
  function persistRec(next: RecurringInvoice[]) { setRecurring(next); void saveRecurringInvoices(next) }

  function openRecurringNew() {
    setEditingRec(null)
    setRecForm(EMPTY_REC)
    setRecurringPanel(true)
  }
  function openRecurringEdit(r: RecurringInvoice) {
    setEditingRec(r)
    setRecForm({
      clientId: r.clientId || '', clientName: r.clientName || '',
      projectId: r.projectId || '', projectName: r.projectName || '',
      amount: String(r.amount), description: r.description || '',
      frequency: r.frequency, nextDueDate: r.nextDueDate, active: r.active,
    })
    setRecurringPanel(true)
  }
  function saveRecurring() {
    const amt = parseFloat(recForm.amount) || 0
    if (!amt || !recForm.clientName.trim()) return
    if (editingRec) {
      persistRec(recurring.map(r => r.id === editingRec.id
        ? { ...r, clientId: recForm.clientId || undefined, clientName: recForm.clientName, projectId: recForm.projectId || undefined, projectName: recForm.projectName || undefined, amount: amt, description: recForm.description || undefined, frequency: recForm.frequency, nextDueDate: recForm.nextDueDate, active: recForm.active }
        : r
      ))
    } else {
      const newRec: RecurringInvoice = {
        id: uid(), clientId: recForm.clientId || undefined, clientName: recForm.clientName,
        projectId: recForm.projectId || undefined, projectName: recForm.projectName || undefined,
        amount: amt, description: recForm.description || undefined, frequency: recForm.frequency,
        nextDueDate: recForm.nextDueDate, active: recForm.active, createdAt: Date.now(),
      }
      persistRec([newRec, ...recurring])
    }
    setRecurringPanel(false)
  }
  function toggleRecActive(r: RecurringInvoice) {
    persistRec(recurring.map(x => x.id === r.id ? { ...x, active: !x.active } : x))
  }
  function deleteRec(id: string) {
    persistRec(recurring.filter(r => r.id !== id))
  }

  function freqLabel(f: RecurringFrequency) {
    return f === 'weekly' ? 'Weekly' : f === 'biweekly' ? 'Biweekly' : 'Monthly'
  }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">{invoices.length} total · {formatMoney(totalBilled)}{settings.usdToDop > 0 ? ` · RD$${(totalBilled * settings.usdToDop).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}</p>
        </div>
        <div className="page-header-actions">
          <input className="form-input" style={{ width: 190 }} placeholder="Search invoices..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {invoices.some(i => ['overdue','sent','partial'].includes((i.status||'').toLowerCase()) && i.clientEmail) && (
            <button className="btn-ghost btn-sm" title="Send reminder to all clients with unpaid invoices" onClick={() => {
              const seen = new Set<string>()
              for (const inv of invoices.filter(i => ['overdue','sent','partial'].includes((i.status||'').toLowerCase()) && i.clientEmail)) {
                if (!seen.has(inv.clientEmail!)) {
                  seen.add(inv.clientEmail!)
                  reminderEmail(inv, settings)
                  const cId = clients.find(c => c.name === inv.clientName)?.id
                  if (cId) void logComm(cId, `Payment reminder sent for Invoice ${inv.number}`, 'email')
                }
              }
              showToast(`Reminders sent to ${seen.size} client${seen.size !== 1 ? 's' : ''}`)
            }}>✉ Remind All</button>
          )}
          <button className="btn-ghost btn-sm" onClick={() => openQuickForProject(undefined)}>Quick Invoice</button>
          <button className="btn-primary" onClick={() => openBuilder()}>+ New Invoice</button>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
        {(['invoices', 'recurring'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
            background: 'none', borderBottom: activeTab === tab ? '2px solid var(--gold)' : '2px solid transparent',
            color: activeTab === tab ? 'var(--text)' : 'var(--muted)', marginBottom: -2,
          }}>
            {tab === 'invoices' ? 'Invoices' : 'Recurring'}
            {tab === 'recurring' && recurring.filter(r => r.active).length > 0 && (
              <span style={{ marginLeft: 6, background: 'var(--gold)', color: '#1b1e2b', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>
                {recurring.filter(r => r.active).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── RECURRING TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'recurring' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <button className="btn-primary" onClick={openRecurringNew}>+ New Recurring</button>
          </div>
          {recurring.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontSize: 14 }}>
              No recurring invoices yet. Set one up to auto-bill clients on a schedule.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th><th>Project</th><th>Amount</th><th>Frequency</th>
                    <th>Next Due</th><th>Description</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recurring.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.clientName || '—'}</td>
                      <td>{r.projectName || '—'}</td>
                      <td>{formatMoney(r.amount)}</td>
                      <td><span className="badge-gray">{freqLabel(r.frequency)}</span></td>
                      <td>{r.nextDueDate}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{r.description || '—'}</td>
                      <td>
                        <span className={r.active ? 'badge-green' : 'badge-gray'}>
                          {r.active ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-ghost btn-sm" onClick={() => openRecurringEdit(r)} title="Edit">✏</button>
                          <button className="btn-ghost btn-sm" onClick={() => toggleRecActive(r)} title={r.active ? 'Pause' : 'Resume'}>
                            {r.active ? '⏸' : '▶'}
                          </button>
                          <button className="btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => { if (confirm('Delete this recurring invoice?')) deleteRec(r.id) }} title="Delete">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* RECURRING PANEL */}
          {recurringPanel && (
            <>
              <div onClick={() => setRecurringPanel(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 290 }} />
              <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 440, background: 'var(--surface)', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 300, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{editingRec ? 'Edit Recurring' : 'New Recurring Invoice'}</span>
                  <button className="btn-ghost btn-sm" onClick={() => setRecurringPanel(false)}>✕</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Client *</label>
                    <select className="form-input" value={recForm.clientId} onChange={e => {
                      const c = clients.find(x => x.id === e.target.value)
                      setRecForm(f => ({ ...f, clientId: e.target.value, clientName: c?.name || '' }))
                    }}>
                      <option value="">Select client…</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Project</label>
                    <select className="form-input" value={recForm.projectId} onChange={e => {
                      const p = allProjects.find(x => x.id === e.target.value)
                      setRecForm(f => ({ ...f, projectId: e.target.value, projectName: p?.name || '' }))
                    }}>
                      <option value="">None</option>
                      {allProjects.filter(p => !recForm.clientId || p.clientId === recForm.clientId).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Amount (USD) *</label>
                    <input className="form-input" type="number" min="0" step="0.01" placeholder="0.00"
                      value={recForm.amount} onChange={e => setRecForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Frequency</label>
                    <select className="form-input" value={recForm.frequency} onChange={e => setRecForm(f => ({ ...f, frequency: e.target.value as RecurringFrequency }))}>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Biweekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Next Due Date</label>
                    <input className="form-input" type="date" value={recForm.nextDueDate}
                      onChange={e => setRecForm(f => ({ ...f, nextDueDate: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <textarea className="form-input" rows={2} placeholder="e.g. Monthly retainer"
                      value={recForm.description} onChange={e => setRecForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="checkbox" id="rec-active" checked={recForm.active} onChange={e => setRecForm(f => ({ ...f, active: e.target.checked }))} />
                    <label htmlFor="rec-active" style={{ fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>Active (will auto-generate invoices)</label>
                  </div>
                </div>
                <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
                  <button className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: 14 }}
                    onClick={saveRecurring} disabled={!recForm.clientName.trim() || !recForm.amount}>
                    {editingRec ? 'Save Changes' : 'Create Recurring Invoice'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── INVOICES TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'invoices' && (
      <div>
      {/* PROJECT-GROUPED INVOICE LIST */}
      {groups.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)', fontSize: 14 }}>
          {search ? 'No invoices match your search.' : 'No invoices yet. Click "+ New Invoice" to get started.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map(({ key, label, projectId: pId, invoices: groupInvs }) => {
            const groupTotal = groupInvs.reduce((s, i) => s + (Number(i.subtotal)||0), 0)
            const unpaid = groupInvs.filter(i => ['sent','overdue','partial'].includes((i.status||'').toLowerCase())).length
            const isOpen = expanded.has(key)
            return (
              <div key={key} className="invoice-group">
                <div className="invoice-group-header" onClick={() => toggleCollapse(key)}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', width: 12 }}>{isOpen ? '▼' : '▶'}</span>
                  <span className="invoice-group-name">{label}</span>
                  <span className="invoice-group-meta">
                    {groupInvs.length} invoice{groupInvs.length !== 1 ? 's' : ''} · {formatMoney(groupTotal)}
                    {settings.usdToDop > 0 ? ` · RD$${(groupTotal * settings.usdToDop).toLocaleString('en-US',{maximumFractionDigits:0})}` : ''}
                    {unpaid > 0 && <span style={{ marginLeft: 8, color: '#f87171', fontSize: 11 }}>● {unpaid} unpaid</span>}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <button className="btn-xs btn-ghost" onClick={() => openQuickForProject(pId || undefined)}>+ Quick</button>
                    <button className="btn-xs btn-ghost" onClick={() => openBuilder(pId || undefined)}>+ Invoice</button>
                  </div>
                </div>
                {isOpen && (
                  <div className="table-wrap" style={{ margin: '0 0 2px' }}>
                    <table className="data-table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>Number</th>
                          <th>Client</th>
                          <th>Date</th>
                          <th>Due</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupInvs.map(inv => {
                          const overdue = inv.dueDate && new Date(inv.dueDate) < new Date() && !['paid'].includes((inv.status||'').toLowerCase())
                          return (
                            <tr key={inv.id}>
                              <td className="td-name" style={{ fontWeight: 700, fontSize: 13 }}>{inv.number}</td>
                              <td className="td-muted">{inv.clientName || '—'}</td>
                              <td className="td-muted">{inv.date || '—'}</td>
                              <td className="td-muted" style={{ color: overdue ? '#f87171' : undefined }}>{inv.dueDate || '—'}</td>
                              <td><span className={`badge ${statusBadge(inv.status)}`} style={{ fontSize: 10 }}>{inv.status || 'draft'}</span>
                                {inv.status === 'partial' && inv.amountPaid != null && (
                                  <span style={{ fontSize: 10, color: '#f97316', marginLeft: 4 }}>({formatMoney(inv.amountPaid)} paid)</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 700 }}>
                                {formatMoney(Number(inv.subtotal)||0)}
                                {settings.usdToDop > 0 && <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{dopLabel(Number(inv.subtotal)||0, settings.usdToDop)}</div>}
                              </td>
                              <td>
                                <div style={{ display: 'flex', gap: 3, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                  {inv.clientEmail && <button className="btn-xs btn-ghost" title="Email invoice" onClick={() => { emailInvoice(inv, settings); showToast(`Invoice ${inv.number} emailed to ${inv.clientEmail}`); const cId = clients.find(c => c.name === inv.clientName)?.id; if (cId) void logComm(cId, `Invoice ${inv.number} emailed (${formatMoney(Number(inv.subtotal)||0)})`, 'email') }}>✉</button>}
                                  {inv.clientEmail && ['overdue','sent','partial'].includes((inv.status||'').toLowerCase()) && (
                                    <button className="btn-xs btn-ghost" title="Payment reminder" onClick={() => { reminderEmail(inv, settings); showToast(`Payment reminder sent to ${inv.clientEmail}`); const cId = clients.find(c => c.name === inv.clientName)?.id; if (cId) void logComm(cId, `Payment reminder sent for Invoice ${inv.number}`, 'email') }}>⚠</button>
                                  )}
                                  <button className="btn-xs btn-ghost" title="Preview" onClick={() => setPreviewInv(inv)}>👁</button>
                                  <button className="btn-xs btn-ghost" title="PDF" onClick={() => printInvoice(inv, 0, settings)}>⎙</button>
                                  <button className="btn-xs btn-ghost" title="Share portal" onClick={() => shareInvoice(inv, settings.usdToDop)}>🔗</button>
                                  <button className="btn-xs btn-ghost" title="Duplicate" onClick={() => duplicateInvoice(inv)}>⧉</button>
                                  <button className="btn-xs btn-ghost" title="Edit invoice" onClick={() => openEditInvoice(inv)}>✏</button>
                                  <button className="btn-xs btn-ghost" title="Update status" onClick={() => openStatusEdit(inv)}>✎</button>
                                  <button className="btn-xs btn-danger" onClick={() => setConfirmDelete(inv.id)}>×</button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      </div>
      )}
      {/* end invoices tab */}

      {/* React Invoice Builder */}
      {builderOpen && (
        <div className="modal-overlay" onClick={() => closeBuilder()}>
          <div className="builder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="builder-modal-header">
              <span>{editingInvoice ? `Edit Invoice — ${editingInvoice.number}` : 'New Invoice'}</span>
              <button className="modal-close btn-icon" onClick={() => closeBuilder()}>✕</button>
            </div>
            <div className="builder-modal-body">
              <InvoiceBuilder onCreated={closeBuilder} onCancel={() => closeBuilder()} initialProjectId={builderProjectId} editInvoice={editingInvoice} />
            </div>
          </div>
        </div>
      )}

      {/* Quick Invoice Modal */}
      {quickModal && (
        <div className="modal-overlay" onClick={() => setQuickModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Quick Invoice <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>· auto-marked Sent + emailed</span></h2>
              <button className="modal-close btn-icon" onClick={() => setQuickModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid-2">
                <div className="form-group form-group-full">
                  <label className="form-label">Client *</label>
                  <select className="form-select" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })}>
                    <option value="">— Select client —</option>
                    {clients.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Invoice Date</label>
                  <input className="form-input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Due Date</label>
                  <input className="form-input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount ($) *</label>
                  <input className="form-input" type="number" placeholder="0.00" value={form.subtotal} onChange={(e) => setForm({ ...form, subtotal: e.target.value })} />
                </div>
                <div className="form-group form-group-full">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional message to client..." />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setQuickModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveQuick} disabled={!form.clientName || !form.subtotal}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Status update */}
      {statusModal && (
        <div className="modal-overlay" onClick={() => setStatusModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Update Status</h2>
              <button className="modal-close btn-icon" onClick={() => setStatusModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-select" value={newStatus} onChange={(e) => setNewStatus(e.target.value as InvoiceStatus)}>
                  {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              {newStatus === 'partial' && (
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="form-label">Amount Paid ($)</label>
                  <input
                    className="form-input"
                    type="number"
                    placeholder="0.00"
                    value={newAmountPaid}
                    onChange={e => setNewAmountPaid(e.target.value)}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    Enter how much has been received so far.
                  </div>
                </div>
              )}
              {(() => {
                const hist = invoices.find(i => i.id === editId)?.statusHistory || []
                if (hist.length === 0) return null
                return (
                  <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: 8 }}>Status History</div>
                    {[...hist].reverse().slice(0, 6).map((h, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, marginBottom: 5 }}>
                        <span className={`badge ${statusBadge(h.status)}`} style={{ fontSize: 10 }}>{h.status}</span>
                        <span style={{ color: 'var(--muted)' }}>{new Date(h.changedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setStatusModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={saveStatus}>Save</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Delete invoice?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => doDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Send Confirmation Modal */}
      {sendConfirmInv && (
        <div className="modal-overlay" onClick={() => setSendConfirmInv(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Invoice Saved</h2>
              <button className="modal-close btn-icon" onClick={() => setSendConfirmInv(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 14, color: 'var(--soft)', marginBottom: 8 }}>
                <strong>{sendConfirmInv.number}</strong> has been saved as a draft.
              </p>
              {sendConfirmInv.clientEmail ? (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Send to <strong>{sendConfirmInv.clientEmail}</strong> now?
                </p>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>No client email on file. Mark as sent manually when ready.</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => setSendConfirmInv(null)}>Keep as Draft</button>
              <button className="btn-primary" onClick={() => {
                const updated = invoices.map(i => i.id === sendConfirmInv.id
                  ? { ...i, status: 'sent' as const, statusHistory: [...(i.statusHistory||[]), { status: 'sent', changedAt: Date.now() }] }
                  : i)
                void saveInvoices(updated)
                setInvoices(updated)
                const cId = clients.find(c => c.name === sendConfirmInv.clientName)?.id
                if (sendConfirmInv.clientEmail) {
                  emailInvoice(sendConfirmInv, settings)
                  showToast(`Invoice ${sendConfirmInv.number} sent to ${sendConfirmInv.clientEmail}`)
                  if (cId) void logComm(cId, `Invoice ${sendConfirmInv.number} emailed (${formatMoney(Number(sendConfirmInv.subtotal)||0)})`, 'email')
                } else {
                  showToast(`Invoice ${sendConfirmInv.number} marked as sent`)
                  if (cId) void logComm(cId, `Invoice ${sendConfirmInv.number} marked as sent`, 'system')
                }
                setSendConfirmInv(null)
              }}>{sendConfirmInv.clientEmail ? 'Send Now' : 'Mark as Sent'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
          background: '#1e293b', border: '1px solid var(--border)',
          borderLeft: '3px solid #4ade80',
          color: 'var(--text)', fontSize: 13, fontWeight: 500,
          padding: '10px 16px', borderRadius: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,.4)',
          maxWidth: 360, animation: 'fadeIn .2s ease',
        }}>
          ✓ {toast}
        </div>
      )}

      {/* Invoice Preview Modal */}
      {previewInv && (
        <div className="modal-overlay" onClick={() => setPreviewInv(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, width: '90vw', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ padding: '14px 20px' }}>
              <div>
                <h2 className="modal-title">Preview — {previewInv.number}</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{previewInv.clientName}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-primary btn-sm" onClick={() => printInvoice(previewInv, 0, settings)}>⎙ Print / PDF</button>
                <button className="modal-close btn-icon" onClick={() => setPreviewInv(null)}>✕</button>
              </div>
            </div>
            <iframe
              srcDoc={buildInvoiceHTML(previewInv, 0, settings, false)}
              style={{ flex: 1, border: 'none', background: '#fff', minHeight: 500 }}
              title="Invoice Preview"
            />
          </div>
        </div>
      )}
    </div>
  )
}
