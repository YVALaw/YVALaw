import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Estimate, EstimateItem, EstimateStatus, Client, Invoice, Project } from '../data/types'
import { loadEstimates, saveEstimates, loadSnapshot } from '../services/storage'
import { createInvoiceFromEstimate } from '../services/crm'
import { sendEmail } from '../services/email'
import { useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { Drawer, Field, Menu, Modal, PageHeader, Pill, SearchInput, Skel, Tabs, useIsMobile, type Tone } from '../components/ui'
import { Ic, P } from '../components/Icon'
import { dateMed, dateShort, usd } from '../utils/format'
import { useToast } from '../context/ToastContext'

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const STATUSES: EstimateStatus[] = ['draft', 'sent', 'accepted', 'declined', 'expired']
const STATUS_TONE: Record<EstimateStatus, Tone> = { draft: 'neutral', sent: 'sent', accepted: 'success', declined: 'danger', expired: 'neutral' }
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const EMPTY_ITEM: EstimateItem = { description: '', qty: 1, unitPrice: 0 }
const autoNumber = (estimates: Estimate[]) => `EST-${String(estimates.length + 1).padStart(3, '0')}`
const calcTotal = (items: EstimateItem[]) => items.reduce((sum, it) => sum + (it.qty || 0) * (it.unitPrice || 0), 0)
/** Whole days from today to a YYYY-MM-DD date (local) */
function daysTo(day?: string) {
  if (!day) return null
  const [y, m, d] = day.slice(0, 10).split('-').map(Number); const t = new Date()
  return Math.round((new Date(y, (m || 1) - 1, d || 1).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000)
}

interface FormState { number: string; date: string; expiryDate: string; clientId: string; projectId: string; status: EstimateStatus; notes: string; items: EstimateItem[] }
function emptyForm(estimates: Estimate[]): FormState {
  return { number: autoNumber(estimates), date: today(), expiryDate: '', clientId: '', projectId: '', status: 'draft', notes: '', items: [{ ...EMPTY_ITEM }] }
}

/** CRM → Estimates: quotes before a deal is signed (redesign 2026-11) */
export default function EstimatesPage() {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const { role } = useRole()
  const canInvoice = can.viewInvoices(role)
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<EstimateStatus | 'all'>('all')
  const [filterSearch, setFilterSearch] = useState('')
  const [panel, setPanel] = useState<{ open: boolean; editing: Estimate | null }>({ open: false, editing: null })
  const [form, setForm] = useState<FormState>(emptyForm([]))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Estimate | null>(null)
  const toast = useToast()
  const [converting, setConverting] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([loadEstimates(), loadSnapshot()]).then(([ests, snap]) => {
      setEstimates(ests); setClients(snap.clients); setProjects(snap.projects); setInvoices(snap.invoices); setLoading(false)
    })
  }, [])

  /** Optimistic update → await the save → roll back with a message if it fails */
  async function persist(next: Estimate[]) {
    const prev = estimates
    setEstimates(next)
    try { await saveEstimates(next) } catch (e) { setEstimates(prev); toast.error(`Could not save: ${(e as Error).message}`); throw e }
  }

  function openNew() { setForm(emptyForm(estimates)); setPanel({ open: true, editing: null }) }
  function openEdit(est: Estimate) {
    setForm({ number: est.number, date: est.date, expiryDate: est.expiryDate ?? '', clientId: est.clientId ?? '', projectId: est.projectId ?? '', status: est.status, notes: est.notes ?? '', items: est.items.length > 0 ? est.items.map(i => ({ ...i })) : [{ ...EMPTY_ITEM }] })
    setPanel({ open: true, editing: est })
  }
  const closePanel = () => setPanel({ open: false, editing: null })
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(f => ({ ...f, [key]: value }))
  const setItemField = (index: number, key: keyof EstimateItem, value: string | number) => setForm(f => ({ ...f, items: f.items.map((it, i) => (i === index ? { ...it, [key]: value } : it)) }))

  /** send = also email the estimate to the client and mark it Sent */
  async function handleSave(send = false) {
    if (!form.number.trim() || saving) return
    const selectedClient = clients.find(c => c.id === form.clientId)
    const selectedProject = projects.find(p => p.id === form.projectId)
    if (send && !selectedClient?.email) { toast.error('Pick a client with an email address to send the estimate.'); return }
    setSaving(true)
    const status: EstimateStatus = send && form.status === 'draft' ? 'sent' : form.status
    const fields = {
      number: form.number.trim(), date: form.date, expiryDate: form.expiryDate || undefined,
      clientId: form.clientId || undefined, clientName: selectedClient?.name, projectId: form.projectId || undefined, projectName: selectedProject?.name,
      status, notes: form.notes.trim() || undefined, items: form.items, total: calcTotal(form.items),
    }
    const saved: Estimate = panel.editing ? { ...panel.editing, ...fields } : { id: crypto.randomUUID(), ...fields, createdAt: Date.now() }
    try {
      await persist(panel.editing ? estimates.map(e => (e.id === saved.id ? saved : e)) : [...estimates, saved])
      closePanel()
      if (send && selectedClient?.email) {
        const lines = saved.items.filter(i => i.description || i.unitPrice).map(i => `  • ${i.description || 'Item'} — ${i.qty} × ${usd(i.unitPrice)} = ${usd((i.qty || 0) * (i.unitPrice || 0))}`).join('\n')
        const body = `Hi ${selectedClient.name},\n\nHere is estimate ${saved.number}${saved.projectName ? ` for ${saved.projectName}` : ''}:\n\n${lines}\n\nTotal: ${usd(saved.total)}${saved.expiryDate ? `\nValid until ${dateMed(saved.expiryDate)}.` : ''}${saved.notes ? `\n\n${saved.notes}` : ''}\n\nReply to this email to accept or ask questions.\n\nYVA Staffing`
        const r = await sendEmail(selectedClient.email, `Estimate ${saved.number} — YVA Staffing`, body)
        if (r.mode === 'outlook') toast.success(`Estimate ${saved.number} saved and emailed to ${selectedClient.email}.`)
        else if (r.mode === 'mailto') toast.success(`Estimate ${saved.number} saved and opened in your email app.`)
        else toast.error(`Estimate saved, but the email was not sent: ${r.fallbackReason ?? 'the company mailbox could not send it.'}`)
      } else toast.success(`Estimate ${saved.number} saved.`)
    } catch { /* persist already showed the error */ }
    finally { setSaving(false) }
  }
  async function doDelete(est: Estimate) {
    setConfirmDelete(null)
    await persist(estimates.filter(e => e.id !== est.id)).then(() => toast.success(`Estimate ${est.number} deleted.`)).catch(() => {})
  }
  async function convertToInvoice(est: Estimate) {
    if (converting) return
    const prior = invoices.find(i => (i.notes || '').startsWith(`From estimate ${est.number}`))
    if (!window.confirm(prior ? `Estimate ${est.number} was already turned into invoice ${prior.number}. Create another draft invoice?` : `Create a draft invoice for ${usd(est.total)} from ${est.number}? Finance reviews and sends it from Invoices.`)) return
    setConverting(est.id)
    try {
      const r = await createInvoiceFromEstimate(est, clients.find(c => c.id === est.clientId), projects.find(p => p.id === est.projectId))
      setInvoices(prev => [{ id: r.id, number: r.number, notes: `From estimate ${est.number}` } as Invoice, ...prev])
      toast.success(`Draft invoice ${r.number} created from ${est.number}.`, { action: { label: 'Open invoice', onClick: () => navigate(`/invoice?open=${r.id}`) } })
    } catch (e) { toast.error(`Could not create the invoice: ${(e as Error).message}`) }
    finally { setConverting(null) }
  }

  const q = filterSearch.trim().toLowerCase()
  const searched = estimates.filter(e => !q || (e.clientName ?? '').toLowerCase().includes(q) || e.number.toLowerCase().includes(q) || (e.projectName ?? '').toLowerCase().includes(q))
  const filtered = searched.filter(e => filterStatus === 'all' || e.status === filterStatus).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.number.localeCompare(a.number))
  const totalValue = estimates.reduce((s, e) => s + (Number(e.total) || 0), 0)
  const acceptedCount = estimates.filter(e => e.status === 'accepted').length
  const filteredProjects = form.clientId ? projects.filter(p => p.clientId === form.clientId) : projects
  const expTone = (e: Estimate) => { const d = daysTo(e.expiryDate); return d !== null && (e.status === 'sent' || e.status === 'draft') && d <= 3 ? (d < 0 ? 't-danger' : 't-warning') : 'muted' }
  const menu = (e: Estimate) => [{ label: 'Edit', onClick: () => openEdit(e) }, 'sep' as const, { label: 'Delete estimate', danger: true, onClick: () => setConfirmDelete(e) }]
  const toInvoiceBtn = (e: Estimate, big?: boolean) => e.status === 'accepted' && canInvoice
    ? <button type="button" className={`btn btn--soft-gold ${big ? 'btn--block' : 'btn--xs'}`} disabled={converting === e.id} onClick={ev => { ev.stopPropagation(); void convertToInvoice(e) }}>{converting === e.id ? 'Creating…' : big ? 'Convert to invoice' : '→ Invoice'}</button>
    : null

  return (
    <div className="page crm-page">
      <PageHeader title="Estimates" sub={`${estimates.length} estimate${estimates.length === 1 ? '' : 's'} · ${usd(totalValue, { cents: false })} total · ${acceptedCount} accepted`}
        actions={<>
          <SearchInput value={filterSearch} onChange={setFilterSearch} placeholder="Search client or #" width={mobile ? '100%' : 220} />
          <button type="button" className="btn btn--primary" onClick={openNew}>+ New estimate</button>
        </>} />
      <Tabs label="Estimate status" value={filterStatus} onChange={setFilterStatus} tabs={[
        { value: 'all', label: 'All', count: searched.length },
        ...STATUSES.map(s => ({ value: s, label: label(s), count: searched.filter(e => e.status === s).length })),
      ]} />

      {loading ? (
        <div className="table-card crm-skel">{[0, 1, 2, 3].map(i => <div key={i} className="crm-skel__row"><Skel w={90} /><Skel w="25%" /><Skel w="20%" /><Skel w={80} /></div>)}</div>
      ) : filtered.length === 0 ? (
        <div className="card card-empty">{estimates.length === 0 ? 'No estimates yet. Create your first estimate.' : 'No estimates match the current filters.'}</div>
      ) : mobile ? (
        <div className="mcards">
          {filtered.map(e => (
            <div key={e.id} className="mcard" role="button" tabIndex={0} onClick={() => openEdit(e)}>
              <div className="mcard__top"><span className="mcard__title">{e.clientName ?? 'No client'}</span><span className="num crm-td-strong">{usd(e.total)}</span></div>
              <div className="mcard__top"><span className="mcard__meta"><span className="mono">{e.number}</span>{e.expiryDate ? ` · expires ${dateShort(e.expiryDate)}` : ''}</span><Pill tone={STATUS_TONE[e.status]} status={e.status} /></div>
              {toInvoiceBtn(e, true)}
            </div>
          ))}
        </div>
      ) : (
        <div className="table-card">
          <table className="table crm-est-table">
            <thead><tr><th>#</th><th>Client</th><th>Project</th><th>Date</th><th>Expires</th><th className="t-right">Total</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id} className="is-clickable" onClick={() => openEdit(e)}>
                  <td className="mono crm-td-mono">{e.number}</td>
                  <td className="crm-td-strong">{e.clientName ?? <span className="soft">—</span>}</td>
                  <td className="muted">{e.projectName ?? '—'}</td>
                  <td className="muted">{dateShort(e.date)}</td>
                  <td className={expTone(e)}>{e.expiryDate ? dateShort(e.expiryDate) : '—'}</td>
                  <td className="t-num crm-td-strong">{usd(e.total)}</td>
                  <td><Pill tone={STATUS_TONE[e.status]} status={e.status} /></td>
                  <td className="t-actions" onClick={ev => ev.stopPropagation()}>
                    <span className="crm-row-actions">{toInvoiceBtn(e)}<button type="button" className="btn btn--xs" onClick={() => openEdit(e)}>Edit</button><Menu items={menu(e)} label={`Actions for ${e.number}`} buttonClass="btn btn--icon btn--ghost btn--xs" /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={panel.open} onClose={closePanel} size="wide" title={panel.editing ? `Estimate ${panel.editing.number}` : 'New estimate'}
        footer={<>
          {panel.editing && <button type="button" className="btn btn--ghost btn--danger" onClick={() => { const e = panel.editing!; closePanel(); setConfirmDelete(e) }}>Delete</button>}
          <span className="spacer" />
          <button type="button" className="btn" disabled={saving || !form.number.trim()} onClick={() => void handleSave(false)}>{!panel.editing && form.status === 'draft' ? 'Save draft' : 'Save'}</button>
          <button type="button" className="btn btn--primary" disabled={saving || !form.number.trim()} title="Saves, marks a draft as Sent and emails the estimate to the client" onClick={() => void handleSave(true)}>{saving ? 'Saving…' : 'Save & send'}</button>
        </>}>
        <div className="form-grid crm-est-head">
          <Field label="Estimate #"><input className="input mono" aria-label="Estimate number" value={form.number} onChange={e => setField('number', e.target.value)} placeholder="EST-001" /></Field>
          <Field label="Date"><input className="input" type="date" aria-label="Date" value={form.date} onChange={e => setField('date', e.target.value)} /></Field>
          <Field label="Expires"><input className="input" type="date" aria-label="Expiry date" value={form.expiryDate} onChange={e => setField('expiryDate', e.target.value)} /></Field>
          <Field label="Status"><select className="select" aria-label="Status" value={form.status} onChange={e => setField('status', e.target.value as EstimateStatus)}>{STATUSES.map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
          <Field label="Client"><select className="select" aria-label="Client" value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value, projectId: '' }))}>
            <option value="">— No client —</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Project"><select className="select" aria-label="Project" value={form.projectId} onChange={e => setField('projectId', e.target.value)}>
            <option value="">— No project —</option>{filteredProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <div className="crm-lines">
          <div className="crm-lines__row crm-lines__row--head"><span>Item</span><span className="t-right">Qty</span><span className="t-right">Rate</span><span className="t-right">Amount</span><span /></div>
          {form.items.map((item, idx) => (
            <div key={idx} className="crm-lines__row">
              <input className="input input--sm" aria-label={`Line ${idx + 1} description`} value={item.description} onChange={e => setItemField(idx, 'description', e.target.value)} placeholder="Description…" />
              <input className="input input--sm crm-num-input" aria-label={`Line ${idx + 1} quantity`} type="number" min="0" step="1" value={item.qty} onChange={e => setItemField(idx, 'qty', parseFloat(e.target.value) || 0)} />
              <input className="input input--sm crm-num-input" aria-label={`Line ${idx + 1} rate`} type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => setItemField(idx, 'unitPrice', parseFloat(e.target.value) || 0)} />
              <span className="num crm-td-strong t-right crm-lines__amt">{usd(item.qty * item.unitPrice)}</span>
              <button type="button" className="btn btn--ghost btn--xs" aria-label={`Remove line ${idx + 1}`} disabled={form.items.length <= 1} onClick={() => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))}><Ic d={P.x} size={14} /></button>
            </div>
          ))}
          <div className="crm-lines__foot">
            <button type="button" className="link" onClick={() => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))}>+ Add line</button>
            <span className="crm-lines__total">Total <span className="num">{usd(calcTotal(form.items))}</span></span>
          </div>
        </div>
        <Field label="Notes"><textarea className="textarea" rows={3} aria-label="Notes" value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Optional notes or terms..." /></Field>
      </Drawer>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete estimate?" sub={`${confirmDelete?.number ?? ''} · This cannot be undone.`}
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button><button type="button" className="btn btn--danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Delete</button></>} />
    </div>
  )
}
