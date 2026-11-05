import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Employee, Project } from '../data/types'
import { loadEmployees, loadProjects } from '../services/storage'
import { usePermission, useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { decideTimeOff, loadTimeOff, type TimeOffRequest } from '../services/workspace'
import { decideRequest, loadManualRequests, type ManualRequest } from '../services/trackerStorage'
import { Banner, EmptyState, Field, Menu, Modal, PageHeader, Pill, Skel, Tabs } from '../components/ui'
import { P } from '../components/Icon'
import { PersonAvatar } from '../components/people/common'
import { ago } from '../utils/format'
import { useToast } from '../context/ToastContext'

const KIND: Record<TimeOffRequest['kind'], string> = { vacation: 'Vacation', sick: 'Sick', personal: 'Personal', other: 'Other' }
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const when = (ms: number) => new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const mins = (s: number) => { const m = Math.round(s / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m` }
const days = (r: TimeOffRequest) => { const n = Math.round((Date.parse(`${r.end_date}T12:00:00`) - Date.parse(`${r.start_date}T12:00:00`)) / 86400000) + 1; return r.half_day ? 'half day' : `${n} day${n === 1 ? '' : 's'}` }

type Decide = { kind: 'off'; r: TimeOffRequest; approve: boolean } | { kind: 'manual'; r: ManualRequest; approve: boolean }

/** People → Approvals: time off and missing-time requests from My workspace (Step 7) */
export default function ApprovalsPage() {
  const allowed = usePermission()
  const { role } = useRole()
  const canTimeOff = allowed('timeoff.approve'), canManual = can.approveTime(role)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffRequest[] | null>(null)
  const [recent, setRecent] = useState<TimeOffRequest[]>([])
  const [manual, setManual] = useState<ManualRequest[]>([])
  const [manualDone, setManualDone] = useState<ManualRequest[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)   // could not load: stays as a banner
  const toast = useToast()
  const [tab, setTab] = useState<'off' | 'missing'>('off')
  const [decide, setDecide] = useState<Decide | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const [p, r] = await Promise.all([loadTimeOff({ status: 'pending' }), loadTimeOff()])
    setTimeOff(p.rows.sort((a, b) => a.start_date.localeCompare(b.start_date))); setLoadError(p.error)
    setRecent(r.rows.filter(x => x.status !== 'pending').slice(0, 15))
    if (canManual) {
      const all = await loadManualRequests()
      setManual(all.filter(x => x.status === 'pending').sort((a, b) => a.startsAt - b.startsAt))
      setManualDone(all.filter(x => x.status === 'approved' || x.status === 'rejected').slice(0, 15))
    }
  }
  useEffect(() => { void loadEmployees().then(setEmployees); void loadProjects().then(setProjects).catch(() => {}) }, [])
  useEffect(() => { void load() }, [canManual])   // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => employees.find(e => e.id === id)?.name ?? '—'
  const team = (id: string) => { const e = employees.find(x => x.id === id); return e ? (e.worksFor === 'yva' ? 'YVA team' : 'Client team') : '' }

  async function run(d: Decide, withNote: string) {
    setBusy(d.r.id)
    try {
      if (d.kind === 'off') await decideTimeOff(d.r.id, d.approve, withNote)
      else await decideRequest(d.r.id, d.approve, withNote || undefined)
      toast.success(`${d.approve ? 'Approved' : 'Rejected'} — ${name(d.kind === 'off' ? d.r.employee_id : d.r.employeeId)} is notified.`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(null) }
  }
  function openDecide(d: Decide) { setNote(''); setDecide(d) }

  const offItems = [...(timeOff ?? []), ...recent]
  const manualItems = [...manual, ...manualDone]

  // ?open=<request id> (the time-off notification): switch to its tab, scroll to it and mark it — also when this
  // page is already open. A request that's gone (cancelled and cleared, or older than the recent list) says so.
  const [params, setParams] = useSearchParams()
  const [focusId, setFocusId] = useState<string | null>(null)
  useEffect(() => {
    const id = params.get('open')
    if (!id || timeOff === null) return
    const inOff = offItems.some(r => r.id === id), inManual = manualItems.some(r => r.id === id)
    if (inOff || inManual) {
      setTab(inOff ? 'off' : 'missing'); setFocusId(id)
      window.setTimeout(() => document.getElementById(`req-${id}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 50)
    } else toast.warning("That request isn't here any more — it may have been cancelled, or it was decided a while ago.")
    setParams({}, { replace: true })
  }, [params, timeOff])   // eslint-disable-line react-hooks/exhaustive-deps
  const reqClass = (id: string) => `card ppl-req${focusId === id ? ' ppl-req--focus' : ''}`
  const actions = (d: Decide, can: boolean) => can ? (
    <div className="ppl-req__actions">
      <Menu label="More approval options" buttonClass="btn btn--icon btn--ghost" items={[{ label: 'Approve with a note…', icon: P.message, onClick: () => openDecide({ ...d, approve: true }) }]} />
      <button type="button" className="btn" disabled={busy === d.r.id} onClick={() => openDecide({ ...d, approve: false })}>Reject…</button>
      <button type="button" className="btn btn--primary" disabled={busy === d.r.id} onClick={() => void run({ ...d, approve: true }, '')}>{busy === d.r.id ? 'Saving…' : 'Approve'}</button>
    </div>
  ) : <span className="ppl-fine">Needs the "Approve time off" permission</span>

  return (
    <div className="page">
      <PageHeader title="Approvals" sub="Requests from My workspace. People see your decision and note right away." />
      {loadError && <Banner tone="danger" onClose={() => setLoadError(null)}>{loadError}</Banner>}
      <Tabs label="Request type" value={tab} onChange={setTab} tabs={[
        { value: 'off', label: 'Time off', count: timeOff?.length ?? null },
        { value: 'missing', label: 'Missing time', count: manual.length, hidden: !canManual },
      ]} />

      <div className="ppl-reqs">
        {timeOff === null ? [0, 1, 2].map(i => <div key={i} className="card ppl-req"><Skel w={40} h={40} r={20} /><div className="stack ppl-grow"><Skel w={220} h={14} /><Skel w={300} h={12} /></div></div>)
          : tab === 'off' ? (
            offItems.length === 0 ? <EmptyState>No time-off requests waiting.</EmptyState> : offItems.map(r => (
              <div key={r.id} id={`req-${r.id}`} className={reqClass(r.id)}>
                <PersonAvatar name={name(r.employee_id)} size="md" />
                <div className="ppl-req__main">
                  <span className="ppl-req__who">{name(r.employee_id)} <span className="ppl-req__what">· Time off · {KIND[r.kind]}</span></span>
                  <span className="ppl-req__detail">{day(r.start_date)}{r.end_date !== r.start_date ? ` – ${day(r.end_date)}` : ''} · {days(r)}{r.note ? ` · “${r.note}”` : ''}{team(r.employee_id) ? ` · ${team(r.employee_id)}` : ''}</span>
                  <span className="ppl-req__meta">{r.status === 'pending' ? `Asked ${ago(Date.parse(r.created_at))}` : `${r.status === 'approved' ? 'Approved' : r.status === 'declined' ? 'Declined' : 'Cancelled'}${r.decided_at ? ` · ${new Date(r.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}${r.decision_note ? ` · “${r.decision_note}”` : ''}`}</span>
                </div>
                {r.status === 'pending' ? actions({ kind: 'off', r, approve: true }, canTimeOff)
                  : <Pill tone={r.status === 'approved' ? 'success' : r.status === 'declined' ? 'danger' : 'neutral'} className="ppl-decided">{r.status === 'approved' ? 'Approved' : r.status === 'declined' ? 'Declined' : 'Cancelled'}</Pill>}
              </div>
            ))
          ) : (
            manualItems.length === 0 ? <EmptyState>No missing-time requests waiting.</EmptyState> : manualItems.map(r => (
              <div key={r.id} id={`req-${r.id}`} className={reqClass(r.id)}>
                <PersonAvatar name={name(r.employeeId)} size="md" />
                <div className="ppl-req__main">
                  <span className="ppl-req__who">{name(r.employeeId)} <span className="ppl-req__what">· Missing time</span></span>
                  <span className="ppl-req__detail">{mins(r.endsAt - r.startsAt)} on {when(r.startsAt)} – {new Date(r.endsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {r.projectId ? (projects.find(p => p.id === r.projectId)?.name ?? 'Project') : (r.workType ?? 'YVA work')} · “{r.reason}”</span>
                  <span className="ppl-req__meta">{r.status === 'pending' ? `Asked ${ago(r.createdAt)}` : `${r.status === 'approved' ? `Approved${r.approvedSeconds != null ? ` · ${mins(r.approvedSeconds * 1000)} added` : ''}` : 'Rejected'}${r.decisionNote ? ` · “${r.decisionNote}”` : ''}`}</span>
                </div>
                {r.status === 'pending' ? actions({ kind: 'manual', r, approve: true }, true)
                  : <Pill tone={r.status === 'approved' ? 'success' : 'danger'} className="ppl-decided">{r.status === 'approved' ? 'Approved' : 'Rejected'}</Pill>}
              </div>
            ))
          )}
      </div>

      <Modal open={!!decide} onClose={() => setDecide(null)}
        title={decide?.approve ? 'Approve with a note' : decide?.kind === 'manual' ? 'Reject missing time' : 'Decline time off'}
        sub={decide ? `${name(decide.kind === 'off' ? decide.r.employee_id : decide.r.employeeId)} sees this note in My workspace.` : undefined}
        footer={<>
          <button type="button" className="btn" onClick={() => setDecide(null)}>Cancel</button>
          <button type="button" className={`btn ${decide?.approve ? 'btn--primary' : 'btn--danger'}`} onClick={() => { const d = decide!; setDecide(null); void run(d, note.trim()) }}>{decide?.approve ? 'Approve' : 'Reject'}</button>
        </>}>
        <Field label={decide?.approve ? 'Note for the employee (optional)' : 'Reason (the person sees this)'}>
          <textarea aria-label="Note for the employee" className="textarea" rows={3} value={note} onChange={e => setNote(e.target.value)} autoFocus placeholder={decide?.approve ? 'e.g. Enjoy your trip!' : 'e.g. We need you that week — can you pick other days?'} />
        </Field>
      </Modal>
    </div>
  )
}
