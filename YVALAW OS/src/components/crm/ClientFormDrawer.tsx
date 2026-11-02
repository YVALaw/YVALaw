// "+ Add client" / "Edit client" drawer (Clients page + client profile). Fields grouped Basics / Billing / Notes & links.
import { useEffect, useState } from 'react'
import type { Client, Tag } from '../../data/types'
import { TagInput } from '../TagInput'
import { Banner, Drawer, Field } from '../ui'
import { Ic, P } from '../Icon'
import { emailListForSave, formatEmailList, parseEmailList } from '../../utils/emailList'
import { ccColumnExists } from '../../services/storage'

export const CLIENT_STAGES: { key: string; label: string }[] = [
  { key: 'lead', label: 'Lead' }, { key: 'prospect', label: 'Prospect' }, { key: 'active', label: 'Active' }, { key: 'paused', label: 'Paused' }, { key: 'churned', label: 'Churned' },
]
/** Same colour for the same name everywhere (crm-av--0…6) */
export function avatarTone(name: string) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 7; return `crm-av--${Math.abs(h)}` }
const TERMS = ['On receipt', 'Net 7', 'Net 15', 'Net 30']

type LinkEntry = { label: string; url: string }
export type ClientFormData = {
  name: string; company: string; email: string; ccEmails: string; phone: string; address: string
  timezone: string; defaultRate: string; paymentTerms: string; tags: string[]
  notes: string; status: string; contractEnd: string; links: LinkEntry[]
}
const EMPTY: ClientFormData = { name: '', company: '', email: '', ccEmails: '', phone: '', address: '', timezone: '', defaultRate: '', paymentTerms: '', tags: [], notes: '', status: 'active', contractEnd: '', links: [] }

/** Ensure tags field is always string[] regardless of how it's stored in DB */
export function normTags(v: unknown): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v as string[]
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean)
  return []
}
function fromClient(c: Client): ClientFormData {
  return {
    name: c.name, company: c.company ?? '', email: c.email ?? '', ccEmails: formatEmailList(c.ccEmails), phone: c.phone ?? '', address: c.address ?? '',
    timezone: c.timezone ?? '', defaultRate: c.defaultRate != null ? String(c.defaultRate) : '', paymentTerms: c.paymentTerms ?? '',
    tags: normTags(c.tags), notes: c.notes ?? '', status: c.status ?? 'active', contractEnd: c.contractEnd ?? '', links: c.links ?? [],
  }
}
/** Form → the Client fields it owns (same mapping the old add/edit modal used) */
export function toClientPatch(form: ClientFormData): Partial<Client> {
  return {
    name: form.name, company: form.company || undefined, email: form.email || undefined,
    ccEmails: emailListForSave(form.ccEmails),
    phone: form.phone || undefined, address: form.address || undefined, timezone: form.timezone || undefined,
    defaultRate: form.defaultRate ? Number(form.defaultRate) : undefined,
    paymentTerms: form.paymentTerms || undefined, tags: form.tags.length > 0 ? form.tags : undefined,
    notes: form.notes || undefined, status: form.status, contractEnd: form.contractEnd || undefined,
    links: form.links.length > 0 ? form.links : undefined,
  }
}

