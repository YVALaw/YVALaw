// Client profile tabs (redesign 2026-11): Billing, Communications, Contracts, Documents.
// Logic moved unchanged from ClientProfilePage; writes now surface failures.
import { useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ActivityLogEntry, Client, ClientDocument, CommEntryType, Contract, ContractStatus, Invoice, PaymentAttempt } from '../../data/types'
import { loadActivityLog, saveActivityLog, addClientDocument, removeClientDocument, type ClientBillingSummary } from '../../services/storage'
import { uploadFile, deleteFile } from '../../services/fileStorage'
import { supabase } from '../../lib/supabase'
import { balanceOf, isUnpaid } from '../../services/crm'
import { Banner, Drawer, Field, Menu, Pill, Segmented, onEnter, useIsMobile, type Tone } from '../ui'
import { Ic, P } from '../Icon'
import { dateMed, dateShort, usd } from '../../utils/format'

const fmtTs = (ts: number) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const fmtAttempt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined)
export const isSetupOnlyAttempt = (a: PaymentAttempt) => a.status === 'created' || a.status === 'requires_payment_method'
const ATTEMPT_CLASS: Record<string, string> = { succeeded: 't-success', failed: 't-danger', processing: 't-warning', requires_action: 't-warning', requires_payment_method: 't-warning', canceled: 'muted' }
const INVOICE_TONE: Record<string, Tone> = { draft: 'neutral', sent: 'sent', viewed: 'viewed', partial: 'partial', overdue: 'danger', paid: 'success' }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function portalCardLabel(b: ClientBillingSummary): string | undefined {
  if (!b.defaultCardLast4) return undefined
  const brand = b.defaultCardBrand ? cap(b.defaultCardBrand) : 'Card'
  const exp = b.defaultCardExpMonth && b.defaultCardExpYear ? ` · expires ${String(b.defaultCardExpMonth).padStart(2, '0')}/${String(b.defaultCardExpYear).slice(-2)}` : ''
  return `${brand} ending ${b.defaultCardLast4}${exp}`
}
export function autoPayText(b: ClientBillingSummary) {
  return b.autoPayEnabled ? `On${fmtDay(b.autoPayAuthorizedAt) ? ` since ${fmtDay(b.autoPayAuthorizedAt)}` : ''}`
    : b.hasSavedPaymentMethod ? 'Off — saved card available' : b.hasPortalAccount ? 'Off' : 'No portal account'
}

