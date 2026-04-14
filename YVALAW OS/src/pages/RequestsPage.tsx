import { useEffect, useState } from 'react'
import { loadStaffRequests, updateStaffRequestStatus } from '../services/storage'
import type { StaffRequest } from '../data/types'

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
        {(['pending', 'in_review', 'fulfilled', 'declined'] as StaffRequest['status'][]).map(s => (
          <div
            key={s}
            className="kpi-card"
            style={{ borderTop: `3px solid ${STATUS_META[s].color}`, cursor: 'pointer' }}
            onClick={() => setFilter(filter === s ? 'all' : s)}
          >
            <div className="kpi-label">{STATUS_META[s].label}</div>
            <div className="kpi-value" style={{ color: counts[s] > 0 && s === 'pending' ? STATUS_META[s].color : undefined }}>
              {counts[s]}
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['all', 'pending', 'in_review', 'fulfilled', 'declined'] as Filter[]).map(f => {
          const label = f === 'all' ? `All (${counts.all})` : f === 'in_review' ? `In Review (${counts.in_review})` : `${STATUS_META[f as StaffRequest['status']].label} (${counts[f as keyof typeof counts]})`
          const active = filter === f
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                border: '1px solid',
                borderColor: active ? 'var(--gold)' : 'var(--border)',
                background:  active ? 'rgba(245,181,51,.12)' : 'transparent',
                color:       active ? 'var(--gold)' : 'var(--muted)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: '40px 0', textAlign: 'center' }}>
          Loading requests…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '56px 20px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, color: 'var(--muted)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {filter === 'all' ? 'No requests yet' : `No ${STATUS_META[filter as StaffRequest['status']]?.label.toLowerCase()} requests`}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Staff requests submitted from the client portal will appear here.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(req => {
            const meta    = STATUS_META[req.status]
            const nexts   = NEXT_STATUSES[req.status]
            const busy    = updating === req.id
            return (
              <div key={req.id} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '18px 20px',
                borderLeft: `3px solid ${meta.color}`,
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                        {req.clientName ?? 'Unknown client'}
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                        color: meta.color, background: meta.bg,
                      }}>
                        {meta.label}
                      </span>
                    </div>
                    {req.role && (
                      <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
                        {req.role}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0, textAlign: 'right' }}>
                    Submitted {fmtDate(req.createdAt)}
                  </div>
                </div>

                {/* Details row */}
                <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
                  {req.hoursPerWeek && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>Hours/week:</span>{' '}
                      {req.hoursPerWeek}h
                    </div>
                  )}
                  {req.startDate && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>Start:</span>{' '}
                      {fmtDate(req.startDate)}
                    </div>
                  )}
                </div>

                {req.notes && (
                  <div style={{
                    marginTop: 12, padding: '10px 14px',
                    background: 'var(--surf2)', borderRadius: 8,
                    fontSize: 13, color: 'var(--muted)',
                    borderLeft: '2px solid var(--border)',
                  }}>
                    {req.notes}
                  </div>
                )}

                {/* Status actions */}
                {nexts.length > 0 && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>Move to:</span>
                    {nexts.map(s => (
                      <button
                        key={s}
                        disabled={busy}
                        onClick={() => void changeStatus(req, s)}
                        style={{
                          padding: '5px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                          border: `1px solid ${STATUS_META[s].color}`,
                          color: STATUS_META[s].color,
                          background: 'transparent',
                          cursor: busy ? 'not-allowed' : 'pointer',
                          opacity: busy ? 0.5 : 1,
                          transition: 'all 0.15s',
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
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', color: '#fff', padding: '10px 20px',
          borderRadius: 999, fontSize: 13, fontWeight: 600,
          boxShadow: '0 4px 20px rgba(0,0,0,.3)', zIndex: 9999,
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
