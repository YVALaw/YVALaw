import { useState } from 'react'
import { createManualRequest } from '../../services/trackerStorage'
import { WORK_TYPES } from '../../lib/yvaTime'
import { Banner, Field } from '../../components/ui'
import { DICT, type Lang } from './i18n'

export type ManualTarget = { key: string; label: string; projectId: string | null; workType: string | null }
type Project = { id: string; name: string; clientName: string | null }

/** What the employee may add time to: their projects, plus YVA work types for the YVA team */
export function manualTargets(projects: Project[], isYva: boolean): ManualTarget[] {
  return [
    ...projects.map(p => ({ key: `p:${p.id}`, label: p.clientName ? `${p.name} · ${p.clientName}` : p.name, projectId: p.id, workType: null })),
    ...(isYva ? WORK_TYPES.map(w => ({ key: `w:${w}`, label: w, projectId: null, workType: w })) : []),
  ]
}

function todayInput(): string {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** My workspace → My time → Add missing time (only rendered when the employee's Manual Time switch is on).
 *  The requests themselves (status, YVA's note, Cancel) are listed on the Requests page. */
export default function ManualTime({ employeeId, isYva, projects, lang = 'en', onSent, onSeeRequests }: {
  employeeId: string
  isYva: boolean
  projects: Project[]
  lang?: Lang
  onSent?: () => void
  onSeeRequests?: () => void
}) {
  const tr = DICT[lang].manual
  const targets = manualTargets(projects, isYva)
  const [date, setDate]     = useState(todayInput())
  const [from, setFrom]     = useState('09:00')
  const [to,   setTo]       = useState('10:00')
  const [target, setTarget] = useState(targets[0]?.key ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)
  // Validation messages are stored as keys so they follow the language switch
  const [msg,  setMsg]      = useState<{ ok: boolean; key?: keyof typeof tr; text?: string } | null>(null)

  async function submit() {
    const t = targets.find(x => x.key === target)
    const startsAt = new Date(`${date}T${from}:00`), endsAt = new Date(`${date}T${to}:00`)
    if (!t) { setMsg({ ok: false, key: 'pick' }); return }
    if (!(endsAt > startsAt)) { setMsg({ ok: false, key: 'endAfter' }); return }
    if (endsAt.getTime() - startsAt.getTime() > 12 * 3_600_000) { setMsg({ ok: false, key: 'max12' }); return }
    if (endsAt.getTime() > Date.now() + 5 * 60_000) { setMsg({ ok: false, key: 'future' }); return }
    if (startsAt.getTime() < Date.now() - 14 * 86_400_000) { setMsg({ ok: false, key: 'old' }); return }
    if (reason.trim().length < 3) { setMsg({ ok: false, key: 'reason' }); return }
    setBusy(true); setMsg(null)
    try {
      await createManualRequest({ employeeId, projectId: t.projectId, workType: t.workType, startsAt, endsAt, reason: reason.trim() })
      setReason('')
      setMsg({ ok: true, key: 'sent' })
      onSent?.()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally { setBusy(false) }
  }

  if (targets.length === 0) return <p className="mw-muted">{tr.noTarget}</p>
  return (
    <div className="mw-form-wrap">
      {msg && (
        <Banner tone={msg.ok ? 'success' : 'danger'} onClose={() => setMsg(null)}
          action={msg.ok && onSeeRequests ? <button type="button" className="link" onClick={onSeeRequests}>{tr.seeRequests} →</button> : undefined}>
          {msg.key ? String(tr[msg.key]) : msg.text}
        </Banner>
      )}
      <div className="mw-form">
        <Field label={tr.day}><input className="input" type="date" value={date} max={todayInput()} onChange={e => setDate(e.target.value)} /></Field>
        <Field label={tr.from}><input className="input" type="time" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label={tr.to}><input className="input" type="time" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label={tr.workedOn} full>
          <select className="select" value={target} onChange={e => setTarget(e.target.value)}>
            {targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        <Field label={tr.why} full>
          <input className="input" value={reason} maxLength={500} placeholder={tr.whyPh} onChange={e => setReason(e.target.value)} />
        </Field>
      </div>
      <button type="button" className="btn btn--primary mw-submit" disabled={busy} onClick={() => void submit()}>{busy ? tr.sending : tr.send}</button>
    </div>
  )
}
