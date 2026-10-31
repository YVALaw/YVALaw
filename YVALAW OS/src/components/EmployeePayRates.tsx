import { useEffect, useState } from 'react'
import type { Employee } from '../data/types'
import { supabase } from '../lib/supabase'
import { usePermission } from '../context/RoleContext'
import { addPlacementRate, deletePlacementRate, loadPlacementRates, type PlacementRate } from '../services/rates'
import { PAY_SCHEDULES, localParts, type PaySchedule } from '../utils/moneyRules'

/** Employee profile → Pay: dated pay-rate changes (raises) and the YVA-team pay schedule (rates.manage) */
export default function EmployeePayRates({ employee }: { employee: Employee }) {
  const allowed = usePermission()
  const [rows, setRows] = useState<PlacementRate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ from: localParts(Date.now()).date, pay: '', note: '' })
  const [schedule, setSchedule] = useState<{ value: PaySchedule | ''; anchor: string }>({ value: employee.paySchedule ?? '', anchor: employee.payAnchor ?? '' })
  const [saved, setSaved] = useState<string | null>(null)

  async function load() { const r = await loadPlacementRates({ employeeId: employee.id }); setRows(r.rows); setError(r.error) }
  const canRates = allowed('rates.manage')   // arrives after the first render for non-CEO roles
  useEffect(() => { if (canRates) void load() }, [employee.id, canRates])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!canRates) return null
  const own = rows.filter(r => !r.project_id)

  async function add() {
    try { await addPlacementRate({ employee_id: employee.id, project_id: null, bill_rate: null, pay_rate: form.pay, effective_from: form.from, note: form.note.trim() || null }); setAdding(false); setForm(f => ({ ...f, pay: '', note: '' })); await load() }
    catch (e) { setError((e as Error).message) }
  }
  async function saveSchedule(value: PaySchedule | '', anchor: string) {
    setSchedule({ value, anchor })
    const { error: e } = await supabase.from('employees').update({ pay_schedule: value || null, pay_anchor: value === 'biweekly' && anchor ? anchor : null }).eq('id', employee.id)
    if (e) setError(e.message.includes('pay_schedule') ? 'Run supabase/migrate-step2-rates.sql first.' : e.message)
    else { setSaved('Saved'); setTimeout(() => setSaved(null), 2000) }
  }

  return (
    <div className="data-card">
      <div className="data-card-title">Pay</div>
      {error && <div className="portal-message portal-message-error" style={{ margin: '8px 0' }}>{error}</div>}
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        Base pay rate: <strong>{employee.payRate ? `$${Number(employee.payRate).toFixed(2)}/hr` : 'not set'}</strong>
        <span style={{ color: 'var(--muted)' }}> · project-specific pay rates are set on each project's Rates card</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0' }}>Pay rate changes</div>
      {own.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>None — the base pay rate applies.</div>}
      {own.map(r => (
        <div key={r.id} style={{ display: 'flex', gap: 12, fontSize: 13, padding: '4px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>From {r.effective_from}</strong><span>${Number(r.pay_rate).toFixed(2)}/hr</span>{r.note && <span style={{ color: 'var(--muted)' }}>{r.note}</span>}
          <button className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { if (window.confirm('Delete this pay rate change?')) void deletePlacementRate(r.id).then(load).catch(e => setError(e.message)) }}>Delete</button>
        </div>
      ))}
      {adding ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <div className="form-group" style={{ margin: 0 }}><label className="form-label">From</label><input aria-label="From" className="form-input form-input-sm" type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></div>
          <div className="form-group" style={{ margin: 0, width: 110 }}><label className="form-label">Pay $/hr</label><input aria-label="Pay $/hr" className="form-input form-input-sm" inputMode="decimal" value={form.pay} onChange={e => setForm(f => ({ ...f, pay: e.target.value }))} /></div>
          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 140 }}><label className="form-label">Note</label><input aria-label="Note" className="form-input form-input-sm" value={form.note} placeholder="e.g. 6-month raise" onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></div>
          <button className="btn-primary btn-sm" disabled={!form.pay.trim() || !form.from} onClick={() => void add()}>Save</button>
          <button className="btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : <button className="btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>+ Pay rate change</button>}

      <div className="form-group" style={{ marginTop: 14, maxWidth: 320 }}>
        <label className="form-label">Pay schedule {saved && <span style={{ color: '#15803d', fontWeight: 600 }}>· {saved}</span>}</label>
        <select className="form-select" value={schedule.value} onChange={e => void saveSchedule(e.target.value as PaySchedule | '', schedule.anchor)}>
          <option value="">Follow the project{employee.worksFor === 'yva' ? ' (weekly for the YVA team)' : ''}</option>
          {PAY_SCHEDULES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {schedule.value === 'biweekly' && (
          <input className="form-input" style={{ marginTop: 6 }} type="date" value={schedule.anchor} title="A Monday that starts a two-week period" onChange={e => void saveSchedule('biweekly', e.target.value)} />
        )}
      </div>
    </div>
  )
}
