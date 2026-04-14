import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { ActivityLogEntry, Client, ClientDocument, CommEntryType, Contract, ContractStatus, Invoice, Project } from '../data/types'
import { loadSnapshot, saveClients, loadActivityLog, saveActivityLog, loadSettings, loadClientDocuments, addClientDocument, removeClientDocument } from '../services/storage'
import { sendEmail } from '../services/gmail'
import { uploadFile, deleteFile } from '../services/fileStorage'
import { supabase } from '../lib/supabase'

function uid() { return crypto.randomUUID() }

const AVATAR_COLORS = ['#f5b533','#3b82f6','#22c55e','#a855f7','#14b8a6','#f97316','#ec4899']
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function stageBadge(s?: string): string {
  switch ((s || 'lead').toLowerCase()) {
    case 'active':   return 'badge-green'
    case 'prospect': return 'badge-yellow'
    case 'paused':   return 'badge-gray'
    case 'churned':  return 'badge-red'
    default:         return 'badge-blue'
  }
}
function statusBadge(s: string): string { return stageBadge(s) }
function fmtTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const STAGES = [
  { key: 'lead', label: 'Lead' }, { key: 'prospect', label: 'Prospect' },
  { key: 'active', label: 'Active' }, { key: 'paused', label: 'Paused' }, { key: 'churned', label: 'Churned' },
]

