import { useEffect, useState } from 'react'
import { deleteContact, loadContacts, saveContact, type Contact } from '../services/crm'
import { Banner, Checkbox, Field, Menu } from './ui'
import { initials } from '../utils/format'

const blank = (clientId: string): Partial<Contact> & { client_id: string; name: string } => ({ client_id: clientId, name: '', role: '', email: '', phone: '', whatsapp: '', is_billing: false })

/** Client profile → Contacts: the people at the firm (Step 9; redesign 2026-11) */
export default function ClientContacts({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Contact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<(Partial<Contact> & { client_id: string; name: string }) | null>(null)
  const [saving, setSaving] = useState(false)
  const load = async () => { const r = await loadContacts(clientId); setRows(r.rows); setError(r.error) }
  useEffect(() => { void load() }, [clientId])   // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    if (!form || !form.name.trim() || saving) return
    setSaving(true)
    try { await saveContact(form); setForm(null); await load() } catch (e) { setError((e as Error).message) } finally { setSaving(false) }
  }
  async function remove(c: Contact) {
    if (!window.confirm(`Remove ${c.name}?`)) return
    try { await deleteContact(c.id); await load() } catch (e) { setError(`Could not remove ${c.name}: ${(e as Error).message}`) }
  }
  const set = (patch: Partial<Contact>) => setForm(f => (f ? { ...f, ...patch } : f))
  return (
    <section className="card crm-contacts">
      <div className="card__head"><h2 className="card__title">Contacts</h2>{!form && <button type="button" className="link" onClick={() => setForm(blank(clientId))}>+ Add contact</button>}</div>
      {error && <div className="card__body"><Banner tone="danger" onClose={() => setError(null)}>{error}</Banner></div>}
      {rows.map(c => (
        <div key={c.id} className="list-row">
          <span className="avatar-i avatar-i--soft">{initials(c.name)}</span>
          <div className="list-row__main">
            <span className="list-row__title">{c.name}{c.role && <span className="crm-contact-role"> · {c.role}</span>}</span>
            <span className="list-row__meta">{[c.email, c.phone].filter(Boolean).join(' · ') || 'No email or phone'}</span>
          </div>
          {c.is_billing && <span className="crm-primary-tag" title="Gets invoices">BILLING</span>}
          <Menu label={`Actions for ${c.name}`} buttonClass="btn btn--icon btn--ghost btn--sm" items={[
            { label: 'Email', hidden: !c.email, onClick: () => { window.location.href = `mailto:${c.email}` } },
            { label: 'WhatsApp', hidden: !(c.whatsapp || c.phone), onClick: () => { window.open(`https://wa.me/${(c.whatsapp || c.phone || '').replace(/\D/g, '')}`, '_blank', 'noreferrer') } },
            { label: 'Edit', onClick: () => setForm({ ...c }) },
            'sep',
            { label: 'Remove', danger: true, onClick: () => void remove(c) },
          ]} />
        </div>
      ))}
      {rows.length === 0 && !form && <div className="card-empty">No contacts yet.</div>}
      {form && (
        <div className="card__body crm-contact-form">
          <div className="form-grid">
            <Field label="Name"><input aria-label="Contact name" className="input" value={form.name} onChange={e => set({ name: e.target.value })} /></Field>
            <Field label="Role"><input aria-label="Contact role" className="input" value={form.role ?? ''} placeholder="e.g. Managing partner" onChange={e => set({ role: e.target.value })} /></Field>
            <Field label="Email"><input aria-label="Contact email" className="input" value={form.email ?? ''} onChange={e => set({ email: e.target.value })} /></Field>
            <Field label="Phone"><input aria-label="Contact phone" className="input" value={form.phone ?? ''} onChange={e => set({ phone: e.target.value })} /></Field>
            <Field label="WhatsApp"><input aria-label="Contact WhatsApp" className="input" value={form.whatsapp ?? ''} onChange={e => set({ whatsapp: e.target.value })} /></Field>
            <div className="field crm-check-field"><Checkbox checked={!!form.is_billing} onChange={v => set({ is_billing: v })} label="Gets invoices" /></div>
          </div>
          <div className="row"><button type="button" className="btn btn--primary" disabled={!form.name.trim() || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button></div>
        </div>
      )}
    </section>
  )
}
