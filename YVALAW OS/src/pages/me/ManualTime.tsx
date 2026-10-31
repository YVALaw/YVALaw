import { useEffect, useState } from 'react'
import { cancelManualRequest, createManualRequest, loadManualRequests, type ManualRequest } from '../../services/trackerStorage'
import { WORK_TYPES } from '../../lib/yvaTime'
import { DICT, locale, type Lang } from './i18n'

type Target = { key: string; label: string; projectId: string | null; workType: string | null }

function todayInput(): string {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function when(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleString(locale(lang), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const STATUS_BADGE: Record<ManualRequest['status'], string> = {
  pending: 'badge-yellow', approved: 'badge-green', rejected: 'badge-red', cancelled: 'badge-gray',
}

/** My workspace → Add missing time (only when the employee's Manual Time switch is on) */
export default function ManualTime({ employeeId, isYva, projects, lang = 'en' }: {
  employeeId: string
  isYva: boolean
  projects: { id: string; name: string; clientName: string | null }[]
  lang?: Lang
}) {
  const tr = DICT[lang].manual
  const targets: Target[] = [
    ...projects.map(p => ({ key: `p:${p.id}`, label: p.clientName ? `${p.name} · ${p.clientName}` : p.name, projectId: p.id, workType: null })),
    ...(isYva ? WORK_TYPES.map(w => ({ key: `w:${w}`, label: w, projectId: null, workType: w })) : []),
  ]
  const [requests, setRequests] = useState<ManualRequest[]>([])
  const [date, setDate]     = useState(todayInput())
  const [from, setFrom]     = useState('09:00')
  const [to,   setTo]       = useState('10:00')
  const [target, setTarget] = useState(targets[0]?.key ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy]     = useState(false)
  const [msg,  setMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  const reload = () => void loadManualRequests().then(setRequests)
  useEffect(reload, [])
  useEffect(() => {
    if (window.location.hash === '#manual') document.getElementById('manual')?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  async function submit() {
    const t = targets.find(x => x.key === target)
    const startsAt = new Date(`${date}T${from}:00`), endsAt = new Date(`${date}T${to}:00`)
    if (!t) { setMsg({ ok: false, text: tr.pick }); return }
    if (!(endsAt > startsAt)) { setMsg({ ok: false, text: tr.endAfter }); return }
    if (endsAt.getTime() - startsAt.getTime() > 12 * 3_600_000) { setMsg({ ok: false, text: tr.max12 }); return }
    if (endsAt.getTime() > Date.now() + 5 * 60_000) { setMsg({ ok: false, text: tr.future }); return }
    if (startsAt.getTime() < Date.now() - 14 * 86_400_000) { setMsg({ ok: false, text: tr.old }); return }
    if (reason.trim().length < 3) { setMsg({ ok: false, text: tr.reason }); return }
    setBusy(true); setMsg(null)
    try {
      await createManualRequest({ employeeId, projectId: t.projectId, workType: t.workType, startsAt, endsAt, reason: reason.trim() })
      setReason('')
      setMsg({ ok: true, text: tr.sent })
      reload()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally { setBusy(false) }
  }

  async function cancel(id: string) {
    try { await cancelManualRequest(id); reload() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }

  const targetLabel = (r: ManualRequest) => r.projectId ? targets.find(t => t.projectId === r.projectId)?.label ?? 'Project' : r.workType

  return (
    <div id="manual" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {targets.length === 0 ? (
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>{tr.noTarget}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">{tr.day}</label>
            <input className="form-input" type="date" value={date} max={todayInput()} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">{tr.from}</label>
            <input className="form-input" type="time" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">{tr.to}</label>
            <input className="form-input" type="time" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
            <label className="form-label">{tr.workedOn}</label>
            <select className="form-select" value={target} onChange={e => setTarget(e.target.value)}>
              {targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
            <label className="form-label">{tr.why}</label>
            <input className="form-input" value={reason} maxLength={500} placeholder={tr.whyPh}
              onChange={e => setReason(e.target.value)} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? tr.sending : tr.send}</button>
          </div>
        </div>
      )}
      {msg && <div className={`portal-message ${msg.ok ? 'portal-message-success' : 'portal-message-error'}`}>{msg.text}</div>}

      {requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{tr.mine}</div>
          {requests.slice(0, 20).map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{when(r.startsAt, lang)} – {new Date(r.endsAt).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' })} · {targetLabel(r)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                  {r.reason}
                  {r.status === 'approved' && r.approvedSeconds !== null && ` · ${Math.round(r.approvedSeconds / 60)} ${tr.added}`}
                  {r.decisionNote && ` · ${tr.yva}: ${r.decisionNote}`}
                </div>
              </div>
              <span className={`badge ${STATUS_BADGE[r.status]}`}>{tr.status[r.status]}</span>
              {r.status === 'pending' && <button className="btn-ghost btn-sm" onClick={() => void cancel(r.id)}>{tr.cancel}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