type LinkEntry = { label: string; url: string }

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [clients,  setClientsState] = useState<Client[]>([])
  const [invoices, setInvoices]     = useState<Invoice[]>([])
  const [projects, setProjects]     = useState<Project[]>([])
  useEffect(() => {
    loadSnapshot().then(snap => {
      setClientsState(snap.clients)
      setInvoices(snap.invoices)
      setProjects(snap.projects)
    })
    loadActivityLog().then(all => {
      setActivityLog(all.filter(e => e.clientId === id).sort((a, b) => b.createdAt - a.createdAt))
    })
    if (id) loadClientDocuments(id).then(setClientDocs)
  }, [id])

  const client = clients.find(c => c.id === id)

  const [editing, setEditing]     = useState(false)
  const [form, setForm]           = useState({
    name: '', company: '', email: '', phone: '', address: '',
    timezone: '', defaultRate: '', paymentTerms: '', tags: '',
    notes: '', status: 'active', contractEnd: '', links: [] as LinkEntry[],
  })
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [newLinkUrl,   setNewLinkUrl]   = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Activity log
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [activityNote, setActivityNote] = useState('')
  const [activityType, setActivityType] = useState<CommEntryType>('note')

  // Portal invite
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteMsg,     setInviteMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  // Contracts
  const [contractPanelOpen, setContractPanelOpen] = useState(false)
  const [contractEditId, setContractEditId] = useState<string | null>(null)
  const [contractForm, setContractForm] = useState({
    title: '', status: 'draft' as ContractStatus,
    startDate: '', endDate: '', value: '', notes: '',
  })
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [contractUploading, setContractUploading] = useState(false)
  const contractFileRef = useRef<HTMLInputElement>(null)

  // Shared documents (portal-visible)
  const [clientDocs,      setClientDocs]      = useState<ClientDocument[]>([])
  const [docCategory,     setDocCategory]     = useState<ClientDocument['category']>('other')
  const [docFile,         setDocFile]         = useState<File | null>(null)
  const [docUploading,    setDocUploading]    = useState(false)
  const [docError,        setDocError]        = useState<string | null>(null)
  const docFileRef = useRef<HTMLInputElement>(null)

  // Sync form/photo from client once data loads
  useEffect(() => {
    if (client && !editing) {
      setForm({
        name:         client.name ?? '',
        company:      client.company ?? '',
        email:        client.email ?? '',
        phone:        client.phone ?? '',
        address:      client.address ?? '',
        timezone:     client.timezone ?? '',
        defaultRate:  client.defaultRate != null ? String(client.defaultRate) : '',
        paymentTerms: client.paymentTerms ?? '',
        tags:         Array.isArray(client.tags) ? client.tags.join(', ') : (client.tags ?? ''),
        notes:        client.notes ?? '',
        status:       client.status ?? 'active',
        contractEnd:  client.contractEnd ?? '',
        links:        (client.links ?? []) as LinkEntry[],
      })
      setPhotoUrl(client.photoUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id])

  if (!client) {
    return (
      <div className="page-wrap">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          Client not found.
          <br /><button className="btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/clients')}>← Back to Clients</button>
        </div>
      </div>
    )
  }

  // client is guaranteed non-null here (early return above handles null case)
  const clientNN = client!

  // Computed
  const clientInvoices = invoices.filter(inv => inv.clientName === clientNN.name)
  const totalRevenue   = clientInvoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
  const outstanding    = clientInvoices
    .filter(inv => new Set(['sent','viewed','overdue','partial']).has((inv.status||'').toLowerCase()))
    .reduce((s, inv) => s + ((Number(inv.subtotal)||0) - (Number(inv.amountPaid)||0)), 0)
  const clientProjects = projects.filter(p => p.clientId === clientNN.id)

  function persistUpdate(updated: Client) {
    const next = clients.map(c => c.id === updated.id ? updated : c)
    setClientsState(next)
    void saveClients(next)
  }

  function handleSave() {
    if (!form.name.trim()) return
    const updated: Client = {
      ...clientNN,
      name: form.name,
      company: form.company || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      timezone: form.timezone || undefined,
      defaultRate: form.defaultRate ? Number(form.defaultRate) : undefined,
      paymentTerms: form.paymentTerms || undefined,
      tags: form.tags ? form.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined,
      notes: form.notes || undefined,
      status: form.status,
      contractEnd: form.contractEnd || undefined,
      links: form.links.length > 0 ? form.links : undefined,
      photoUrl,
    }
    persistUpdate(updated)
    setEditing(false)
  }

  function handlePhotoUpload(file: File) {
    if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return }
    if (file.size > 5 * 1024 * 1024) { alert('Image too large (max 5 MB).'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const url = ev.target?.result as string
      setPhotoUrl(url)
      persistUpdate({ ...clientNN, photoUrl: url })
    }
    reader.readAsDataURL(file)
  }

  function handleCancel() {
    setForm({
      name: clientNN.name,
      company: clientNN.company ?? '',
      email: clientNN.email ?? '',
      phone: clientNN.phone ?? '',
      address: clientNN.address ?? '',
      timezone: clientNN.timezone ?? '',
      defaultRate: clientNN.defaultRate != null ? String(clientNN.defaultRate) : '',
      paymentTerms: clientNN.paymentTerms ?? '',
      tags: Array.isArray(clientNN.tags) ? clientNN.tags.join(', ') : (clientNN.tags ?? ''),
      notes: clientNN.notes ?? '',
      status: clientNN.status ?? 'active',
      contractEnd: clientNN.contractEnd ?? '',
      links: clientNN.links ?? [],
    })
    setEditing(false)
  }

  function handleDelete() {
    const next = clients.filter(c => c.id !== clientNN.id)
    setClientsState(next)
    void saveClients(next)
    navigate('/clients')
  }

  function addLink() {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return
    setForm(f => ({ ...f, links: [...f.links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] }))
    setNewLinkLabel(''); setNewLinkUrl('')
  }
  function removeLink(i: number) {
    setForm(f => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }))
  }

  function addActivity() {
    if (!activityNote.trim()) return
    const entry: ActivityLogEntry = {
      id: uid(), clientId: clientNN.id, note: activityNote.trim(),
      createdAt: Date.now(), type: activityType, auto: false,
    }
    loadActivityLog().then(all => {
      void saveActivityLog([entry, ...all])
      setActivityLog([entry, ...activityLog])
      setActivityNote('')
    })
  }
  function deleteActivity(entryId: string) {
    loadActivityLog().then(all => {
      void saveActivityLog(all.filter(e => e.id !== entryId))
      setActivityLog(activityLog.filter(e => e.id !== entryId))
    })
  }

  function contractStatusBadge(s: ContractStatus): string {
    switch (s) {
      case 'active':     return 'badge-green'
      case 'expired':    return 'badge-orange'
      case 'terminated': return 'badge-red'
      default:           return 'badge-gray'
    }
  }

  function openAddContractPanel() {
    setContractEditId(null)
    setContractForm({ title: '', status: 'draft', startDate: '', endDate: '', value: '', notes: '' })
    setContractFile(null)
    setContractPanelOpen(true)
  }

  function openEditContractPanel(contract: Contract) {
    setContractEditId(contract.id)
    setContractForm({
      title:     contract.title,
      status:    contract.status,
      startDate: contract.startDate ?? '',
      endDate:   contract.endDate ?? '',
      value:     contract.value != null ? String(contract.value) : '',
      notes:     contract.notes ?? '',
    })
    setContractFile(null)
    setContractPanelOpen(true)
  }

  async function saveContract() {
    if (!contractForm.title.trim()) return
    setContractUploading(true)
    try {
      let fileUrl: string | undefined
      let filePath: string | undefined
      let fileName: string | undefined

      if (contractFile) {
        const result = await uploadFile(contractFile, `contracts/clients/${clientNN.id}`)
        fileUrl  = result.storageUrl
        filePath = result.storagePath
        fileName = contractFile.name
      }

      const existingContracts: Contract[] = clientNN.contracts ?? []

      let updatedContracts: Contract[]
      if (contractEditId) {
        updatedContracts = existingContracts.map(c => {
          if (c.id !== contractEditId) return c
          return {
            ...c,
            title:     contractForm.title.trim(),
            status:    contractForm.status,
            startDate: contractForm.startDate || undefined,
            endDate:   contractForm.endDate || undefined,
            value:     contractForm.value ? Number(contractForm.value) : undefined,
            notes:     contractForm.notes || undefined,
            ...(fileUrl ? { fileUrl, filePath, fileName } : {}),
          }
        })
      } else {
        const newContract: Contract = {
          id:        crypto.randomUUID(),
          title:     contractForm.title.trim(),
          status:    contractForm.status,
          startDate: contractForm.startDate || undefined,
          endDate:   contractForm.endDate || undefined,
          value:     contractForm.value ? Number(contractForm.value) : undefined,
          notes:     contractForm.notes || undefined,
          fileUrl,
          filePath,
          fileName,
          createdAt: Date.now(),
        }
        updatedContracts = [newContract, ...existingContracts]
      }

      persistUpdate({ ...clientNN, contracts: updatedContracts })
      setContractPanelOpen(false)
    } finally {
      setContractUploading(false)
    }
  }

  async function deleteContract(contract: Contract) {
    if (contract.filePath) {
      await deleteFile(contract.filePath).catch(() => {/* ignore */})
    }
    const updatedContracts = (clientNN.contracts ?? []).filter(c => c.id !== contract.id)
    persistUpdate({ ...clientNN, contracts: updatedContracts })
  }

  async function uploadClientDoc() {
    if (!docFile || !clientNN) return
    setDocUploading(true)
    setDocError(null)
    try {
      const { storageUrl, storagePath } = await uploadFile(docFile, `client-docs/${clientNN.id}`)
      const { data: { user } } = await supabase.auth.getUser()
      const doc: ClientDocument = {
        id:         uid(),
        clientId:   clientNN.id,
        name:       docFile.name,
        category:   docCategory,
        fileUrl:    storageUrl,
        filePath:   storagePath,
        fileSize:   docFile.size,
        uploadedAt: Date.now(),
        uploadedBy: user?.email ?? 'YVA Team',
      }
      await addClientDocument(doc)
      setClientDocs(prev => [doc, ...prev])
      setDocFile(null)
      setDocCategory('other')
      if (docFileRef.current) docFileRef.current.value = ''
    } catch (err) {
      console.error('Doc upload failed:', err)
      setDocError(err instanceof Error ? err.message : 'Upload failed. Make sure the client_documents table exists in Supabase.')
    } finally {
      setDocUploading(false)
    }
  }

  async function deleteClientDoc(doc: ClientDocument) {
    await removeClientDocument(doc.id)
    await deleteFile(doc.filePath).catch(() => {/* ignore */})
    setClientDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  async function sendPortalInvite() {
    if (!clientNN.email) { setInviteMsg({ ok: false, text: 'Add an email address to this client before inviting.' }); return }
    setInviteLoading(true)
    setInviteMsg(null)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setInviteLoading(false); setInviteMsg({ ok: false, text: 'You must be logged in.' }); return }

    try {
      const res = await fetch('/.netlify/functions/invite-client', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ clientId: clientNN.id, email: clientNN.email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInviteMsg({ ok: false, text: data.error || 'Failed to send invitation.' })
      } else {
        setInviteMsg({ ok: true, text: `Invitation sent to ${clientNN.email}` })
      }
    } catch {
      setInviteMsg({ ok: false, text: 'Network error — could not send invitation.' })
    } finally {
      setInviteLoading(false)
    }
  }

  async function sendReminder() {
    const settings = await loadSettings()
    const unpaidInvs = clientInvoices.filter(inv =>
      new Set(['sent','viewed','overdue','partial']).has((inv.status||'').toLowerCase()))
    if (unpaidInvs.length === 0) return
    const totalOwed = unpaidInvs.reduce((s, inv) => s + ((Number(inv.subtotal)||0) - (Number(inv.amountPaid)||0)), 0)
    const companyName = settings.companyName || 'YVA Staffing'
    const invoiceList = unpaidInvs.map(inv => `  • ${inv.number} — $${(Number(inv.subtotal)||0).toFixed(2)}`).join('\n')
    let bodyText: string
    if (settings.reminderEmailTemplate) {
      bodyText = settings.reminderEmailTemplate
        .replace(/\{clientName\}/g, clientNN.name)
        .replace(/\{invoiceNumber\}/g, unpaidInvs.length === 1 ? unpaidInvs[0].number : `${unpaidInvs.length} invoices`)
        .replace(/\{amount\}/g, `$${totalOwed.toFixed(2)}`)
        .replace(/\{dueDate\}/g, unpaidInvs[0]?.dueDate || '')
        .replace(/\{companyName\}/g, companyName)
    } else {
      bodyText = `Hi ${clientNN.name},\n\nThis is a friendly reminder that you have ${unpaidInvs.length === 1 ? 'an outstanding invoice' : `${unpaidInvs.length} outstanding invoices`} totaling $${totalOwed.toFixed(2)}:\n\n${invoiceList}\n\nPlease let us know when we can expect payment.\n\n${settings.emailSignature || companyName}`
    }
    const subject = `Outstanding Balance Reminder — ${companyName}`
    sendEmail(clientNN.email || '', subject, bodyText)
  }

  const color = avatarColor(clientNN.name)

  return (
    <div className="page-wrap" style={{ maxWidth: 980 }}>
      <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }} />

      <button className="btn-ghost btn-sm" style={{ marginBottom: 16 }} onClick={() => navigate('/clients')}>
        ← Back to Clients
      </button>

      {/* Header */}
      <div className="profile-header">
        <div className="profile-header-left">
          <div className="avatar-wrap" title="Click to change photo" onClick={() => photoInputRef.current?.click()}>
            {photoUrl
              ? <img className="avatar-photo" src={photoUrl} alt={clientNN.name} />
              : <div className="avatar profile-avatar" style={{ background: color }}>{initials(clientNN.name)}</div>
            }
            <span className="avatar-cam">📷</span>
          </div>
          <div>
            {editing
              ? <input className="form-input profile-name-input" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
              : <h1 className="profile-name">{clientNN.name}</h1>
            }
            <div className="profile-sub">
              {clientNN.company && <span style={{ color: 'var(--muted)' }}>{clientNN.company}</span>}
              {clientNN.company && clientNN.email && <span style={{ color: 'var(--muted)' }}> · </span>}
              {clientNN.email && <span style={{ color: 'var(--muted)' }}>{clientNN.email}</span>}
            </div>
          </div>
        </div>
        <div className="profile-header-actions">
          {editing ? (
            <>
              <button className="btn-primary btn-sm" onClick={handleSave} disabled={!form.name.trim()}>Save Changes</button>
              <button className="btn-ghost btn-sm" onClick={handleCancel}>Cancel</button>
            </>
          ) : (
            <>
              <span className={`badge ${statusBadge(clientNN.status || 'lead')}`} style={{ fontSize: 13 }}>{clientNN.status || 'Lead'}</span>
              {outstanding > 0 && clientNN.email && (
                <button className="btn-ghost btn-sm" style={{ color: '#fb923c' }} onClick={sendReminder}>✉ Remind</button>
              )}
              <button
                className="btn-ghost btn-sm"
                onClick={sendPortalInvite}
                disabled={inviteLoading}
                title="Send client portal invitation email"
                style={{ color: 'var(--gold)', borderColor: 'rgba(250,204,21,0.3)' }}
              >
                {inviteLoading ? 'Sending…' : '🔑 Invite to Portal'}
              </button>
              <button
                className="btn-ghost btn-sm"
                onClick={() => window.open(`${import.meta.env.BASE_URL}portal/dashboard?preview=${clientNN.id}`, '_blank')}
                title="Preview this client's portal view"
                style={{ color: '#60a5fa', borderColor: 'rgba(96,165,250,0.3)' }}
              >
                👁 Preview Portal
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit Profile</button>
              <button className="btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>
            </>
          )}
          {inviteMsg && (
            <div style={{
              marginTop: 8, fontSize: 12, padding: '6px 12px', borderRadius: 8,
              background: inviteMsg.ok ? 'rgba(34,197,94,.1)' : 'rgba(239,68,68,.1)',
              color: inviteMsg.ok ? '#15803d' : '#ef4444',
              border: `1px solid ${inviteMsg.ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
            }}>
              {inviteMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* KPI row */}
      {!editing && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Total Revenue', value: `$${(totalRevenue/1000).toFixed(1)}k`, color: 'var(--gold)' },
            { label: 'Invoices', value: String(clientInvoices.length), color: 'var(--text)' },
            { label: 'Outstanding', value: outstanding > 0 ? `$${outstanding.toFixed(2)}` : '$0', color: outstanding > 0 ? '#f87171' : 'var(--success)' },
            { label: 'Projects', value: String(clientProjects.length), color: '#60a5fa' },
          ].map(({ label, value, color: c }) => (
            <div key={label} className="settings-stat-card">
              <div className="settings-stat-count" style={{ color: c, fontSize: 18 }}>{value}</div>
              <div className="settings-stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="profile-grid">
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Info */}
          <div className="data-card">
            <div className="data-card-title">Client Information</div>
            <div className="profile-fields">
              {editing ? (
                <>
                  <div className="profile-field">
                    <span className="profile-field-label">Company</span>
                    <input className="form-input form-input-sm" value={form.company} onChange={e => setForm(f => ({...f, company: e.target.value}))} placeholder="Legal entity name" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Stage</span>
                    <select className="form-select form-input-sm" value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))}>
                      {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Email</span>
                    <input className="form-input form-input-sm" type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Phone</span>
                    <input className="form-input form-input-sm" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Billing Address</span>
                    <input className="form-input form-input-sm" value={form.address} onChange={e => setForm(f => ({...f, address: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Timezone</span>
                    <input className="form-input form-input-sm" value={form.timezone} onChange={e => setForm(f => ({...f, timezone: e.target.value}))} placeholder="EST / PST" />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Default Rate ($/hr)</span>
                    <input className="form-input form-input-sm" type="number" value={form.defaultRate} onChange={e => setForm(f => ({...f, defaultRate: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Payment Terms</span>
                    <select className="form-select form-input-sm" value={form.paymentTerms} onChange={e => setForm(f => ({...f, paymentTerms: e.target.value}))}>
                      <option value="">— Not set —</option>
                      <option>On receipt</option><option>Net 7</option><option>Net 15</option><option>Net 30</option>
                    </select>
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Contract End</span>
                    <input className="form-input form-input-sm" type="date" value={form.contractEnd} onChange={e => setForm(f => ({...f, contractEnd: e.target.value}))} />
                  </div>
                  <div className="profile-field">
                    <span className="profile-field-label">Tags</span>
                    <input className="form-input form-input-sm" value={form.tags} onChange={e => setForm(f => ({...f, tags: e.target.value}))} placeholder="Law firm, US, High priority" />
                  </div>
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Notes</span>
                    <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} />
                  </div>
                  {/* Links edit */}
                  <div className="profile-field profile-field-tall">
                    <span className="profile-field-label">Links</span>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {form.links.map((lk, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <a href={lk.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, fontSize: 12, color: 'var(--gold)' }}>{lk.label}</a>
                          <button className="btn-icon btn-danger" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => removeLink(i)}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input className="form-input form-input-sm" value={newLinkLabel} onChange={e => setNewLinkLabel(e.target.value)} placeholder="Label" style={{ flex: 1 }} />
                        <input className="form-input form-input-sm" value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..." style={{ flex: 2 }} />
                        <button className="btn-ghost btn-sm" onClick={addLink} disabled={!newLinkLabel.trim() || !newLinkUrl.trim()}>+ Add</button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {[
                    { label: 'Company',         value: clientNN.company },
                    { label: 'Stage',           value: clientNN.status || 'Lead' },
                    { label: 'Email',           value: clientNN.email },
                    { label: 'Phone',           value: clientNN.phone },
                    { label: 'Address',         value: clientNN.address },
                    { label: 'Timezone',        value: clientNN.timezone },
                    { label: 'Default Rate',    value: clientNN.defaultRate ? `$${clientNN.defaultRate}/hr` : undefined },
                    { label: 'Payment Terms',   value: clientNN.paymentTerms },
                    { label: 'Contract End',    value: clientNN.contractEnd },
                    { label: 'Tags',            value: clientNN.tags },
                  ].map(({ label, value }) => value ? (
                    <div key={label} className="profile-field">
                      <span className="profile-field-label">{label}</span>
                      <span className="profile-field-value">{value}</span>
                    </div>
                  ) : null)}
                  {clientNN.notes && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Notes</span>
                      <span className="profile-field-value" style={{ whiteSpace: 'pre-wrap' }}>{clientNN.notes}</span>
                    </div>
                  )}
                  {(clientNN.links ?? []).length > 0 && (
                    <div className="profile-field profile-field-tall">
                      <span className="profile-field-label">Links</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {(clientNN.links ?? []).map((lk, i) => (
                          <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="card-link-pill">{lk.label}</a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Projects */}
          {clientProjects.length > 0 && (
            <div className="data-card">
              <div className="data-card-title">Projects</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                {clientProjects.map(p => (
                  <button key={p.id} className="btn-ghost btn-sm" onClick={() => navigate('/projects/' + p.id)} style={{ fontSize: 12 }}>
                    {p.name}
                    {p.status && <span style={{ marginLeft: 6, color: 'var(--muted)', fontSize: 11 }}>{p.status}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Invoice history */}
          {clientInvoices.length > 0 && (
            <div className="data-card">
              <div className="data-card-title">Invoice History</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
                  <tbody>
                    {clientInvoices.slice(0, 10).map(inv => (
                      <tr key={inv.id}>
                        <td className="td-name">{inv.number}</td>
                        <td className="td-muted">{inv.date || '—'}</td>
                        <td><span className="badge badge-gray" style={{ fontSize: 11 }}>{inv.status || 'draft'}</span></td>
                        <td style={{ color: 'var(--gold)', fontWeight: 700 }}>${(Number(inv.subtotal)||0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right — Comms Hub */}
        <div className="data-card" style={{ alignSelf: 'start' }}>
          <div className="data-card-title">Communications</div>

          {/* Type selector + input */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {(['note','call','email','meeting'] as CommEntryType[]).map(t => {
              const icons: Record<string, string> = { note: '💬', call: '📞', email: '📧', meeting: '🤝' }
              const active = activityType === t
              return (
                <button key={t} onClick={() => setActivityType(t)} style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                  border: active ? '1.5px solid var(--gold)' : '1.5px solid var(--border)',
                  background: active ? 'rgba(250,204,21,.12)' : 'transparent',
                  color: active ? 'var(--goldd)' : 'var(--muted)',
                }}>
                  {icons[t]} {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              className="form-input"
              style={{ flex: 1 }}
              value={activityNote}
              onChange={e => setActivityNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addActivity() } }}
              placeholder={
                activityType === 'call' ? 'Call summary...' :
                activityType === 'email' ? 'Email summary...' :
                activityType === 'meeting' ? 'Meeting notes...' :
                'Add a note...'
              }
            />
            <button className="btn-primary btn-sm" onClick={addActivity} disabled={!activityNote.trim()}>Log</button>
          </div>

          {/* Timeline */}
          {activityLog.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
              No communications yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {activityLog.map((entry, idx) => {
                const type = entry.type || 'note'
                const cfg: Record<string, { icon: string; color: string; bg: string }> = {
                  note:    { icon: '💬', color: '#64748b', bg: '#f8fafc' },
                  call:    { icon: '📞', color: '#3b82f6', bg: '#eff6ff' },
                  email:   { icon: '📧', color: '#a16207', bg: '#fefce8' },
                  meeting: { icon: '🤝', color: '#7e22ce', bg: '#faf5ff' },
                  system:  { icon: '⚡', color: '#15803d', bg: '#f0fdf4' },
                }
                const c = cfg[type] || cfg.note
                return (
                  <div key={entry.id} style={{
                    display: 'flex', gap: 10, paddingBottom: 12,
                    borderLeft: idx < activityLog.length - 1 ? '2px solid var(--border)' : '2px solid transparent',
                    marginLeft: 10, paddingLeft: 14, position: 'relative',
                  }}>
                    {/* Dot */}
                    <div style={{
                      position: 'absolute', left: -9, top: 2, width: 16, height: 16,
                      borderRadius: '50%', background: c.bg, border: `2px solid ${c.color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, flexShrink: 0,
                    }}>
                      {c.icon.slice(0, 2)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{entry.note}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: c.color, fontWeight: 600, background: c.bg, borderRadius: 4, padding: '1px 6px' }}>
                          {type === 'system' ? 'Auto' : type.charAt(0).toUpperCase() + type.slice(1)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtTimestamp(entry.createdAt)}</span>
                      </div>
                    </div>
                    {!entry.auto && (
                      <button className="btn-icon" style={{ fontSize: 12, color: 'var(--muted)', padding: '2px 5px', alignSelf: 'flex-start' }}
                        onClick={() => deleteActivity(entry.id)}>×</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Contracts */}
      <div className="data-card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="data-card-title" style={{ marginBottom: 0 }}>Contracts</div>
          <button className="btn-primary btn-sm" onClick={openAddContractPanel}>+ Add Contract</button>
        </div>
        {(clientNN.contracts ?? []).length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
            No contracts yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Date Range</th>
                  <th>Value</th>
                  <th>Notes</th>
                  <th>File</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(clientNN.contracts ?? []).map(c => (
                  <tr key={c.id}>
                    <td className="td-name">{c.title}</td>
                    <td>
                      <span className={`badge ${contractStatusBadge(c.status)}`} style={{ fontSize: 11 }}>
                        {c.status}
                      </span>
                    </td>
                    <td className="td-muted" style={{ fontSize: 12 }}>
                      {c.startDate || c.endDate
                        ? `${c.startDate || '—'} → ${c.endDate || '—'}`
                        : '—'}
                    </td>
                    <td style={{ color: 'var(--gold)', fontWeight: 700 }}>
                      {c.value != null ? `$${c.value.toLocaleString()}` : '—'}
                    </td>
                    <td className="td-muted" style={{ fontSize: 12, maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.notes || '—'}
                    </td>
                    <td>
                      {c.fileUrl
                        ? <a href={c.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--gold)' }}>{c.fileName || 'Download'}</a>
                        : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                      }
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn-ghost btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => openEditContractPanel(c)}>Edit</button>
                        <button className="btn-icon btn-danger" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => { if (window.confirm(`Delete contract "${c.title}"?`)) deleteContract(c) }}>×</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Shared Documents (portal-visible) */}
      <div className="data-card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div className="data-card-title" style={{ marginBottom: 2 }}>Shared Documents</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Visible to this client in their portal</div>
          </div>
        </div>

        {/* Upload row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '12px 14px', background: 'var(--surf2)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <input
            ref={docFileRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            style={{ display: 'none' }}
            onChange={e => setDocFile(e.target.files?.[0] ?? null)}
          />
          <button className="btn-ghost btn-sm" onClick={() => docFileRef.current?.click()} style={{ fontSize: 12 }}>
            Choose File
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {docFile ? docFile.name : 'No file selected'}
          </span>
          <select
            value={docCategory}
            onChange={e => setDocCategory(e.target.value as ClientDocument['category'])}
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
          >
            <option value="contract">Contract</option>
            <option value="nda">NDA</option>
            <option value="report">Report</option>
            <option value="invoice">Invoice</option>
            <option value="other">Other</option>
          </select>
          <button
            className="btn-primary btn-sm"
            onClick={() => void uploadClientDoc()}
            disabled={!docFile || docUploading}
            style={{ fontSize: 12, whiteSpace: 'nowrap' }}
          >
            {docUploading ? 'Uploading…' : 'Share'}
          </button>
        </div>

        {docError && (
          <div style={{ fontSize: 12, color: '#ef4444', padding: '8px 12px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, marginBottom: 10 }}>
            {docError}
          </div>
        )}

        {clientDocs.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
            No documents shared yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clientDocs.map(doc => (
              <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--surf2)', borderRadius: 9, border: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {doc.category.toUpperCase()} · {new Date(doc.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ''}
                  </div>
                </div>
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--gold)', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>
                  View
                </a>
                <button
                  className="btn-icon btn-danger"
                  style={{ fontSize: 11, padding: '2px 6px', flexShrink: 0 }}
                  onClick={() => { if (window.confirm(`Remove "${doc.name}"?`)) void deleteClientDoc(doc) }}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contract slide panel */}
      {contractPanelOpen && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 299 }}
            onClick={() => setContractPanelOpen(false)}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 460, height: '100%',
            background: '#fff', zIndex: 300, display: 'flex', flexDirection: 'column',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
                {contractEditId ? 'Edit Contract' : 'Add Contract'}
              </div>
              <button className="btn-icon" style={{ fontSize: 18, color: 'var(--muted)' }} onClick={() => setContractPanelOpen(false)}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Title *</label>
                <input
                  className="form-input"
                  value={contractForm.title}
                  onChange={e => setContractForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Service Agreement 2026"
                  autoFocus
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Status</label>
                <select
                  className="form-select"
                  value={contractForm.status}
                  onChange={e => setContractForm(f => ({ ...f, status: e.target.value as ContractStatus }))}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Start Date</label>
                  <input
                    className="form-input"
                    type="date"
                    value={contractForm.startDate}
                    onChange={e => setContractForm(f => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>End Date</label>
                  <input
                    className="form-input"
                    type="date"
                    value={contractForm.endDate}
                    onChange={e => setContractForm(f => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Contract Value (USD)</label>
                <input
                  className="form-input"
                  type="number"
                  value={contractForm.value}
                  onChange={e => setContractForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notes</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={contractForm.notes}
                  onChange={e => setContractForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional notes about this contract..."
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>
                  File Upload (.pdf, .doc, .docx)
                </label>
                <input
                  ref={contractFileRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  style={{ display: 'none' }}
                  onChange={e => setContractFile(e.target.files?.[0] ?? null)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn-ghost btn-sm" onClick={() => contractFileRef.current?.click()}>
                    Choose File
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {contractFile ? contractFile.name : 'No file selected'}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setContractPanelOpen(false)}>Cancel</button>
              <button
                className="btn-primary"
                onClick={saveContract}
                disabled={!contractForm.title.trim() || contractUploading}
              >
                {contractUploading ? 'Saving...' : (contractEditId ? 'Save Changes' : 'Add Contract')}
              </button>
            </div>
          </div>
        </>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete {clientNN.name}?</div>
            <div className="confirm-body">This cannot be undone.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
