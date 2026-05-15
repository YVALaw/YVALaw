import { useEffect, useState } from 'react'
import { loadStaffRequests, updateStaffRequestStatus } from '../services/storage'
import type { StaffRequest } from '../data/types'
import { IconClipboard, IconAlert, IconSearch, IconCheck, IconX } from '../components/Icon'

type Filter = 'all' | StaffRequest['status']

const STATUS_META: Record<StaffRequest['status'], { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: '#f97316', bg: 'rgba(249,115,22,.1)' },
  in_review: { label: 'In Review', color: '#3b82f6', bg: 'rgba(59,130,246,.1)' },
  fulfilled: { label: 'Fulfilled', color: '#22c55e', bg: 'rgba(34,197,94,.1)'  },
  declined:  { label: 'Declined',  color: '#ef4444', bg: 'rgba(239,68,68,.1)'  },
}

const NEXT_STATUSES: Record<StaffRequest['status'], StaffRequest['status'][]> = {
  pending:   ['in_review', 'fulfilled', 'declined'],
  in_review: ['fulfilled', 'declined'],
  fulfilled: [],
  declined:  [],
}

function fmtDate(ts?: number | string) {
  if (!ts) return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RequestsPage() {
  const [requests,  setRequests]  = useState<StaffRequest[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState<Filter>('all')
  const [updating,  setUpdating]  = useState<string | null>(null)
  const [toast,     setToast]     = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    setRequests(await loadStaffRequests())
    setLoading(false)
  }

  async function changeStatus(req: StaffRequest, status: StaffRequest['status']) {
    setUpdating(req.id)
    try {
      await updateStaffRequestStatus(req.id, status)
      setRequests(prev => prev.map(r => r.id === req.id ? { ...r, status } : r))
      setToast(`Marked as ${STATUS_META[status].label}`)
      setTimeout(() => setToast(null), 2500)
    } finally {
      setUpdating(null)
    }
  }

  const counts = {
    all:       requests.length,
    pending:   requests.filter(r => r.status === 'pending').length,
    in_review: requests.filter(r => r.status === 'in_review').length,
    fulfilled: requests.filter(r => r.status === 'fulfilled').length,
    declined:  requests.filter(r => r.status === 'declined').length,
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title">Staff Requests</div>
          <div className="page-sub">
            {counts.pending > 0
              ? `${counts.pending} pending · ${requests.length} total`
              : `${requests.length} total request${requests.length !== 1 ? 's' : ''}`}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="kpi-grid">
        {([
          { s: 'pending' as const, icon: <IconAlert size={20} /> },
          { s: 'in_review' as const, icon: <IconSearch size={20} /> },
          { s: 'fulfilled' as const, icon: <IconCheck size={20} /> },
          { s: 'declined' as const, icon: <IconX size={20} /> },
        ]).map(({ s, icon }) => (
          <div
            key={s}
            className="kpi-card"
            style={{ cursor: 'pointer' }}
            onClick={() => setFilter(filter === s ? 'all' : s)}
          >
            <div className="kpi-icon-wrap" style={{ color: STATUS_META[s].color, borderColor: STATUS_META[s].color + '25' }}>
              {icon}
            </div>
            <div className="kpi-body">
              <div className="kpi-label">{STATUS_META[s].label}</div>
              <div className="kpi-value" style={{ color: counts[s] > 0 && s === 'pending' ? STATUS_META[s].color : undefined }}>
                {counts[s]}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="filter-tabs">
        {(['all', 'pending', 'in_review', 'fulfilled', 'declined'] as Filter[]).map(f => {
          const label = f === 'all' ? `All (${counts.all})` : f === 'in_review' ? `In Review (${counts.in_review})` : `${STATUS_META[f as StaffRequest['status']].label} (${counts[f as keyof typeof counts]})`
          const active = filter === f
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`filter-tab${active ? ' active' : ''}`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <div className="loading-text">Loading requests…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconClipboard size={28} /></div>
          <div className="empty-state-title">
            {filter === 'all' ? 'No requests yet' : `No ${STATUS_META[filter as StaffRequest['status']]?.label.toLowerCase()} requests`}
          </div>
          <div className="empty-state-message">
            Staff requests submitted from the client portal will appear here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(req => {
            const meta    = STATUS_META[req.status]
            const nexts   = NEXT_STATUSES[req.status]
            const busy    = updating === req.id
            return (
              <div key={req.id} className="request-card">
                {/* Top row */}
                <div className="request-card-top">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className="request-card-name">
                        {req.clientName ?? 'Unknown client'}
                      </span>
                      <span className="badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.color + '20' }}>
                        {meta.label}
                      </span>
                    </div>
                    {req.role && (
                      <div className="request-card-role">
                        {req.role}
                      </div>
                    )}
                  </div>
                  <div className="request-card-date">
                    Submitted {fmtDate(req.createdAt)}
                  </div>
                </div>

                {/* Details row */}
                <div className="request-card-details">
                  {req.hoursPerWeek && (
                    <div className="request-card-detail">
                      <strong>Hours/week:</strong> {req.hoursPerWeek}h
                    </div>
                  )}
                  {req.startDate && (
                    <div className="request-card-detail">
                      <strong>Start:</strong> {fmtDate(req.startDate)}
                    </div>
                  )}
                </div>

                {req.notes && (
                  <div className="request-card-note">
                    {req.notes}
                  </div>
                )}

                {/* Status actions */}
                {nexts.length > 0 && (
                  <div className="request-card-actions">
                    <span className="request-card-actions-label">Move to:</span>
                    {nexts.map(s => (
                      <button
                        key={s}
                        disabled={busy}
                        onClick={() => void changeStatus(req, s)}
                        className="status-chip-btn"
                        style={{
                          borderColor: STATUS_META[s].color,
                          color: STATUS_META[s].color,
                        }}
                        onMouseEnter={e => { if (!busy) e.currentTarget.style.background = STATUS_META[s].bg }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                      >
                        {STATUS_META[s].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-fixed">
          {toast}
        </div>
      )}
    </div>
  )
}