export default function ClientFormDrawer({ open, client, allTags, onTagCreated, onClose, onSave }: {
  open: boolean; client: Client | null; allTags: Tag[]; onTagCreated: (t: Tag) => void
  onClose: () => void; onSave: (patch: Partial<Client>) => Promise<void>
}) {
  const [form, setForm] = useState<ClientFormData>(EMPTY)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ccReady, setCcReady] = useState(true)
  useEffect(() => { if (open) void ccColumnExists('clients').then(setCcReady) }, [open])
  const ccCheck = parseEmailList(form.ccEmails)
  useEffect(() => { if (open) { setForm(client ? fromClient(client) : { ...EMPTY }); setLinkLabel(''); setLinkUrl(''); setError(null) } }, [open, client?.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<ClientFormData>) => setForm(f => ({ ...f, ...patch }))
  function addLink() {
    if (!linkLabel.trim() || !linkUrl.trim()) return
    set({ links: [...form.links, { label: linkLabel.trim(), url: linkUrl.trim() }] }); setLinkLabel(''); setLinkUrl('')
  }
  async function save() {
    if (!form.name.trim() || saving) return
    if (ccCheck.invalid.length) { setError(`Invoice CC: ${ccCheck.invalid.join(', ')} ${ccCheck.invalid.length === 1 ? "doesn't look like an email address" : "don't look like email addresses"}.`); return }
    setSaving(true); setError(null)
    try { await onSave(toClientPatch(form)); onClose() } catch (e) { setError(`Could not save: ${(e as Error).message}`) } finally { setSaving(false) }
  }
  return (
    <Drawer open={open} onClose={onClose} title={client ? 'Edit client' : 'Add client'} sub={client ? client.name : undefined}
      footer={<><span className="spacer" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn--primary" disabled={!form.name.trim() || saving} onClick={() => void save()}>{saving ? 'Saving…' : client ? 'Save changes' : 'Add client'}</button></>}>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="form-section">
        <h3 className="form-section__title">Basics</h3>
        <div className="form-grid">
          <Field label="Display name *"><input aria-label="Display name" className="input" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Client / contact name" /></Field>
          <Field label="Company / legal name"><input aria-label="Company" className="input" value={form.company} onChange={e => set({ company: e.target.value })} placeholder="Legal entity name (optional)" /></Field>
          <Field label="Email"><input aria-label="Email" className="input" type="email" value={form.email} onChange={e => set({ email: e.target.value })} placeholder="billing@client.com" /></Field>
          <Field label="Phone"><input aria-label="Phone" className="input" value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="+1 555 000 0000" /></Field>
          <Field label="Stage"><select aria-label="Stage" className="select" value={form.status} onChange={e => set({ status: e.target.value })}>{CLIENT_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
          <Field label="Timezone"><input aria-label="Timezone" className="input" value={form.timezone} onChange={e => set({ timezone: e.target.value })} placeholder="America/New_York" /></Field>
        </div>
      </div>
      <div className="form-section">
        <h3 className="form-section__title">Billing</h3>
        <div className="form-grid">
          <Field label="Default rate ($/hr)"><input aria-label="Default rate" className="input" type="number" inputMode="decimal" value={form.defaultRate} onChange={e => set({ defaultRate: e.target.value })} placeholder="8.50" /></Field>
          <Field label="Payment terms"><select aria-label="Payment terms" className="select" value={form.paymentTerms} onChange={e => set({ paymentTerms: e.target.value })}>
            <option value="">— Not set —</option>{TERMS.map(t => <option key={t} value={t}>{t}</option>)}{form.paymentTerms && !TERMS.includes(form.paymentTerms) && <option value={form.paymentTerms}>{form.paymentTerms}</option>}</select></Field>
          <Field label="Invoice CC" full
            error={ccCheck.invalid.length ? `Not an email address: ${ccCheck.invalid.join(', ')}` : undefined}
            hint={ccReady ? 'Copied (Cc) on invoices and payment reminders — e.g. the person who pays. Separate several with commas.' : 'Needs a database update first: run supabase/migrate-cc-emails.sql in Supabase.'}>
            <input aria-label="Invoice CC" className="input" type="text" inputMode="email" autoComplete="off" disabled={!ccReady} value={form.ccEmails} onChange={e => set({ ccEmails: e.target.value })} placeholder="accounting@client.com, owner@client.com" />
          </Field>
          <Field label="Contract end date"><input aria-label="Contract end date" className="input" type="date" value={form.contractEnd} onChange={e => set({ contractEnd: e.target.value })} /></Field>
          <Field label="Billing address" full><input aria-label="Billing address" className="input" value={form.address} onChange={e => set({ address: e.target.value })} placeholder="123 Main St, City, State" /></Field>
        </div>
      </div>
      <div className="form-section">
        <h3 className="form-section__title">Notes &amp; links</h3>
        <div className="form-grid">
          <div className="field field--full crm-tags-field"><span className="field__label">Tags</span><TagInput tags={form.tags} onChange={tags => set({ tags })} allTags={allTags} onTagCreated={onTagCreated} /></div>
          <Field label="Internal notes" full><textarea aria-label="Internal notes" className="textarea" rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Scope, preferred communication, special billing rules..." /></Field>
          <div className="field field--full">
            <span className="field__label">Documents &amp; links</span>
            {form.links.map((lk, i) => (
              <div key={i} className="crm-link-row">
                <a href={lk.url} target="_blank" rel="noopener noreferrer" className="link">{lk.label}</a>
                <span className="crm-link-row__url">{lk.url}</span>
                <button type="button" className="btn btn--ghost btn--xs" aria-label={`Remove ${lk.label}`} onClick={() => set({ links: form.links.filter((_, idx) => idx !== i) })}><Ic d={P.x} size={14} /></button>
              </div>
            ))}
            <div className="crm-link-add">
              <input className="input" aria-label="Link label" value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Label (e.g. Contract)" />
              <input className="input" aria-label="Link URL" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." />
              <button type="button" className="btn" onClick={addLink} disabled={!linkLabel.trim() || !linkUrl.trim()}>+ Add</button>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  )
}
