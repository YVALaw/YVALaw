import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Client, Employee, Project } from '../data/types'
import { usePermission } from '../context/RoleContext'
import { addPlacementRate, deletePlacementRate, loadPlacementRates, rateClient, rateEmployee, rateProject, type PlacementRate } from '../services/rates'
import { BILL_SOURCE_LABEL, PAY_SOURCE_LABEL, localParts, num, resolveRates, type Resolved } from '../utils/moneyRules'
import { dateMed } from '../utils/format'
import { Banner, Field, Menu, Modal, Pill, Skel, useIsMobile } from './ui'

const today = () => localParts(Date.now()).date
const money = (n: number) => (n ? `$${n.toFixed(2)}` : '—')
const marginOf = (bill: number, pay: number) => (bill > 0 && pay > 0 ? `${Math.round(((bill - pay) / bill) * 100)}%` : '—')

type Form = { employeeId: string; from: string; position: string; bill: string; pay: string; note: string }

/** Project → Team & rates: position, bill rate (client) and pay rate (employee) per person, from a date.
 *  Bill: placement → project → client default. Pay: placement → person. Needs rates.manage. */
export default function PlacementRates({ project, members, client, onAddPeople }: { project: Project; members: Employee[]; client?: Client | null; onAddPeople?: () => void }) {
  const allowed = usePermission()
  const mobile = useIsMobile()
  const [rows, setRows] = useState<PlacementRate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const r = await loadPlacementRates()           // all rows: the employee's own dated pay rate is a fallback too
    setRows(r.rows.filter(x => x.project_id === project.id || (!x.project_id && members.some(m => m.id === x.employee_id))))
    setError(r.error)
  }
  const canRates = allowed('rates.manage')   // arrives after the first render for non-CEO roles
  useEffect(() => { if (canRates) void load() }, [project.id, members.length, canRates])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!canRates) return null

  const resolved = (e: Employee): Resolved => resolveRates({ employee: rateEmployee(e), project: rateProject(project), client: client ? rateClient(client) : null, rates: rows ?? [], day: today() })
  const changesOf = (e: Employee) => (rows ?? []).filter(x => x.employee_id === e.id && x.project_id === project.id)
    .sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || '')))

  function startEdit(e?: Employee) {
    const emp = e ?? members[0]
    if (!emp) return
    const r = resolved(emp)
    setError(null)
    setForm({ employeeId: emp.id, from: today(), position: r.position === (emp.role || '') ? '' : r.position, bill: r.bill.source === 'placement' ? String(r.bill.rate) : '', pay: r.pay.source === 'placement' ? String(r.pay.rate) : '', note: '' })
  }
  async function save() {
    if (!form) return
    const emp = members.find(m => m.id === form.employeeId)
    setSaving(true); setError(null)
    try {
      await addPlacementRate({ employee_id: form.employeeId, project_id: project.id, position: form.position.trim() || null, bill_rate: form.bill, pay_rate: form.pay, effective_from: form.from, note: form.note.trim() || null })
      setForm(null); setFlash(`Rate change saved for ${emp?.name ?? 'this person'} from ${dateMed(form.from)}.`)
      await load()
    } catch (err) { setError((err as Error).message) }
    setSaving(false)
  }
  async function remove(c: PlacementRate) {
    if (!window.confirm('Delete this rate change? Weeks it applied to fall back to the previous rate.')) return
    setError(null)
    try { await deletePlacementRate(c.id); setFlash('Rate change deleted.'); await load() } catch (err) { setError((err as Error).message) }
  }

  const effective = (r: Resolved) => {
    const froms = [r.bill.source === 'placement' ? r.bill.from : undefined, r.pay.source === 'placement' ? r.pay.from : undefined].filter(Boolean) as string[]
    if (froms.length) return dateMed(froms.sort().pop()!)
    return r.bill.source === 'none' && r.pay.source === 'none' ? '—' : 'Default rates'
  }
  /** Rate changes that are not what applies today: upcoming (future date) or previous (superseded) */
  const otherChanges = (e: Employee, r: Resolved) => changesOf(e).filter(c => {
    const from = c.effective_from || ''
    if (from > today()) return true
    const drivesBill = r.bill.source === 'placement' && r.bill.from === c.effective_from && num(c.bill_rate) > 0
    const drivesPay = r.pay.source === 'placement' && r.pay.from === c.effective_from && num(c.pay_rate) > 0
    return !drivesBill && !drivesPay
  })
  const driving = (e: Employee, r: Resolved) => changesOf(e).filter(c => !otherChanges(e, r).includes(c))

  const head = (
    <div className="card__head ops-rates__head">
      <div className="ops-rates__title">
        <h2 className="card__title">Team and rates</h2>
        <span className="card__meta">Bill rate: placement → project → client default. Pay rate: placement → person. Clients never see pay, employees never see bill.</span>
      </div>
      <div className="row">
        {onAddPeople && <button type="button" className="btn btn--sm" onClick={onAddPeople}>Edit team</button>}
        {members.length > 0 && <button type="button" className="btn btn--sm" onClick={() => startEdit()}>+ Rate change</button>}
      </div>
    </div>
  )

  const rateCell = (rate: number, sourceLabel: string) => (
    <>
      <span className={rate ? 'ops-rate' : 'ops-rate t-danger'}>{rate ? money(rate) : 'Missing'}</span>
      <span className={`ops-rate__src${rate ? '' : ' t-danger'}`}>{sourceLabel}</span>
    </>
  )

  return (
    <section className="card ops-rates" aria-label="Team and rates">
      {head}
      <div className="ops-rates__msgs">
        {flash && <Banner tone="success" onClose={() => setFlash(null)}>{flash}</Banner>}
        {error && !form && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      </div>
      {members.length === 0 ? (
        <div className="card-empty">Add people to the team first.{onAddPeople && <> <button type="button" className="link" onClick={onAddPeople}>Edit team</button></>}</div>
      ) : rows === null ? (
        <div className="card__body stack">{members.map(m => <Skel key={m.id} h={36} />)}</div>
      ) : mobile ? (
        <div className="mcards ops-rates__cards">
          {members.map(e => {
            const r = resolved(e)
            return (
              <div key={e.id} className="mcard">
                <div className="mcard__top">
                  <div><div className="mcard__title"><Link to={`/employees/${e.id}`}>{e.name}</Link></div><div className="mcard__meta">{r.position || '—'}</div></div>
                  <span className="mcard__meta">{marginOf(r.bill.rate, r.pay.rate)} margin</span>
                </div>
                <div className="ops-mini-grid">
                  <div className="info"><span className="info__label">Bill</span><span className="info__value">{rateCell(r.bill.rate, BILL_SOURCE_LABEL[r.bill.source])}</span></div>
                  <div className="info"><span className="info__label">Pay</span><span className="info__value">{rateCell(r.pay.rate, PAY_SOURCE_LABEL[r.pay.source])}</span></div>
                  <div className="info"><span className="info__label">Effective</span><span className="info__value">{effective(r)}</span></div>
                </div>
                {otherChanges(e, r).map(c => (
                  <div key={c.id} className="ops-rates__old-line">
                    {(c.effective_from || '') > today() ? 'Upcoming' : 'Previous'} from {dateMed(c.effective_from)}: {c.bill_rate != null ? `bill $${Number(c.bill_rate).toFixed(2)}` : ''}{c.bill_rate != null && c.pay_rate != null ? ' · ' : ''}{c.pay_rate != null ? `pay $${Number(c.pay_rate).toFixed(2)}` : ''}
                    <button type="button" className="link t-danger" onClick={() => void remove(c)}>Delete</button>
                  </div>
                ))}
                <div className="mcard__actions"><button type="button" className="btn" onClick={() => startEdit(e)}>Change rate</button></div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ops-rates__scroll">
          <table className="table ops-rates__table">
            <thead>
              <tr><th>Person</th><th>Position</th><th className="t-right">Bill</th><th className="t-right">Pay</th><th className="t-right">Margin</th><th>Effective</th><th>Note</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {members.map(e => {
                const r = resolved(e)
                const others = otherChanges(e, r)
                const cur = driving(e, r)
                return [
                  <tr key={e.id} data-person={e.name}>
                    <td className="t-strong"><Link to={`/employees/${e.id}`} className="ops-plain-link">{e.name}</Link></td>
                    <td className="ops-cell-2">{r.position || '—'}</td>
                    <td className="t-num" title={BILL_SOURCE_LABEL[r.bill.source]}>{rateCell(r.bill.rate, BILL_SOURCE_LABEL[r.bill.source])}</td>
                    <td className="t-num" title={PAY_SOURCE_LABEL[r.pay.source]}>{rateCell(r.pay.rate, PAY_SOURCE_LABEL[r.pay.source])}</td>
                    <td className="t-num muted">{marginOf(r.bill.rate, r.pay.rate)}</td>
                    <td className="muted">{effective(r)}</td>
                    <td className="muted">{!r.bill.rate || !r.pay.rate ? <span className="t-danger">Set before weekly close</span> : cur.find(c => c.note)?.note ?? ''}</td>
                    <td className="t-actions">
                      <button type="button" className="btn btn--xs" onClick={() => startEdit(e)}>Change</button>
                      <Menu label={`More for ${e.name}`} buttonClass="btn btn--xs btn--icon ops-xs-icon" items={cur.map(c => ({ label: `Delete change from ${dateMed(c.effective_from)}`, danger: true, onClick: () => void remove(c) }))} />
                    </td>
                  </tr>,
                  ...others.map(c => {
                    const upcoming = (c.effective_from || '') > today()
                    return (
                      <tr key={c.id} className={upcoming ? 'ops-rates__upcoming' : 'ops-rates__old'}>
                        <td>{e.name}</td>
                        <td>{c.position || '—'}</td>
                        <td className="t-num">{c.bill_rate != null ? money(Number(c.bill_rate)) : '—'}</td>
                        <td className="t-num">{c.pay_rate != null ? money(Number(c.pay_rate)) : '—'}</td>
                        <td className="t-num">{marginOf(num(c.bill_rate), num(c.pay_rate))}</td>
                        <td>From {dateMed(c.effective_from)}</td>
                        <td>{upcoming ? <Pill tone="info">Upcoming</Pill> : 'Previous rate'}{c.note ? ` · ${c.note}` : ''}</td>
                        <td className="t-actions"><Menu label="Rate change actions" buttonClass="btn btn--xs btn--icon ops-xs-icon" items={[{ label: 'Delete this change', danger: true, onClick: () => void remove(c) }]} /></td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="Rate change" sub="Leave a rate empty to keep using the project / employee rate. Weeks before “From” keep their old rate."
        footer={<>
          <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={saving || !form?.from || !form?.employeeId || (!form?.bill.trim() && !form?.pay.trim() && !form?.position.trim())} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
        </>}>
        {form && (() => {
          const emp = members.find(m => m.id === form.employeeId)
          return (
            <div className="form-grid form-grid--2">
              {error && <div className="field--full"><Banner tone="danger">{error}</Banner></div>}
              <Field label="Person" full>
                <select className="select" aria-label="Person" value={form.employeeId} onChange={ev => { const e = members.find(m => m.id === ev.target.value); if (e) startEdit(e) }}>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="From"><input aria-label="From" className="input" type="date" value={form.from} onChange={ev => setForm(f => f && ({ ...f, from: ev.target.value }))} /></Field>
              <Field label="Position (optional)"><input aria-label="Position" className="input" value={form.position} placeholder={emp?.role || 'e.g. Intake Specialist'} onChange={ev => setForm(f => f && ({ ...f, position: ev.target.value }))} /></Field>
              <Field label="Bill $/hr" hint="What the client pays"><input aria-label="Bill $/hr" className="input" inputMode="decimal" value={form.bill} placeholder={project.rate ? String(project.rate) : ''} onChange={ev => setForm(f => f && ({ ...f, bill: ev.target.value }))} /></Field>
              <Field label="Pay $/hr" hint="What the employee earns"><input aria-label="Pay $/hr" className="input" inputMode="decimal" value={form.pay} placeholder={emp?.payRate ? String(emp.payRate) : ''} onChange={ev => setForm(f => f && ({ ...f, pay: ev.target.value }))} /></Field>
              <Field label="Note" full><input aria-label="Note" className="input" value={form.note} placeholder="e.g. raise after 6 months" onChange={ev => setForm(f => f && ({ ...f, note: ev.target.value }))} /></Field>
            </div>
          )
        })()}
      </Modal>
    </section>
  )
}
