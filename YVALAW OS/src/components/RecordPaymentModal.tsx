import { useEffect, useState } from 'react'
import { deletePayment, loadInvoicePaidState, loadPayments, PAYMENT_METHODS, recordPayment, type ClientPayment } from '../services/payments'
import { usePermission } from '../context/RoleContext'
import { localParts } from '../utils/moneyRules'

type Inv = { id: string; number: string; subtotal?: number; amountPaid?: number; clientId?: string | null; clientName?: string }
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** Record a client payment (partial or full) — the invoice status follows automatically */
export default function RecordPaymentModal({ invoice, onClose, onChanged }: { invoice: Inv; onClose: () => void; onChanged: (s: { amountPaid: number; status: string }) => void }) {
  const allowed = usePermission()
  const [list, setList] = useState<ClientPayment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const total = Number(invoice.subtotal) || 0
  const paid = list.reduce((s, p) => s + p.amount, 0)
  const balance = Math.max(0, Math.round((total - Math.max(paid, Number(invoice.amountPaid) || 0)) * 100) / 100)
  const [form, setForm] = useState({ paidOn: localParts(Date.now()).date, amount: '', method: 'wire', reference: '', note: '' })

  async function load() {
    const r = await loadPayments({ invoiceId: invoice.id })
    setList(r.rows); setError(r.error)
  }
  useEffect(() => { void load() }, [invoice.id])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setForm(f => ({ ...f, amount: f.amount || (balance ? balance.toFixed(2) : '') })) }, [balance])

  async function refreshInvoice() { const s = await loadInvoicePaidState(invoice.id); if (s) onChanged(s) }
  async function save() {
    const amount = Number(form.amount.replace(',', '.'))
    if (!(amount > 0)) { setError('Enter the amount received.'); return }
    setSaving(true); setError(null)
    try {
      await recordPayment({ invoiceId: invoice.id, clientId: invoice.clientId, paidOn: form.paidOn, amount, method: form.method, reference: form.reference, note: form.note })
      setForm(f => ({ ...f, amount: '', reference: '', note: '' }))
      await load(); await refreshInvoice()
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }
  async function remove(p: ClientPayment) {
    if (!window.confirm(`Delete the ${usd(p.amount)} payment from ${p.paidOn}? The invoice balance goes back up.`)) return
    try { await deletePayment(p.id); await load(); await refreshInvoice() } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Payments · {invoice.number}{invoice.clientName ? ` · ${invoice.clientName}` : ''}</div>
          <button className="modal-close btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 18, fontSize: 13, flexWrap: 'wrap' }}>
            <span>Invoice <strong>{usd(total)}</strong></span>
            <span>Received <strong>{usd(Math.max(paid, Number(invoice.amountPaid) || 0))}</strong></span>
            <span>Balance <strong style={{ color: balance ? '#b45309' : '#15803d' }}>{usd(balance)}</strong></span>
          </div>
          {error && <div className="portal-message portal-message-error">{error}</div>}
          {list.length > 0 && (
            <div>
              {list.map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <strong>{usd(p.amount)}</strong>
                  <span>{p.paidOn}</span>
                  <span className="badge badge-gray">{PAYMENT_METHODS.find(m => m.value === p.method)?.label ?? p.method}</span>
                  {p.reference && <span style={{ color: 'var(--muted)' }}>{p.reference}</span>}
                  {p.source === 'stripe' && <span className="badge badge-blue">Portal card</span>}
                  {allowed('payments.record') && p.source !== 'stripe' && <button className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove(p)}>Delete</button>}
                </div>
              ))}
            </div>
          )}
          {allowed('payments.record') ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Date received</label>
                <input aria-label="Date received" className="form-input" type="date" value={form.paidOn} onChange={e => setForm(f => ({ ...f, paidOn: e.target.value }))} /></div>
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Amount (USD)</label>
                <input aria-label="Amount (USD)" className="form-input" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Method</label>
                <select aria-label="Method" className="form-select" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                  {PAYMENT_METHODS.filter(m => m.value !== 'card').map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></div>
              <div className="form-group" style={{ margin: 0 }}><label className="form-label">Reference</label>
                <input aria-label="Reference" className="form-input" value={form.reference} placeholder="e.g. confirmation #" onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></div>
            </div>
          ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>You can see payments but not record them (permission "Record client payments").</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
          {allowed('payments.record') && <button className="btn-primary btn-sm" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Record payment'}</button>}
        </div>
      </div>
    </div>
  )
}
