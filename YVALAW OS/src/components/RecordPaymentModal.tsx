import { useEffect, useRef, useState } from 'react'
import { deletePayment, loadInvoicePaidState, loadPayments, PAYMENT_METHODS, recordPayment, type ClientPayment } from '../services/payments'
import { usePermission } from '../context/RoleContext'
import { localParts } from '../utils/moneyRules'
import { Banner, Field, Modal, Pill } from './ui'

type Inv = { id: string; number: string; subtotal?: number; amountPaid?: number; clientId?: string | null; clientName?: string }
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** Record a client payment (partial or full) — the invoice status follows automatically */
export default function RecordPaymentModal({ invoice, onClose, onChanged }: { invoice: Inv; onClose: () => void; onChanged: (s: { amountPaid: number; status: string }) => void }) {
  const allowed = usePermission()
  const [list, setList] = useState<ClientPayment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const total = Number(invoice.subtotal) || 0
  const paid = list.reduce((s, p) => s + p.amount, 0)
  // invoices.amount_paid read fresh from the database (its trigger moves it with every payment row, and it also holds
  // legacy partial amounts recorded before payment rows existed). The prop is only a snapshot from when the modal opened.
  const [dbPaid, setDbPaid] = useState<number | null>(null)
  const received = dbPaid ?? Math.max(paid, Number(invoice.amountPaid) || 0)
  const balance = Math.max(0, Math.round((total - received) * 100) / 100)
  const [form, setForm] = useState({ paidOn: localParts(Date.now()).date, amount: '', method: 'wire', reference: '', note: '' })

  async function load() {
    const r = await loadPayments({ invoiceId: invoice.id })
    setList(r.rows); setError(r.error)
  }
  useEffect(() => {
    void load()
    void loadInvoicePaidState(invoice.id).then(s => { if (s) setDbPaid(s.amountPaid) })
  }, [invoice.id])   // eslint-disable-line react-hooks/exhaustive-deps
  // Pre-fill the balance; follow it when it changes (fresh amount_paid arrived, payment recorded) unless the user typed an amount
  const autoAmount = useRef('')
  useEffect(() => {
    const next = balance ? balance.toFixed(2) : ''
    setForm(f => ({ ...f, amount: !f.amount || f.amount === autoAmount.current ? next : f.amount }))
    autoAmount.current = next
  }, [balance])

  async function refreshInvoice() { const s = await loadInvoicePaidState(invoice.id); if (s) { setDbPaid(s.amountPaid); onChanged(s) } }
  async function save() {
    const amount = Number(form.amount.replace(',', '.'))
    if (!(amount > 0)) { setError('Enter the amount received.'); return }
    setSaving(true); setError(null); setDone(null)
    try {
      await recordPayment({ invoiceId: invoice.id, clientId: invoice.clientId, paidOn: form.paidOn, amount, method: form.method, reference: form.reference, note: form.note })
      setForm(f => ({ ...f, amount: '', reference: '', note: '' }))
      await load(); await refreshInvoice()
      setDone(`Payment of ${usd(amount)} recorded. The invoice status follows automatically.`)
    } catch (e) { setError((e as Error).message) }
    setSaving(false)
  }
  async function remove(p: ClientPayment) {
    if (!window.confirm(`Delete the ${usd(p.amount)} payment from ${p.paidOn}? The invoice balance goes back up.`)) return
    try { await deletePayment(p.id); await load(); await refreshInvoice() } catch (e) { setError((e as Error).message) }
  }

  const canRecord = allowed('payments.record')
  return (
    <Modal open onClose={onClose} title="Record payment"
      sub={`${invoice.number}${invoice.clientName ? ` · ${invoice.clientName}` : ''} · balance ${usd(balance)}`}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>{canRecord ? 'Cancel' : 'Close'}</button>
        {canRecord && <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save payment'}</button>}
      </>}>
      <div className="fin-pay-sum">
        <div className="fin-pay-sum__cell"><span className="info__label">Invoice</span><span className="fin-strong num">{usd(total)}</span></div>
        <div className="fin-pay-sum__cell"><span className="info__label">Received</span><span className="fin-strong num">{usd(received)}</span></div>
        <div className="fin-pay-sum__cell"><span className="info__label">Balance</span><span className={`fin-strong num ${balance ? 't-warning' : 't-success'}`}>{usd(balance)}</span></div>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      {done && <Banner tone="success">{done}</Banner>}
      {list.length > 0 && (
        <div className="fin-pay-list">
          {list.map(p => (
            <div key={p.id} className="fin-pay-list__row">
              <span className="fin-strong num">{usd(p.amount)}</span>
              <span className="muted">{p.paidOn}</span>
              <Pill tone="neutral">{PAYMENT_METHODS.find(m => m.value === p.method)?.label ?? p.method}</Pill>
              {p.reference && <span className="muted">{p.reference}</span>}
              {p.source === 'stripe' && <Pill tone="info">Portal card</Pill>}
              {canRecord && p.source !== 'stripe' && <button type="button" className="btn btn--xs btn--ghost btn--danger fin-pay-list__del" onClick={() => void remove(p)}>Delete</button>}
            </div>
          ))}
        </div>
      )}
      {canRecord ? (
        <div className="form-grid form-grid--2">
          <Field label="Amount (USD)"><input aria-label="Amount (USD)" className="input" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="Date received"><input aria-label="Date received" className="input" type="date" value={form.paidOn} onChange={e => setForm(f => ({ ...f, paidOn: e.target.value }))} /></Field>
          <Field label="Method">
            <select aria-label="Method" className="select" value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
              {PAYMENT_METHODS.filter(m => m.value !== 'card').map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Reference"><input aria-label="Reference" className="input" value={form.reference} placeholder="e.g. confirmation #" onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} /></Field>
        </div>
      ) : <div className="muted">You can see payments but not record them (permission "Record client payments").</div>}
    </Modal>
  )
}
