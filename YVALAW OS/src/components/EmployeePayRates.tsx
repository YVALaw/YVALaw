import { useEffect, useState } from 'react'
import type { Employee } from '../data/types'
import { supabase } from '../lib/supabase'
import { usePermission } from '../context/RoleContext'
import { addPlacementRate, deletePlacementRate, loadPlacementRates, type PlacementRate } from '../services/rates'
import { PAY_SCHEDULES, localParts, type PaySchedule } from '../utils/moneyRules'
import { Card, Field, Menu } from './ui'
import { P } from './Icon'

const rateDate = (d: string) => !d ? '—' : new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Employee profile → Pay & payout: dated pay-rate changes (raises) and the pay schedule (rates.manage) */
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
  const today = localParts(Date.now()).date
  const current = own.findIndex(r => (r.effective_from ?? '') <= today)   // older changes are shown greyed

  async function add() {
    try { await addPlacementRate({ employee_id: employee.id, project_id: null, bill_rate: null, pay_rate: form.pay, effective_from: form.from, note: form.note.trim() || null }); setAdding(false); setForm(f => ({ ...f, pay: '', note: '' })); await load() }
    catch (e) { setError((e as Error).message) }
  }
  async function saveSchedule(value: PaySchedule | '', anchor: string) {
    const before = schedule
    setSchedule({ value, anchor })
    const { error: e } = await supabase.from('employees').update({ pay_schedule: value || null, pay_anchor: value === 'biweekly' && anchor ? anchor : null }).eq('id', employee.id)
    if (e) { setSchedule(before); setError(e.message.includes('pay_schedule') ? 'Run supabase/migrate-step2-rates.sql first.' : e.message) }
    else { setSaved('Saved'); setTimeout(() => setSaved(null), 2000) }
  }

  return (
    <Card title="Pay rate history" className="ppl-payrates"
      actions={!adding && <button type="button" className="link" onClick={() => setAdding(true)}>+ Pay rate change</button>}>
      {error && <div className="card__body t-danger">{error}</div>}
      <div className="card__body ppl-payrates__base">
        Base pay rate <strong className="num">{employee.payRate ? `$${Number(employee.payRate).toFixed(2)}/hr` : 'not set'}</strong>
        <span className="muted"> · project-specific pay rates are set on each project's Team &amp; rates</span>
      </div>
      <div className="section-label ppl-pad-x">Pay rate changes</div>
      {own.length === 0 && <div className="list-row muted">None — the base pay rate applies.</div>}
      {own.map((r, i) => (
        <div key={r.id} className={`list-row${current >= 0 && i > current ? ' ppl-old' : ''}`}>
          <div className="list-row__main">
            <span className="list-row__title">From {rateDate(r.effective_from ?? '')}<span className="sr-only"> ({r.effective_from})</span></span>
            {(r.note || (r.effective_from ?? '') > today) && <span className="list-row__meta">{(r.effective_from ?? '') > today ? 'Upcoming' : ''}{(r.effective_from ?? '') > today && r.note ? ' · ' : ''}{r.note}</span>}
          </div>
          <strong className="num">${Number(r.pay_rate).toFixed(2)}/hr</strong>
          <Menu label="Pay rate change actions" buttonClass="btn btn--icon btn--sm btn--ghost" items={[{ label: 'Delete', icon: P.trash, danger: true, onClick: () => { if (window.confirm('Delete this pay rate change?')) void deletePlacementRate(r.id).then(load).catch(e => setError(e.message)) } }]} />
        </div>
      ))}
      {adding && (
        <div className="ppl-inline-form">
          <Field label="From"><input aria-label="From" className="input input--sm" type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></Field>
          <Field label="Pay $/hr"><input aria-label="Pay $/hr" className="input input--sm" inputMode="decimal" value={form.pay} onChange={e => setForm(f => ({ ...f, pay: e.target.value }))} /></Field>
          <Field label="Note"><input aria-label="Note" className="input input--sm" value={form.note} placeholder="e.g. 6-month raise" onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
          <div className="ppl-inline-form__btns">
            <button type="button" className="btn btn--sm" onClick={() => setAdding(false)}>Cancel</button>
            <button type="button" className="btn btn--sm btn--primary" disabled={!form.pay.trim() || !form.from} onClick={() => void add()}>Save</button>
          </div>
        </div>
      )}
      <div className="card__foot ppl-foot-left">
        <Field label={<>Pay schedule {saved && <span className="t-success">· {saved}</span>}</>}>
          <select aria-label="Pay schedule" className="select select--sm" value={schedule.value} onChange={e => void saveSchedule(e.target.value as PaySchedule | '', schedule.anchor)}>
            <option value="">Follow the project{employee.worksFor === 'yva' ? ' (weekly for the YVA team)' : ''}</option>
            {PAY_SCHEDULES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {schedule.value === 'biweekly' && (
          <Field label="Period starts (a Monday)"><input className="input input--sm" type="date" value={schedule.anchor} onChange={e => void saveSchedule('biweekly', e.target.value)} /></Field>
        )}
      </div>
    </Card>
  )
}