/* ── Billing: invoices + AutoPay + payment attempts ──────────────────── */
export function BillingTab({ invoices, billing, canOpenInvoices }: { invoices: Invoice[]; billing: ClientBillingSummary; canOpenInvoices: boolean }) {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const visible = billing.recentAttempts.filter(a => !isSetupOnlyAttempt(a))
  const hiddenSetup = billing.recentAttempts.length - visible.length
  const attempts = visible.length > 0 ? visible : billing.recentAttempts
  const sorted = [...invoices].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const open = (inv: Invoice) => { if (canOpenInvoices) navigate(`/invoice?open=${inv.id}`) }
  const info = [
    { k: 'AutoPay', v: autoPayText(billing) },
    { k: 'Saved card', v: portalCardLabel(billing) },
    { k: 'Last payment', v: billing.lastSuccessfulAttempt ? `${usd(billing.lastSuccessfulAttempt.amount)} on ${fmtAttempt(billing.lastSuccessfulAttempt.attemptedAt)}` : undefined },
    { k: 'Last attempt', v: billing.lastAttempt ? `${billing.lastAttempt.status.replace(/_/g, ' ')} · ${fmtAttempt(billing.lastAttempt.attemptedAt)}` : undefined },
  ].filter(i => i.v)
  return (
    <div className="stack stack--lg">
      <section className="card card--pad stack">
        <h2 className="card__title">Portal &amp; AutoPay</h2>
        <div className="info-grid">{info.map(i => <div key={i.k} className="info"><span className="info__label">{i.k}</span><span className="info__value">{i.v}</span></div>)}</div>
      </section>
      <section className="card">
        <div className="card__head"><h2 className="card__title">Invoices</h2><span className="card__meta">{invoices.length} total</span></div>
        {sorted.length === 0 ? <div className="card-empty">No invoices yet.</div> : mobile ? (
          <div>{sorted.map(inv => (
            <button key={inv.id} type="button" className="list-row crm-btnrow" onClick={() => open(inv)} disabled={!canOpenInvoices}>
              <div className="list-row__main"><span className="list-row__title mono">{inv.number}</span><span className="list-row__meta">{dateShort(inv.date)}{inv.dueDate ? ` · due ${dateShort(inv.dueDate)}` : ''}</span></div>
              <div className="crm-right"><span className="num crm-td-strong">{usd(Number(inv.subtotal) || 0)}</span><Pill tone={INVOICE_TONE[(inv.status || 'draft').toLowerCase()] ?? 'neutral'} status={inv.status || 'draft'} /></div>
            </button>
          ))}</div>
        ) : (
          <div className="crm-scroll"><table className="table crm-min-620">
            <thead><tr><th>Invoice</th><th>Date</th><th>Status</th><th className="t-right">Balance</th><th className="t-right">Amount</th></tr></thead>
            <tbody>{sorted.map(inv => (
              <tr key={inv.id} className={canOpenInvoices ? 'is-clickable' : undefined} onClick={() => open(inv)}>
                <td className="mono crm-td-mono">{inv.number}</td>
                <td className="muted">{dateShort(inv.date)}{inv.dueDate ? ` · due ${dateShort(inv.dueDate)}` : ''}</td>
                <td><Pill tone={INVOICE_TONE[(inv.status || 'draft').toLowerCase()] ?? 'neutral'} status={inv.status || 'draft'} /></td>
                <td className={`t-num ${isUnpaid(inv) && balanceOf(inv) > 0 ? 't-danger' : 'soft'}`}>{isUnpaid(inv) ? usd(balanceOf(inv)) : '—'}</td>
                <td className="t-num crm-td-strong">{usd(Number(inv.subtotal) || 0)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {(billing.hasPortalAccount || billing.recentAttempts.length > 0) && (
        <section className="card">
          <div className="card__head">
            <div><h2 className="card__title">Billing activity</h2><div className="card__meta">Portal and AutoPay payment attempts from Stripe</div></div>
            {hiddenSetup > 0 && visible.length > 0 && <span className="card__meta">{hiddenSetup} setup {hiddenSetup === 1 ? 'attempt' : 'attempts'} hidden</span>}
          </div>
          {attempts.length === 0 ? <div className="card-empty">No payment attempts recorded yet.</div> : (
            <div className={mobile ? undefined : 'crm-scroll'}>
              {attempts.map(a => {
                const setup = isSetupOnlyAttempt(a)
                return (
                  <div key={a.id} className={`crm-attempt${setup ? ' crm-attempt--setup' : ''}`}>
                    <span className="mono crm-td-mono">{a.invoiceNumber || '—'}</span>
                    <span className="muted crm-cap">{a.source}</span>
                    <span className={`crm-attempt__status ${setup ? 'muted' : ATTEMPT_CLASS[a.status] ?? ''}`}>{setup ? 'Started' : cap(a.status.replace(/_/g, ' '))}</span>
                    <span className="crm-attempt__when">
                      {fmtAttempt(a.attemptedAt)}
                      {setup && <span className="crm-attempt__note">Card confirmation was started but not completed.</span>}
                      {a.failureReason && <span className="crm-attempt__fail">{a.failureReason}</span>}
                    </span>
                    <span className="num crm-td-strong crm-attempt__amt">{usd(a.amount)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

/* ── Communications timeline (activity_log) ──────────────────────────── */
const COMM_TYPES: CommEntryType[] = ['note', 'call', 'email', 'meeting']
const COMM_DOT: Record<string, string> = { note: 'dot--muted', call: 'dot--info', email: 'crm-dot--email', meeting: 'crm-dot--meeting2', system: 'dot--success' }
const COMM_PH: Record<string, string> = { call: 'Call summary...', email: 'Email summary...', meeting: 'Meeting notes...', note: 'Log a call, email or note…' }
export function CommsTab({ clientId, log, setLog }: { clientId: string; log: ActivityLogEntry[]; setLog: (l: ActivityLogEntry[]) => void }) {
  const [note, setNote] = useState('')
  const [type, setType] = useState<CommEntryType>('note')
  const [error, setError] = useState<string | null>(null)
  async function add() {
    if (!note.trim()) return
    const entry: ActivityLogEntry = { id: crypto.randomUUID(), clientId, note: note.trim(), createdAt: Date.now(), type, auto: false }
    const prev = log
    setLog([entry, ...log]); setNote(''); setError(null)
    try { const all = await loadActivityLog(); await saveActivityLog([entry, ...all]) }
    catch (e) { setLog(prev); setError(`Could not log it: ${(e as Error).message}`) }
  }
  async function remove(id: string) {
    const prev = log
    setLog(log.filter(e => e.id !== id))
    try { const all = await loadActivityLog(); await saveActivityLog(all.filter(e => e.id !== id)) }
    catch (e) { setLog(prev); setError(`Could not delete it: ${(e as Error).message}`) }
  }
  return (
    <section className="card card--pad stack crm-narrow">
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      <Segmented label="Entry type" value={type} onChange={setType} options={COMM_TYPES.map(t => ({ value: t, label: cap(t) }))} />
      <div className="crm-act-form">
        <input className="input crm-act-form__body" aria-label="Communication" value={note} onChange={e => setNote(e.target.value)} onKeyDown={onEnter(() => void add())} placeholder={COMM_PH[type]} />
        <button type="button" className="btn btn--primary" onClick={() => void add()} disabled={!note.trim()}>Add</button>
      </div>
      {log.length === 0 ? <div className="crm-muted-line">No communications yet.</div> : (
        <div>
          {log.map(e => {
            const t = e.type || 'note'
            return (
              <div key={e.id} className="crm-comm">
                <span className={`dot crm-comm__dot ${COMM_DOT[t] ?? 'dot--muted'}`} />
                <div className="crm-comm__main">
                  <span className="crm-comm__text">{e.note}</span>
                  <span className="crm-comm__meta">{t === 'system' ? 'Auto' : cap(t)} · {fmtTs(e.createdAt)}</span>
                </div>
                {!e.auto && <button type="button" className="btn btn--ghost btn--xs" aria-label="Delete entry" onClick={() => void remove(e.id)}><Ic d={P.x} size={14} /></button>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/* ── Contracts (stored on clients.contracts, files in Storage) ───────── */
const CONTRACT_TONE: Record<ContractStatus, Tone> = { draft: 'neutral', active: 'success', expired: 'warning', terminated: 'danger' }
type ContractForm = { title: string; status: ContractStatus; startDate: string; endDate: string; value: string; notes: string }
const blankContract: ContractForm = { title: '', status: 'draft', startDate: '', endDate: '', value: '', notes: '' }
export function ContractsTab({ client, persist }: { client: Client; persist: (c: Client) => Promise<void> }) {
  const mobile = useIsMobile()
  const [panel, setPanel] = useState<{ editId: string | null } | null>(null)
  const [form, setForm] = useState<ContractForm>(blankContract)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const contracts = client.contracts ?? []
  const openAdd = () => { setForm(blankContract); setFile(null); setError(null); setPanel({ editId: null }) }
  const openEdit = (c: Contract) => {
    setForm({ title: c.title, status: c.status, startDate: c.startDate ?? '', endDate: c.endDate ?? '', value: c.value != null ? String(c.value) : '', notes: c.notes ?? '' })
    setFile(null); setError(null); setPanel({ editId: c.id })
  }
  async function save() {
    if (!form.title.trim() || !panel) return
    setBusy(true); setError(null)
    try {
      let fileUrl: string | undefined, filePath: string | undefined, fileName: string | undefined
      if (file) { const r = await uploadFile(file, `contracts/clients/${client.id}`); fileUrl = r.storageUrl; filePath = r.storagePath; fileName = file.name }
      const fields = { title: form.title.trim(), status: form.status, startDate: form.startDate || undefined, endDate: form.endDate || undefined, value: form.value ? Number(form.value) : undefined, notes: form.notes || undefined }
      const next: Contract[] = panel.editId
        ? contracts.map(c => (c.id !== panel.editId ? c : { ...c, ...fields, ...(fileUrl ? { fileUrl, filePath, fileName } : {}) }))
        : [{ id: crypto.randomUUID(), ...fields, fileUrl, filePath, fileName, createdAt: Date.now() }, ...contracts]
      await persist({ ...client, contracts: next })
      setPanel(null)
    } catch (e) { setError(`Could not save the contract: ${(e as Error).message}`) }
    finally { setBusy(false) }
  }
  async function remove(c: Contract) {
    if (!window.confirm(`Delete contract "${c.title}"?`)) return
    if (c.filePath) await deleteFile(c.filePath).catch(() => { /* ignore */ })
    await persist({ ...client, contracts: contracts.filter(x => x.id !== c.id) }).catch(e => setError(`Could not delete: ${(e as Error).message}`))
  }
  const range = (c: Contract) => (c.startDate || c.endDate ? `${c.startDate ? dateMed(c.startDate) : '—'} – ${c.endDate ? dateMed(c.endDate) : '—'}` : '—')
  const menu = (c: Contract) => [{ label: 'Edit', onClick: () => openEdit(c) }, 'sep' as const, { label: 'Delete contract', danger: true, onClick: () => void remove(c) }]
  return (
    <section className="card">
      <div className="card__head"><h2 className="card__title">Contracts</h2><button type="button" className="link" onClick={openAdd}>+ Add contract</button></div>
      {error && <div className="card__body"><Banner tone="danger" onClose={() => setError(null)}>{error}</Banner></div>}
      {contracts.length === 0 ? <div className="card-empty">No contracts yet.</div> : mobile ? (
        <div>{contracts.map(c => (
          <div key={c.id} className="list-row">
            <div className="list-row__main"><span className="list-row__title">{c.title}</span><span className="list-row__meta">{range(c)}{c.value != null ? ` · ${usd(c.value, { cents: false })}` : ''}</span>{c.fileUrl && <a className="link crm-small" href={c.fileUrl} target="_blank" rel="noopener noreferrer">{c.fileName || 'Download'}</a>}</div>
            <Pill tone={CONTRACT_TONE[c.status]} status={c.status} />
            <Menu items={menu(c)} label={`Actions for ${c.title}`} buttonClass="btn btn--icon btn--ghost" />
          </div>
        ))}</div>
      ) : (
        <div className="crm-scroll"><table className="table crm-min-720">
          <thead><tr><th>Title</th><th>Status</th><th>Date range</th><th className="t-right">Value</th><th>Notes</th><th>File</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{contracts.map(c => (
            <tr key={c.id}>
              <td className="crm-td-strong">{c.title}</td>
              <td><Pill tone={CONTRACT_TONE[c.status]} status={c.status} /></td>
              <td className="muted">{range(c)}</td>
              <td className="t-num crm-td-strong">{c.value != null ? usd(c.value, { cents: false }) : '—'}</td>
              <td className="muted crm-ellipsis" title={c.notes}>{c.notes || '—'}</td>
              <td>{c.fileUrl ? <a className="link" href={c.fileUrl} target="_blank" rel="noopener noreferrer">{c.fileName || 'Download'}</a> : <span className="soft">—</span>}</td>
              <td className="t-actions"><Menu items={menu(c)} label={`Actions for ${c.title}`} buttonClass="btn btn--icon btn--ghost btn--sm" /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Drawer open={!!panel} onClose={() => setPanel(null)} size="narrow" title={panel?.editId ? 'Edit contract' : 'Add contract'}
        footer={<><span className="spacer" /><button type="button" className="btn" onClick={() => setPanel(null)}>Cancel</button><button type="button" className="btn btn--primary" disabled={!form.title.trim() || busy} onClick={() => void save()}>{busy ? 'Saving…' : panel?.editId ? 'Save changes' : 'Add contract'}</button></>}>
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="form-grid">
          <Field label="Title *" full><input className="input" aria-label="Contract title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Service Agreement 2026" autoFocus /></Field>
          <Field label="Status"><select className="select" aria-label="Contract status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ContractStatus }))}>
            <option value="draft">Draft</option><option value="active">Active</option><option value="expired">Expired</option><option value="terminated">Terminated</option></select></Field>
          <Field label="Contract value (USD)"><input className="input" type="number" aria-label="Contract value" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="Optional" /></Field>
          <Field label="Start date"><input className="input" type="date" aria-label="Start date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></Field>
          <Field label="End date"><input className="input" type="date" aria-label="End date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></Field>
          <Field label="Notes" full><textarea className="textarea" rows={2} aria-label="Contract notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes about this contract..." /></Field>
          <div className="field field--full">
            <span className="field__label">File (.pdf, .doc, .docx)</span>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <div className="row"><button type="button" className="btn" onClick={() => fileRef.current?.click()}><Ic d={P.upload} size={15} />Choose file</button><span className="muted crm-small">{file ? file.name : 'No file selected'}</span></div>
          </div>
        </div>
      </Drawer>
    </section>
  )
}

/* ── Documents shared with the client portal (signed URLs) ───────────── */
const CATEGORIES: ClientDocument['category'][] = ['contract', 'nda', 'report', 'invoice', 'other']
const CAT_LABEL: Record<string, string> = { contract: 'Contract', nda: 'NDA', report: 'Report', invoice: 'Invoice', other: 'Other' }
export function DocumentsTab({ client, docs, setDocs }: { client: Client; docs: ClientDocument[]; setDocs: (fn: (d: ClientDocument[]) => ClientDocument[]) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<ClientDocument['category']>('other')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  async function upload() {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const { storageUrl, storagePath } = await uploadFile(file, `client-docs/${client.id}`)
      const { data: { user } } = await supabase.auth.getUser()
      const doc: ClientDocument = { id: crypto.randomUUID(), clientId: client.id, name: file.name, category, fileUrl: storageUrl, filePath: storagePath, fileSize: file.size, uploadedAt: Date.now(), uploadedBy: user?.email ?? 'YVA Team' }
      await addClientDocument(doc)
      setDocs(prev => [doc, ...prev]); setFile(null); setCategory('other')
      if (ref.current) ref.current.value = ''
    } catch (err) {
      console.error('Doc upload failed:', err)
      setError(err instanceof Error ? err.message : 'Upload failed. Make sure the client_documents table exists in Supabase.')
    } finally { setBusy(false) }
  }
  async function remove(doc: ClientDocument) {
    if (!window.confirm(`Remove "${doc.name}"?`)) return
    try { await removeClientDocument(doc.id); await deleteFile(doc.filePath).catch(() => { /* ignore */ }); setDocs(prev => prev.filter(d => d.id !== doc.id)) }
    catch (e) { setError(`Could not remove it: ${(e as Error).message}`) }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f) }
  const ext = (n: string) => (n.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()
  return (
    <div className="stack crm-narrow">
      <div className={`dropzone crm-drop${over ? ' dropzone--over' : ''}`} role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={onEnter(() => ref.current?.click())}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <input ref={ref} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" hidden aria-label="Choose a file to share" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <span className="crm-drop__title">{file ? file.name : `Drop files to share with ${client.name}`}</span>
        <span className="crm-drop__sub">{file ? 'Pick a category and press Share.' : 'Shows in their portal under Documents. They can upload here too.'}</span>
      </div>
      {file && (
        <div className="row row--wrap">
          <select className="select crm-cat" aria-label="Document category" value={category} onChange={e => setCategory(e.target.value as ClientDocument['category'])}>{CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}</select>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void upload()}>{busy ? 'Uploading…' : 'Share'}</button>
          <button type="button" className="btn btn--ghost" onClick={() => { setFile(null); if (ref.current) ref.current.value = '' }}>Cancel</button>
        </div>
      )}
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      <section className="card">
        {docs.length === 0 ? <div className="card-empty">No documents shared yet.</div> : docs.map(d => (
          <div key={d.id} className="list-row">
            <span className="crm-ext mono">{ext(d.name)}</span>
            <div className="list-row__main"><span className="list-row__title crm-ellipsis">{d.name}</span><span className="list-row__meta">{CAT_LABEL[d.category] ?? d.category} · Uploaded by {d.uploadedBy || 'YVA'} · {dateShort(d.uploadedAt)}</span></div>
            <a className="link crm-small" href={d.fileUrl} target="_blank" rel="noopener noreferrer">Download</a>
            <Menu items={[{ label: 'Remove from portal', danger: true, onClick: () => void remove(d) }]} label={`Actions for ${d.name}`} buttonClass="btn btn--icon btn--ghost btn--sm" />
          </div>
        ))}
      </section>
    </div>
  )
}
