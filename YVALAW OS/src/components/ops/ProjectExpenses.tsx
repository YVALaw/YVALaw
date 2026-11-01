import { useState } from 'react'
import type { Expense } from '../../data/types'
import { usd, dateMed } from '../../utils/format'
import { Checkbox, Field, Menu, useIsMobile } from '../ui'
import { EXPENSE_CATS, todayIso } from './opsUtils'

export type ExpenseDraft = { description: string; amount: string; date: string; category: string; recurring: boolean }
const blank = (): ExpenseDraft => ({ description: '', amount: '', date: todayIso(), category: '', recurring: false })

/** Project expenses: budget vs actual, add form, list (project page tab and the Projects page modal) */
export default function ProjectExpenses({ expenses, budget, billed, onAdd, onDelete }: {
  expenses: Expense[]; budget?: number; billed: number
  onAdd: (d: ExpenseDraft) => Promise<boolean> | boolean
  onDelete: (id: string) => void
}) {
  const mobile = useIsMobile()
  const [form, setForm] = useState<ExpenseDraft>(blank)
  const total = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  // Same rule as the old project card: billed so far against the budget, red from 90%
  const pct = budget && budget > 0 ? Math.min(100, Math.round((billed / budget) * 100)) : null
  const sorted = [...expenses].sort((a, b) => String(b.date).localeCompare(String(a.date)))

  async function add() {
    if (!form.description.trim() || !form.amount) return
    if (await onAdd(form)) setForm(blank())
  }

  return (
    <div className="stack stack--lg">
      <div className="ops-budget card card--pad">
        <div className="ops-budget__nums">
          <div className="info"><span className="info__label">Budget</span><span className="info__value num">{budget ? usd(budget) : '—'}</span></div>
          <div className="info"><span className="info__label">Billed</span><span className="info__value num">{usd(billed)}</span></div>
          <div className="info"><span className="info__label">Expenses</span><span className="info__value num t-danger">{usd(total)}</span></div>
          {pct !== null && <div className="info"><span className="info__label">Budget used</span><span className={`info__value num${pct >= 90 ? ' t-danger' : ''}`}>{pct}%</span></div>}
        </div>
        {pct !== null && <div className="progress" aria-label="Budget used"><div className={`progress__fill${pct >= 90 ? ' ops-fill-danger' : ''}`} style={{ width: `${pct}%` }} /></div>}
      </div>

      <div className="card card--pad stack">
        <h2 className="card__title">Add expense</h2>
        <div className="ops-exp-form">
          <Field label="Description *"><input className="input" aria-label="Expense description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Zoom subscription" /></Field>
          <Field label="Amount ($)"><input className="input" aria-label="Expense amount" type="number" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></Field>
          <Field label="Date"><input className="input" aria-label="Expense date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Category">
            <select className="select" aria-label="Expense category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {EXPENSE_CATS.map(c => <option key={c} value={c}>{c || '— None —'}</option>)}
            </select>
          </Field>
          <div className="ops-exp-form__end">
            <Checkbox checked={form.recurring} onChange={v => setForm(f => ({ ...f, recurring: v }))} label="Recurring" />
            <button type="button" className="btn btn--primary" onClick={() => void add()} disabled={!form.description.trim() || !form.amount}>Add</button>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? <div className="card card-empty">No expenses logged yet.</div> : mobile ? (
        <div className="mcards">
          {sorted.map(ex => (
            <div key={ex.id} className="mcard">
              <div className="mcard__top"><span className="mcard__title">{ex.description}</span><span className="num t-danger">{usd(ex.amount)}</span></div>
              <div className="mcard__meta">{[ex.category, dateMed(ex.date), ex.recurring ? 'Recurring' : ''].filter(Boolean).join(' · ')}</div>
              <div className="mcard__actions"><button type="button" className="btn btn--danger" onClick={() => onDelete(ex.id)}>Delete</button></div>
            </div>
          ))}
          <div className="ops-total-line">Total <b className="num">{usd(total)}</b></div>
        </div>
      ) : (
        <div className="table-card">
          <table className="table ops-min-640">
            <thead><tr><th>Description</th><th>Category</th><th>Date</th><th>Recurring</th><th className="t-right">Amount</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {sorted.map(ex => (
                <tr key={ex.id}>
                  <td className="t-strong">{ex.description}</td>
                  <td className="muted">{ex.category || '—'}</td>
                  <td className="muted">{dateMed(ex.date)}</td>
                  <td className="muted">{ex.recurring ? 'Yes' : '—'}</td>
                  <td className="t-num">{usd(ex.amount)}</td>
                  <td className="t-actions"><Menu label={`Actions for ${ex.description}`} buttonClass="btn btn--xs btn--icon ops-xs-icon" items={[{ label: 'Delete expense', danger: true, onClick: () => onDelete(ex.id) }]} /></td>
                </tr>
              ))}
              <tr className="ops-total-row"><td colSpan={4} className="t-right">Total</td><td className="t-num">{usd(total)}</td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
