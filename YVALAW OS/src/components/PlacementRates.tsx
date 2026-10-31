import { useEffect, useState } from 'react'
import type { Client, Employee, Project } from '../data/types'
import { usePermission } from '../context/RoleContext'
import { addPlacementRate, deletePlacementRate, loadPlacementRates, rateClient, rateEmployee, rateProject, type PlacementRate } from '../services/rates'
import { BILL_SOURCE_LABEL, PAY_SOURCE_LABEL, localParts, resolveRates } from '../utils/moneyRules'

const today = () => localParts(Date.now()).date
const money = (n: number) => (n ? `$${n.toFixed(2)}` : '—')

/** Project → Team rates: position, bill rate (client) and pay rate (employee) per person, from a date */
export default function PlacementRates({ project, members, client }: { project: Project; members: Employee[]; client?: Client | null }) {
  const allowed = usePermission()
  const [rows, setRows] = useState<PlacementRate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [history, setHistory] = useState<string | null>(null)
  const [form, setForm] = useState({ from: today(), position: '', bill: '', pay: '', note: '' })
  const [saving, setSaving] = useState(false)

  async function load() {
    const r = await loadPlacementRates()           // all rows: the employee's own dated pay rate is a fallback too
    setRows(r.rows.filter(x => x.project_id === project.id || (!x.project_id && members.some(m => m.id === x.employee_id))))
    setError(r.error)
  }
  useEffect(() => { if (allowed('rates.manage')) void load() }, [project.id, members.length])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!allowed('rates.manage')) return null

  const resolved = (e: Employee) => resolveRates({ employee: rateEmployee(e), project: rateProject(project), client: client ? rateClient(client) : null, rates: rows, day: today() })

  function startEdit(e: Employee) {
    const r = resolved(e)
    setEditing(e.id); setHistory(null)
    setForm({ from: today(), position: r.position === (e.role || '') ? '' : r.position, bill: r.bill.source === 'placement' ? String(r.bill.rate) : '', pay: r.pay.source === 'placement' ? String(r.pay.rate) : '', note: '' })
  }
  async function save(e: Employee) {
    setSaving(true); setError(null)
    try {
      await addPlacementRate({ employee_id: e.id, project_id: project.id, position: form.position.trim() || null, bill_rate: form.bill, pay_rate: form.pay, effective_from: form.from, note: form.note.trim() || null })
      setEditing(null); await load()
    } catch (err) { setError((err as Error).message) }
    setSaving(false)
  }
  async function remove(id: string) {
    if (!window.confirm('Delete this rate change? Weeks it applied to fall back to the previous rate.')) return
    try { await deletePlacementRate(id); await load() } catch (err) { setError((err as Error).message) }
  }

  return (
    <div className="data-card">
      <div className="data-card-title">Rates <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 12 }}>· bill rate = client · pay rate = employee · never shown to each other</span></div>
      {error && <div className="portal-message portal-message-error" style={{ margin: '8px 0' }}>{error}</div>}
      {members.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>Add people to the team first.</div> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Person</th><th>Position</th><th style={{ textAlign: 'right' }}>Bill rate</th><th style={{ textAlign: 'right' }}>Pay rate</th><th></th></tr></thead>
            <tbody>
              {members.map(e => {
                const r = resolved(e)
                const changes = rows.filter(x => x.employee_id === e.id && x.project_id === project.id)
                return [
                  <tr key={e.id}>
                    <td className="td-name">{e.name}</td>
                    <td className="td-muted">{r.position || '—'}</td>
                    <td style={{ textAlign: 'right' }} title={BILL_SOURCE_LABEL[r.bill.source]}>
                      <strong style={{ color: r.bill.rate ? 'var(--text)' : '#dc2626' }}>{money(r.bill.rate)}</strong>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{BILL_SOURCE_LABEL[r.bill.source]}</div>
                    </td>
                    <td style={{ textAlign: 'right' }} title={PAY_SOURCE_LABEL[r.pay.source]}>
                      <strong style={{ color: r.pay.rate ? 'var(--text)' : '#dc2626' }}>{money(r.pay.rate)}</strong>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{PAY_SOURCE_LABEL[r.pay.source]}</div>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn-ghost btn-sm" onClick={() => startEdit(e)}>Change</button>
                      {changes.length > 0 && <button className="btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setHistory(h => (h === e.id ? null : e.id))}>History ({changes.length})</button>}
                    </td>
                  </tr>,
                  editing === e.id && (
                    <tr key={`${e.id}-edit`}><td colSpan={5} style={{ background: 'var(--surf2)' }}>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div className="form-group" style={{ margin: 0 }}><label className="form-label">From</label>
                          <input aria-label="From" className="form-input form-input-sm" type="date" value={form.from} onChange={ev => setForm(f => ({ ...f, from: ev.target.value }))} /></div>
                        <div className="form-group" style={{ margin: 0, minWidth: 160 }}><label className="form-label">Position (optional)</label>
                          <input aria-label="Position" className="form-input form-input-sm" value={form.position} placeholder={e.role || 'e.g. Intake Specialist'} onChange={ev => setForm(f => ({ ...f, position: ev.target.value }))} /></div>
                        <div className="form-group" style={{ margin: 0, width: 110 }}><label className="form-label">Bill $/hr</label>
                          <input aria-label="Bill $/hr" className="form-input form-input-sm" inputMode="decimal" value={form.bill} placeholder={project.rate ? String(project.rate) : ''} onChange={ev => setForm(f => ({ ...f, bill: ev.target.value }))} /></div>
                        <div className="form-group" style={{ margin: 0, width: 110 }}><label className="form-label">Pay $/hr</label>
                          <input aria-label="Pay $/hr" className="form-input form-input-sm" inputMode="decimal" value={form.pay} placeholder={e.payRate ? String(e.payRate) : ''} onChange={ev => setForm(f => ({ ...f, pay: ev.target.value }))} /></div>
                        <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 160 }}><label className="form-label">Note</label>
                          <input aria-label="Note" className="form-input form-input-sm" value={form.note} placeholder="e.g. raise after 6 months" onChange={ev => setForm(f => ({ ...f, note: ev.target.value }))} /></div>
                        <button className="btn-primary btn-sm" disabled={saving || !form.from || (!form.bill.trim() && !form.pay.trim() && !form.position.trim())} onClick={() => void save(e)}>{saving ? 'Saving…' : 'Save'}</button>
                        <button className="btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Leave a rate empty to keep using the project / employee rate. Weeks before "From" keep their old rate.</div>
                    </td></tr>
                  ),
                  history === e.id && (
                    <tr key={`${e.id}-hist`}><td colSpan={5} style={{ background: 'var(--surf2)' }}>
                      {changes.map(c => (
                        <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, padding: '4px 0', flexWrap: 'wrap' }}>
                          <strong style={{ minWidth: 92 }}>From {c.effective_from}</strong>
                          {c.position && <span>{c.position}</span>}
                          {c.bill_rate != null && <span>Bill ${Number(c.bill_rate).toFixed(2)}</span>}
                          {c.pay_rate != null && <span>Pay ${Number(c.pay_rate).toFixed(2)}</span>}
                          {c.note && <span style={{ color: 'var(--muted)' }}>{c.note}</span>}
                          <button className="btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void remove(c.id)}>Delete</button>
                        </div>
                      ))}
                    </td></tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
