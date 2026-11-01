import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OpeningCandidates } from '../components/OpeningCandidates'
import { loadStaffRequests, updateStaffRequestStatus } from '../services/storage'
import type { StaffRequest } from '../data/types'
import { Banner, PageHeader, Pill, Skel, Tabs, type Tone } from '../components/ui'
import { dateMed, dateShort } from '../utils/format'

type Filter = 'all' | StaffRequest['status']
/** Portal redesign columns (migrate-redesign-portal.sql) — null/missing on older rows or before the migration */
type Req = StaffRequest & { headcount?: number | null; projectId?: string | null; projectName?: string | null }

const STATUS_META: Record<StaffRequest['status'], { label: string; tone: Tone }> = {
  pending:   { label: 'Pending',   tone: 'warning' },
  in_review: { label: 'In review', tone: 'info' },
  fulfilled: { label: 'Fulfilled', tone: 'success' },
  declined:  { label: 'Declined',  tone: 'neutral' },
}
const NEXT_STATUSES: Record<StaffRequest['status'], StaffRequest['status'][]> = {
  pending:   ['in_review', 'fulfilled', 'declined'],
  in_review: ['fulfilled', 'declined'],
  fulfilled: [],
  declined:  [],
}
const ACTION_LABEL: Record<StaffRequest['status'], string> = { pending: 'Reopen', in_review: 'Start review', fulfilled: 'Mark fulfilled', declined: 'Decline' }
const when = (ts?: number | string) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toDateString() === new Date().toDateString() ? `today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}` : dateMed(d)
}

/** CRM → Staff requests: sent by clients from their portal; status workflow + linked candidates (redesign 2026-11) */
export default function RequestsPage() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<Req[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [updating, setUpdating] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void load() }, [])
  async function load() { setLoading(true); setRequests(await loadStaffRequests()); setLoading(false) }

  async function changeStatus(req: Req, status: StaffRequest['status']) {
    setUpdating(req.id); setError(null)
    try {
      await updateStaffRequestStatus(req.id, status)
      setRequests(prev => prev.map(r => (r.id === req.id ? { ...r, status } : r)))
      setNotice(`${req.clientName ?? 'Request'}: marked as ${STATUS_META[status].label.toLowerCase()}.`)
    } catch (e) { setError(`Could not update the request: ${(e as Error).message}`) }
    finally { setUpdating(null) }
  }

  const count = (s: StaffRequest['status']) => requests.filter(r => r.status === s).length
  const pending = count('pending')
  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)

  return (
    <div className="page crm-page">
      <PageHeader title="Staff requests" sub={<>Sent by clients from their portal · {pending > 0 ? <span className="crm-pending-badge">{pending} pending</span> : '0 pending'}</>} />
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}
      <Tabs label="Request status" value={filter} onChange={setFilter} tabs={[
        { value: 'all', label: 'All', count: requests.length },
        { value: 'pending', label: 'Pending', count: pending },
        { value: 'in_review', label: 'In review', count: count('in_review') },
        { value: 'fulfilled', label: 'Fulfilled', count: count('fulfilled') },
        { value: 'declined', label: 'Declined', count: count('declined') },
      ]} />

      {loading ? (
        <div className="crm-req-grid">{[0, 1].map(i => <div key={i} className="card card--pad stack"><Skel h={18} w="50%" /><Skel h={56} r={10} /><Skel h={14} /></div>)}</div>
      ) : filtered.length === 0 ? (
        <div className="card card-empty">No requests here. Requests from the client portal appear automatically.</div>
      ) : (
        <div className="crm-req-grid">
          {filtered.map(req => {
            const meta = STATUS_META[req.status]
            const nexts = NEXT_STATUSES[req.status]
            const busy = updating === req.id
            return (
              <article key={req.id} className="card crm-req">
                <div className="crm-req__top">
                  <div className="crm-req__who">
                    <span className="crm-req__client">{req.clientName ?? 'Unknown client'}</span>
                    <span className="crm-req__sub">{req.type === 'replacement' ? `Replacement${req.employeeName ? ` for ${req.employeeName}` : ''}` : 'Additional staff'} · submitted {when(req.createdAt)}</span>
                  </div>
                  <Pill tone={meta.tone}>{meta.label}</Pill>
                </div>
                <div className="crm-req__facts">
                  <div className="info"><span className="info__label">Role</span><span className="info__value crm-td-strong">{req.role || '—'}</span></div>
                  <div className="info"><span className="info__label">People · hours</span><span className="info__value crm-td-strong">{req.headcount ?? '—'} · {req.hoursPerWeek ? `${req.hoursPerWeek} h/wk` : '— h/wk'}</span></div>
                  <div className="info"><span className="info__label">Start</span><span className="info__value crm-td-strong">{req.startDate ? dateShort(req.startDate) : '—'}</span></div>
                  {req.projectName && <div className="info"><span className="info__label">Project</span><span className="info__value crm-td-strong">{req.projectId ? <button type="button" className="link" onClick={() => navigate(`/projects/${req.projectId}`)}>{req.projectName}</button> : req.projectName}</span></div>}
                </div>
                {req.notes && <p className="crm-req__notes">{req.notes}</p>}
                <div className="crm-req-cands"><OpeningCandidates requestId={req.id} /></div>
                <div className="crm-req__actions">
                  {nexts.map((s, i) => (
                    <button key={s} type="button" disabled={busy} className={`btn${i === 0 ? ' btn--primary' : ''}`} onClick={() => void changeStatus(req, s)}>{ACTION_LABEL[s]}</button>
                  ))}
                  <button type="button" className="link crm-req__link" onClick={() => navigate('/candidates')}>Link candidates →</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
