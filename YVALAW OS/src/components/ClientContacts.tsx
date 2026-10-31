import { useEffect, useState } from 'react'
import { deleteContact, loadContacts, saveContact, type Contact } from '../services/crm'

const blank = (clientId: string): Partial<Contact> & { client_id: string; name: string } => ({ client_id: clientId, name: '', role: '', email: '', phone: '', whatsapp: '', is_billing: false })

/** Client profile → Contacts: the people at the firm (Step 9) */
export default function ClientContacts({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Contact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<(Partial<Contact> & { client_id: string; name: string }) | null>(null)
  const load = async () => { const r = await loadContacts(clientId); setRows(r.rows); setError(r.error) }
  useEffect(() => { void load() }, [clientId])   // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!form || !form.name.trim()) return
    try { await saveContact(form); setForm(null); await load() } catch (e) { setError((e as Error).message) }
  }
  const set = (patch: Partial<Contact>) => setForm(f => (f ? { ...f, ...patch } : f))
  return (
    <div className="data-card">
      <div className="data-card-title">Contacts</div>
      {error && <div className="portal-message portal-message-error" style={{ margin: '6px 0' }}>{error}</div>}
      {rows.map(c => (
        <div key={c.id} className="approval-row" style={{ fontSize: 13 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <strong>{c.name}</strong>{c.role ? ` · ${c.role}` : ''}{c.is_billing && <span className="badge badge-blue" style={{ marginLeft: 6 }}>Billing</span>}
            <div className="td-muted">{[c.email, c.phone].filter(Boolean).join(' · ')}</div>
          </div>
          {c.email && <a className="btn-ghost btn-sm" href={`mailto:${c.email}`}>Email</a>}
          {(c.whatsapp || c.phone) && <a className="btn-ghost btn-sm" href={`https://wa.me/${(c.whatsapp || c.phone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a>}
          <button className="btn-ghost btn-sm" onClick={() => setForm({ ...c })}>Edit</button>
          <button className="btn-ghost btn-sm" onClick={() => { if (window.confirm(`Remove ${c.name}?`)) void deleteContact(c.id).then(load) }}>Remove</button>
        </div>
      ))}
      {rows.length === 0 && !form && <div className="td-muted" style={{ fontSize: 13 }}>No contacts yet.</div>}
      {form ? (
        <div className="lead-form" style={{ marginTop: 10 }}>
          <label>Name<input aria-label="Contact name" className="form-input" value={form.name} onChange={e => set({ name: e.target.value })} /></label>
          <label>Role<input aria-label="Contact role" className="form-input" value={form.role ?? ''} placeholder="e.g. Managing partner" onChange={e => set({ role: e.target.value })} /></label>
          <label>Email<input aria-label="Contact email" className="form-input" value={form.email ?? ''} onChange={e => set({ email: e.target.value })} /></label>
          <label>Phone<input aria-label="Contact phone" className="form-input" value={form.phone ?? ''} onChange={e => set({ phone: e.target.value })} /></label>
          <label>WhatsApp<input aria-label="Contact WhatsApp" className="form-input" value={form.whatsapp ?? ''} onChange={e => set({ whatsapp: e.target.value })} /></label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, color: 'var(--text)' }}><input type="checkbox" checked={!!form.is_billing} onChange={e => set({ is_billing: e.target.checked })} /> Gets invoices</label>
          <div className="lead-wide" style={{ display: 'flex', gap: 8 }}><button className="btn-primary btn-sm" onClick={() => void save()}>Save</button><button className="btn-ghost btn-sm" onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      ) : <button className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setForm(blank(clientId))}>+ Add contact</button>}
    </div>
  )
}
