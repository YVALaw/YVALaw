// Invoices → Recurring tab: schedules that auto-bill a client (weekly / biweekly / monthly).
import { useState } from 'react'
import type { Client, Project, RecurringFrequency, RecurringInvoice } from '../../data/types'
import { Checkbox, Drawer, EmptyState, Field, Menu, Pill, useIsMobile } from '../ui'
import { P } from '../Icon'
import { formatMoney } from '../../utils/money'
import { dateMed } from '../../utils/format'

type RecForm = { clientId: string; clientName: string; projectId: string; projectName: string; amount: string; description: string; frequency: RecurringFrequency; nextDueDate: string; active: boolean }
const EMPTY_REC = (): RecForm => ({ clientId: '', clientName: '', projectId: '', projectName: '', amount: '', description: '', frequency: 'monthly', nextDueDate: new Date().toISOString().slice(0, 10), active: true })
export const freqLabel = (f: RecurringFrequency) => (f === 'weekly' ? 'Weekly' : f === 'biweekly' ? 'Biweekly' : 'Monthly')

export default function RecurringInvoices({ recurring, clients, projects, persist }: {
  recurring: RecurringInvoice[]; clients: Client[]; projects: Project[]
  /** optimistic save; resolves false (and the page shows why) when it failed */
  persist: (next: RecurringInvoice[], ok?: string) => Promise<boolean>
}) {
  const mobile = useIsMobile()
  const [panel, setPanel] = useState(false)
  const [editing, setEditing] = useState<RecurringInvoice | null>(null)
  const [form, setForm] = useState<RecForm>(EMPTY_REC())

  function openNew() { setEditing(null); setForm(EMPTY_REC()); setPanel(true) }
  function openEdit(r: RecurringInvoice) {
    setEditing(r)
    setForm({ clientId: r.clientId || '', clientName: r.clientName || '', projectId: r.projectId || '', projectName: r.projectName || '',
      amount: String(r.amount), description: r.description || '', frequency: r.frequency, nextDueDate: r.nextDueDate, active: r.active })
    setPanel(true)
  }
  async function save() {
    const amt = parseFloat(form.amount) || 0
    if (!amt || !form.clientName.trim()) return
    const fields = { clientId: form.clientId || undefined, clientName: form.clientName, projectId: form.projectId || undefined, projectName: form.projectName || undefined,
      amount: amt, description: form.description || undefined, frequency: form.frequency, nextDueDate: form.nextDueDate, active: form.active }
    const next = editing
      ? recurring.map(r => r.id === editing.id ? { ...r, ...fields } : r)
      : [{ id: crypto.randomUUID(), ...fields, createdAt: Date.now() } as RecurringInvoice, ...recurring]
    setPanel(false)
    await persist(next, editing ? 'Recurring invoice saved.' : 'Recurring invoice created.')
  }
  const toggle = (r: RecurringInvoice) => persist(recurring.map(x => x.id === r.id ? { ...x, active: !x.active } : x), r.active ? 'Paused.' : 'Resumed.')
  const remove = (r: RecurringInvoice) => { if (window.confirm('Delete this recurring invoice?')) void persist(recurring.filter(x => x.id !== r.id), 'Recurring invoice deleted.') }
  const menu = (r: RecurringInvoice) => <Menu items={[
    { label: 'Edit', icon: P.edit, onClick: () => openEdit(r) },
    { label: r.active ? 'Pause' : 'Resume', icon: r.active ? P.lock : P.refresh, onClick: () => void toggle(r) },
    'sep',
    { label: 'Delete', icon: P.trash, danger: true, onClick: () => remove(r) },
  ]} />

  return (
    <>
      <div className="fin-subbar">
        <span className="muted">Schedules that bill a client automatically.</span>
        <button type="button" className="btn btn--primary" onClick={openNew}>+ New recurring</button>
      </div>
      {recurring.length === 0 ? (
        <EmptyState>No recurring invoices yet. Set one up to auto-bill clients on a schedule.</EmptyState>
      ) : mobile ? (
        <div className="mcards">
          {recurring.map(r => (
            <div key={r.id} className="mcard">
              <div className="mcard__top">
                <div><div className="mcard__title">{r.clientName || '—'}</div><div className="mcard__meta">{r.projectName || 'No project'} · {freqLabel(r.frequency)} · next {dateMed(r.nextDueDate)}</div></div>
                <div className="fin-mcard-right"><span className="fin-strong num">{formatMoney(r.amount)}</span><Pill tone={r.active ? 'success' : 'warning'}>{r.active ? 'Active' : 'Paused'}</Pill></div>
              </div>
              {r.description && <div className="mcard__meta">{r.description}</div>}
              <div className="mcard__actions"><button type="button" className="btn" onClick={() => openEdit(r)}>Edit</button>{menu(r)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="table-card">
          <table className="table fin-table-rec">
            <thead><tr><th>Client</th><th>Project</th><th className="t-right">Amount</th><th>Frequency</th><th>Next due</th><th>Description</th><th>Status</th><th /></tr></thead>
            <tbody>
              {recurring.map(r => (
                <tr key={r.id}>
                  <td className="t-strong">{r.clientName || '—'}</td>
                  <td className="muted">{r.projectName || '—'}</td>
                  <td className="t-num t-strong">{formatMoney(r.amount)}</td>
                  <td><Pill tone="neutral">{freqLabel(r.frequency)}</Pill></td>
                  <td>{dateMed(r.nextDueDate)}</td>
                  <td className="muted">{r.description || '—'}</td>
                  <td><Pill tone={r.active ? 'success' : 'warning'}>{r.active ? 'Active' : 'Paused'}</Pill></td>
                  <td className="t-actions"><button type="button" className="btn btn--xs" onClick={() => openEdit(r)}>Edit</button> {menu(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={panel} onClose={() => setPanel(false)} size="narrow" title={editing ? 'Edit recurring invoice' : 'New recurring invoice'}
        footer={<>
          <button type="button" className="btn" onClick={() => setPanel(false)}>Cancel</button>
          <span className="spacer" />
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!form.clientName.trim() || !form.amount}>{editing ? 'Save changes' : 'Create recurring invoice'}</button>
        </>}>
        <div className="form-grid form-grid--2">
          <Field label="Client *" full>
            <select className="select" aria-label="Client" value={form.clientId} onChange={e => { const c = clients.find(x => x.id === e.target.value); setForm(f => ({ ...f, clientId: e.target.value, clientName: c?.name || '' })) }}>
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Project" full>
            <select className="select" aria-label="Project" value={form.projectId} onChange={e => { const p = projects.find(x => x.id === e.target.value); setForm(f => ({ ...f, projectId: e.target.value, projectName: p?.name || '' })) }}>
              <option value="">None</option>
              {projects.filter(p => !form.clientId || p.clientId === form.clientId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Amount (USD) *"><input className="input" type="number" min="0" step="0.01" placeholder="0.00" aria-label="Amount (USD)" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="Frequency">
            <select className="select" aria-label="Frequency" value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as RecurringFrequency }))}>
              <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Next due date" full><input className="input" type="date" aria-label="Next due date" value={form.nextDueDate} onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))} /></Field>
          <Field label="Description" full><textarea className="textarea" rows={2} placeholder="e.g. Monthly retainer" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></Field>
        </div>
        <Checkbox checked={form.active} onChange={v => setForm(f => ({ ...f, active: v }))} label="Active (will auto-generate invoices)" />
      </Drawer>
    </>
  )
}
