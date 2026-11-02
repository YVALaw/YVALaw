import { useEffect, useState } from 'react'
import { usePermission } from '../context/RoleContext'
import { DR_BANKS, loadPayoutMethods, savePayoutMethod, type PayoutMethod } from '../services/payroll'
import { Card, Field } from './ui'
import { Ic, P } from './Icon'
import { useToast } from '../context/ToastContext'

const empty = (id: string): PayoutMethod => ({ employee_id: id, method: 'bank', bank_name: 'BHD', account_type: 'savings', account_number: '', holder_name: '', holder_id: '', paypal_email: '', currency: 'DOP' })
const tail = (v: string | null | undefined, n = 4) => (v ? `•• ${v.replace(/\s/g, '').slice(-n)}` : '—')
const maskId = (v: string | null | undefined) => (v ? `•••-${v.replace(/[\s-]/g, '').slice(-3)}` : '')
const maskMail = (v: string | null | undefined) => { if (!v) return '—'; const [u, d] = v.split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : '•••' }

/** Employee profile → Payout: bank (any DR bank) or PayPal, shown masked. bank.view to see, bank.manage to change. */
export default function EmployeePayoutMethod({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const allowed = usePermission()
  const [p, setP] = useState<PayoutMethod | null>(null)
  const [editing, setEditing] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [form, setForm] = useState<PayoutMethod>(empty(employeeId))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)   // only "could not load" (save results are toasts)
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  // bank.manage can read too (DB policy). Permissions arrive after the first render for non-CEO roles, so re-run then.
  // Change/Add stay hidden until the current details are loaded, so a blank form can't overwrite a real account.
  const canSee = allowed('bank.view') || allowed('bank.manage')
  useEffect(() => {
    if (!canSee) return
    let alive = true
    setLoaded(false)
    void loadPayoutMethods()
      .then(all => { if (alive) { setP(all.find(x => x.employee_id === employeeId) ?? null); setLoaded(true) } })
      .catch(e => { if (alive) setMsg({ ok: false, text: `Could not load payout details: ${(e as Error).message}` }) })
    return () => { alive = false }
  }, [employeeId, canSee])
  if (!canSee) return null

  async function save() {
    setSaving(true)
    try {
      const row = { ...form, holder_name: form.holder_name || employeeName, account_number: form.method === 'bank' ? form.account_number?.replace(/\s/g, '') || null : null,
        paypal_email: form.method === 'paypal' ? form.paypal_email : null, bank_name: form.method === 'bank' ? form.bank_name : null }
      await savePayoutMethod(row); setP(row); setEditing(false); setReveal(false); toast.success('Payout method saved.')
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }
  const set = (patch: Partial<PayoutMethod>) => setForm(f => ({ ...f, ...patch }))
  const canEdit = allowed('bank.manage') && loaded && !editing

  return (
    <Card title="Payout method" className="ppl-payout"
      meta={msg ? <span className={msg.ok ? 't-success' : 't-danger'}>{msg.text}</span> : undefined}
      actions={canEdit && <button type="button" className="link" onClick={() => { setForm(p ?? empty(employeeId)); setEditing(true); setMsg(null) }}>{p ? 'Edit' : 'Add'}</button>}>
      {!editing ? (
        <div className="card__body ppl-payout__body">
          {!loaded && !msg ? <span className="muted">Loading…</span> : p ? (p.method === 'paypal' ? <>
            <span className="ppl-payout__main">PayPal · {reveal ? p.paypal_email : maskMail(p.paypal_email)}</span>
            <span className="muted">Paid in {p.currency}</span>
          </> : <>
            <span className="ppl-payout__main">{p.bank_name} · {p.account_type === 'checking' ? 'checking' : 'savings'} <span className="num">{reveal ? p.account_number : tail(p.account_number)}</span></span>
            <span className="muted">Account holder {p.holder_name || employeeName}{p.holder_id ? <> · cédula <span className="num">{reveal ? p.holder_id : maskId(p.holder_id)}</span></> : null} · {p.currency}</span>
          </>) : <span className="muted">No bank or PayPal details yet.</span>}
          {p && (
            <button type="button" className="link ppl-payout__reveal" onClick={() => setReveal(r => !r)}>
              <Ic d={P.eye} size={14} />{reveal ? 'Hide full numbers' : 'Show full numbers'}
            </button>
          )}
          <span className="ppl-fine">Full numbers are visible with the bank.view permission only.</span>
        </div>
      ) : (
        <div className="card__body">
          <div className="form-grid">
            <Field label="Paid by">
              <select aria-label="Paid by" className="select" value={form.method} onChange={e => set({ method: e.target.value as 'bank' | 'paypal', currency: e.target.value === 'paypal' ? 'USD' : 'DOP' })}><option value="bank">Bank transfer (DR)</option><option value="paypal">PayPal</option></select>
            </Field>
            {form.method === 'bank' ? <>
              <Field label="Bank"><select aria-label="Bank" className="select" value={form.bank_name ?? ''} onChange={e => set({ bank_name: e.target.value })}>{DR_BANKS.map(b => <option key={b}>{b}</option>)}</select></Field>
              <Field label="Account type"><select aria-label="Account type" className="select" value={form.account_type ?? 'savings'} onChange={e => set({ account_type: e.target.value as 'savings' | 'checking' })}><option value="savings">Savings</option><option value="checking">Checking</option></select></Field>
              <Field label="Account number"><input aria-label="Account number" className="input" inputMode="numeric" value={form.account_number ?? ''} onChange={e => set({ account_number: e.target.value })} /></Field>
              <Field label="Account holder"><input aria-label="Account holder" className="input" value={form.holder_name ?? ''} placeholder={employeeName} onChange={e => set({ holder_name: e.target.value })} /></Field>
              <Field label="Cédula"><input aria-label="Cédula" className="input" value={form.holder_id ?? ''} onChange={e => set({ holder_id: e.target.value })} /></Field>
            </> : <>
              <Field label="PayPal email"><input aria-label="PayPal email" className="input" type="email" value={form.paypal_email ?? ''} onChange={e => set({ paypal_email: e.target.value })} /></Field>
              <Field label="Currency"><select aria-label="Currency" className="select" value={form.currency} onChange={e => set({ currency: e.target.value as 'DOP' | 'USD' })}><option value="USD">USD</option><option value="DOP">DOP</option></select></Field>
            </>}
          </div>
          <div className="ppl-inline-form__btns ppl-mt">
            <button type="button" className="btn btn--sm" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="btn btn--sm btn--primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </Card>
  )
}
