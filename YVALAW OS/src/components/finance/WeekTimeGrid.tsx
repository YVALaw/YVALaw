// Weekly close → "Time by person": the week's tracked time + adjustments per person / target / day.
// Tap a day to add or remove minutes, or move time to next week; every change carries a note the employee sees.
import { useState } from 'react'
import type { Adjustment } from '../../services/weeklyClose'
import { Banner, Field } from '../ui'
import { hmText } from '../../utils/format'

export type GridTarget = { projectId: string | null; workType: string | null; tracked: Record<string, number>; adj: Record<string, number> }
export type Editing = { employeeId: string; target: string; day: string; mode: 'edit' | 'move' }
const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })

export default function WeekTimeGrid({ grid, days, empName, projName, adjustments, onSave, onUndo, readOnly }: {
  grid: Map<string, Map<string, GridTarget>>; days: string[]
  empName: (id: string) => string; projName: (id: string | null) => string
  adjustments: Adjustment[]
  onSave: (e: Editing, minutes: string, note: string, target: GridTarget | undefined) => Promise<boolean>
  onUndo: (a: Adjustment) => void
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [form, setForm] = useState({ minutes: '', note: '' })
  const [saving, setSaving] = useState(false)
  const people = [...grid.entries()].sort((a, b) => empName(a[0]).localeCompare(empName(b[0])))
  if (people.length === 0) return <div className="card-empty">No tracked time this week.</div>

  async function save() {
    if (!editing) return
    setSaving(true)
    const done = await onSave(editing, form.minutes, form.note, grid.get(editing.employeeId)?.get(editing.target))
    setSaving(false)
    if (done) { setEditing(null); setForm({ minutes: '', note: '' }) }
  }

  return (
    <div className="fin-tg">
      {people.map(([emp, targets]) => {
        const changes = adjustments.filter(a => a.employee_id === emp && a.status === 'applied' && a.kind !== 'defer_in')
        return (
          <div key={emp} className="fin-tg__person" data-person={empName(emp)}>
            <div className="fin-tg__name">{empName(emp)}</div>
            <div className="fin-tg__scroll">
              <table className="table table--compact fin-tg__table">
                <thead><tr><th>Working on</th>{days.map(d => <th key={d} className="t-right">{dayLabel(d)}</th>)}<th className="t-right">Week</th></tr></thead>
                <tbody>
                  {[...targets.entries()].map(([key, t]) => {
                    const total = days.reduce((x, d) => x + (t.tracked[d] || 0) + (t.adj[d] || 0), 0)
                    return (
                      <tr key={key}>
                        <td className="t-strong">{t.projectId ? projName(t.projectId) : t.workType}</td>
                        {days.map(d => {
                          const sec = (t.tracked[d] || 0) + (t.adj[d] || 0)
                          const on = editing?.employeeId === emp && editing.target === key && editing.day === d
                          return (
                            <td key={d} className="t-right">
                              <button type="button" className={`fin-tg__cell mono${on ? ' fin-tg__cell--on' : ''}`} disabled={readOnly} title="Adjust this day"
                                onClick={() => { setEditing({ employeeId: emp, target: key, day: d, mode: 'edit' }); setForm({ minutes: '', note: '' }) }}>
                                {sec ? hmText(sec) : '—'}
                                {t.adj[d] ? <span className="fin-tg__adj">{t.adj[d] > 0 ? '+' : ''}{hmText(t.adj[d])}</span> : null}
                              </button>
                            </td>
                          )
                        })}
                        <td className="t-num t-strong">{hmText(total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {editing?.employeeId === emp && (
              <div className="fin-tg__edit">
                <strong className="fin-tg__edit-title">{dayLabel(editing.day)} · {(() => { const t = targets.get(editing.target); return t?.projectId ? projName(t.projectId) : t?.workType })()}</strong>
                <Field label="Change">
                  <select aria-label="Change" className="select select--sm" value={editing.mode} onChange={e => setEditing({ ...editing, mode: e.target.value as 'edit' | 'move' })}>
                    <option value="edit">Add / remove minutes</option>
                    <option value="move">Move to next week</option>
                  </select>
                </Field>
                <Field label="Minutes"><input aria-label="Minutes" className="input input--sm fin-tg__mins" inputMode="text" placeholder={editing.mode === 'move' ? 'minutes' : '+30 or −15'} value={form.minutes} onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))} /></Field>
                <Field label="Note for the employee"><input aria-label="Note for the employee" className="input input--sm" placeholder="Note the employee will see" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
                <div className="fin-tg__edit-actions">
                  <button type="button" className="btn btn--sm btn--primary" disabled={saving} onClick={() => void save()}>Save</button>
                  <button type="button" className="btn btn--sm" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            )}
            {changes.map(a => (
              <div key={a.id} className="fin-tg__change">
                <span>{dayLabel(a.day)}: {a.kind === 'defer_out' ? `moved ${hmText(-a.seconds_delta)} to next week` : `${a.seconds_delta > 0 ? '+' : ''}${hmText(a.seconds_delta)}`} — {a.note}</span>
                <button type="button" className="link" onClick={() => onUndo(a)}>Undo</button>
              </div>
            ))}
          </div>
        )
      })}
      {readOnly && <Banner tone="info">The week in progress is a preview — time can be adjusted once it has been prepared.</Banner>}
    </div>
  )
}
