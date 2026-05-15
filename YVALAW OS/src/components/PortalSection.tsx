import type { ReactNode, CSSProperties } from 'react'

interface PortalSectionProps {
  title: string
  sub?: string
  children: ReactNode
  action?: ReactNode
  style?: CSSProperties
  className?: string
}

export default function PortalSection({ title, sub, children, action, style, className = '' }: PortalSectionProps) {
  return (
    <div className={`portal-section-card ${className}`} style={style}>
      <div className="portal-section-header">
        <div>
          <div className="portal-section-title">{title}</div>
          {sub && <div className="portal-section-sub">{sub}</div>}
        </div>
        {action && <div className="portal-section-action">{action}</div>}
      </div>
      <div className="portal-section-body">
        {children}
      </div>
    </div>
  )
}

// ── Portal KPI ────────────────────────────────────────────────────────────────

interface PortalKpiProps {
  label: string
  value: string | number
  sub?: string
  color?: string
  onClick?: () => void
}

export function PortalKpi({ label, value, sub, color, onClick }: PortalKpiProps) {
  return (
    <div
      className={`kpi-card${onClick ? ' clickable-card' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  message?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {message && <div className="empty-state-message">{message}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}

// ── Invoice status badge (portal) ─────────────────────────────────────────────

interface StatusBadgeProps {
  status?: string
}

export function PortalStatusBadge({ status }: StatusBadgeProps) {
  const s = (status ?? '').toLowerCase()
  const config: Record<string, { color: string; bg: string; label: string }> = {
    paid:     { color: '#15803d', bg: 'rgba(34,197,94,.1)', label: 'Paid' },
    overdue:  { color: '#b91c1c', bg: 'rgba(239,68,68,.1)', label: 'Overdue' },
    partial:  { color: '#c2410c', bg: 'rgba(249,115,22,.1)', label: 'Partial' },
    sent:     { color: '#1d4ed8', bg: 'rgba(59,130,246,.1)', label: 'Sent' },
    viewed:   { color: '#7e22ce', bg: 'rgba(168,85,247,.1)', label: 'Viewed' },
    draft:    { color: '#4b5563', bg: 'rgba(107,114,128,.1)', label: 'Draft' },
  }
  const c = config[s] || config.draft
  return (
    <span className="badge" style={{ color: c.color, background: c.bg, borderColor: c.color + '33' }}>
      {c.label}
    </span>
  )
}
