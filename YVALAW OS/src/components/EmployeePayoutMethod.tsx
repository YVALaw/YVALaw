import { useEffect, useState } from 'react'
import { usePermission } from '../context/RoleContext'
import { DR_BANKS, loadPayoutMethods, savePayoutMethod, type PayoutMethod } from '../services/payroll'

const empty = (id: string): PayoutMethod => ({ employee_id: id, method: 'bank', bank_name: 'BHD', account_type: 'savings', account_number: '', holder_name: '', holder_id: '', paypal_email: '', currency: 'DOP' })

/** Employee profile → Payout: bank (any DR bank) or PayPal. bank.view to see, bank.manage to change. */
export default function EmployeePayoutMethod({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const allowed = usePermission()
  const [p, setP] = useState<PayoutMethod | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<PayoutMethod>(empty(employeeId))
  const [msg, setMsg] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  // bank.manage can read too (DB policy). Permissions arrive after the first render for non-CEO roles, so re-run then.
  // Change/Add stay hidden until the current details are loaded, so a blank form can't overwrite a real account.
  const canSee = allowed('bank.view') || allowed('bank.manage')
  useEffect(() => {
    if (!canSee) return
    let alive = true
    setLoaded(false)
    void loadPayoutMethods()
      .then(all => { if (alive) { setP(all.find(x => x.employee_id === employeeId) ?? null); setLoaded(true) } })
      .catch(e => { if (alive) setMsg(`Could not load payout details: ${(e as Error).message}`) })
    return () => { alive = false }
  }, [employeeId, canSee])
  if (!canSee) return null

  async function save() {
    try {
      const row = { ...form, holder_name: form.holder_name || employeeName, account_number: form.method === 'bank' ? form.account_number?.replace(/\s/g, '') || null : null,
        paypal_email: form.method === 'paypal' ? form.paypal_email : null, bank_name: form.method === 'bank' ? form.bank_name : null }
      await savePayoutMethod(row); setP(row); setEditing(false); setMsg('Saved')
    } catch (e) { setMsg((e as Error).message) }
  }
  const set = (patch: Partial<PayoutMethod>) => setForm(f => ({ ...f, ...patch }))

  return (
    <div className="data-card">
      <div className="data-card-title">Payout {msg && <span style={{ fontWeight: 500, fontSize: 12, color: msg === 'Saved' ? '#15803d' : '#dc2626' }}>· {msg}</span>}</div>
      {!editing ? (
        <div style={{ fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {p ? (p.method === 'paypal'
            ? <span>PayPal · <strong>{p.paypal_email}</strong> · paid in {p.currency}</span>
            : <span>{p.bank_name} · {p.account_type === 'checking' ? 'Checking' : 'Savings'} <strong>{p.account_number}</strong>{p.holder_id ? ` · ID ${p.holder_id}` : ''} · {p.currency}</span>)
            : <span style={{ color: 'var(--muted)' }}>No bank or PayPal details yet.</span>}
          {allowed('bank.manage') && loaded && <button className="btn-ghost btn-sm" onClick={() => { setForm(p ?? empty(employeeId)); setEditing(true) }}>{p ? 'Change' : 'Add'}</button>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label">Paid by</label>
            <select aria-label="Paid by" className="form-select" value={form.method} onChange={e => set({ method: e.target.value as 'bank' | 'paypal', currency: e.target.value === 'paypal' ? 'USD' : 'DOP' })}><option value="bank">Bank transfer (DR)</option><option value="paypal">PayPal</option></select></div>
          {form.method === 'bank' ? <>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Bank</label>
              <select aria-label="Bank" className="form-select" value={form.bank_name ?? ''} onChange={e => set({ bank_name: e.target.value })}>{DR_BANKS.map(b => <option key={b}>{b}</option>)}</select></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Account type</label>
              <select aria-label="Account type" className="form-select" value={form.account_type ?? 'savings'} onChange={e => set({ account_type: e.target.value as 'savings' | 'checking' })}><option value="savings">Savings</option><option value="checking">Checking</option></select></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Account number</label><input aria-label="Account number" className="form-input" value={form.account_number ?? ''} onChange={e => set({ account_number: e.target.value })} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Account holder</label><input aria-label="Account holder" className="form-input" value={form.holder_name ?? ''} placeholder={employeeName} onChange={e => set({ holder_name: e.target.value })} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Cédula</label><input aria-label="Cédula" className="form-input" value={form.holder_id ?? ''} onChange={e => set({ holder_id: e.target.value })} /></div>
          </> : <>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">PayPal email</label><input aria-label="PayPal email" className="form-input" type="email" value={form.paypal_email ?? ''} onChange={e => set({ paypal_email: e.target.value })} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Currency</label>
              <select aria-label="Currency" className="form-select" value={form.currency} onChange={e => set({ currency: e.target.value as 'DOP' | 'USD' })}><option value="USD">USD</option><option value="DOP">DOP</option></select></div>
          </>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="btn-primary btn-sm" onClick={() => void save()}>Save</button>
            <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
