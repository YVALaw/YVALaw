// Shared pieces of the client portal (redesign 2026-11, designs/Client Portal.dc.html).
// Portal pages use these + ds.css primitives + `por-` classes in styles/portal.css.
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useRole } from '../context/RoleContext'
import type { Employee, Invoice, Project, TimeEntry } from '../data/types'
import { hmText, initials } from '../utils/format'
import { Modal, Pill, Skel } from './ui'

/* ── Who is looking: the signed-in client, or staff previewing `?preview=<clientId>` ── */

export function usePortal() {
  const { clientId: roleClientId } = useRole()
  const [searchParams] = useSearchParams()
  const previewId = searchParams.get('preview')
  const clientId = roleClientId ?? previewId
  /** Keeps ?preview= on every portal link so staff stay in preview mode */
  function portalNav(path: string) {
    if (!previewId) return path
    return `${path}${path.includes('?') ? '&' : '?'}preview=${encodeURIComponent(previewId)}`
  }
  return { clientId, roleClientId, previewId, isPreview: Boolean(previewId), portalNav }
}

/* ── Section card (title, optional sub + action) ── */

export default function PortalSection({ title, sub, children, action, className = '' }: {
  title: ReactNode; sub?: ReactNode; children: ReactNode; action?: ReactNode; className?: string
}) {
  return (
    <section className={`card por-card ${className}`.trim()}>
      <div className="por-card__head">
        <div className="por-card__titles">
          <h2 className="por-card__title">{title}</h2>
          {sub && <p className="por-card__sub">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/* ── Dates & hours ── */

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
/** Monday of the current week (local), as YYYY-MM-DD */
export function weekStartIso(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return isoDay(d)
}
export const monthKey = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
export const monthLabel = (now = new Date()) => now.toLocaleString('en-US', { month: 'long' })
/** Decimal hours → "7h 20m"; zero → "—" */
export const hoursText = (h: number) => (h > 0 ? hmText(h * 3600) : '—')

export function entriesFor(emp: Employee, entries: TimeEntry[]) {
  return entries.filter(e => e.employeeId === emp.id || e.employeeName?.toLowerCase() === emp.name.toLowerCase())
}
export function sumHours(entries: TimeEntry[], from?: string, prefix?: string) {
  return entries
    .filter(e => (!from || e.date >= from) && (!prefix || e.date.startsWith(prefix)))
    .reduce((s, e) => s + (Number(e.hours) || 0), 0)
}

/* ── Invoices ── */

export const isUnpaid = (inv: Invoice) => ['sent', 'viewed', 'overdue', 'partial'].includes((inv.status ?? '').toLowerCase())
export const invoiceBalance = (inv: Invoice) => (Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)
/** Oldest unpaid invoice (earliest due date, then issue date) */
export function oldestUnpaid(invoices: Invoice[]): Invoice | null {
  return invoices.filter(isUnpaid).sort((a, b) => String(a.dueDate ?? a.date ?? '').localeCompare(String(b.dueDate ?? b.date ?? '')))[0] ?? null
}
export function InvoicePill({ status }: { status?: string }) {
  return <Pill status={(status || 'draft').toLowerCase()} />
}

/* ── Avatars ── */

const AVATAR_COLORS = ['#0f766e', '#6d28d9', '#1e40af', '#a16207', '#475569', '#be185d', '#047857']
export function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}
export function PersonAvatar({ emp, size = 'md' }: { emp: Pick<Employee, 'name' | 'photoUrl'>; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const cls = `por-av por-av--${size}`
  if (emp.photoUrl) return <img src={emp.photoUrl} alt="" className={cls} />
  // background is a data colour (per person), the one inline style allowed here
  return <span className={cls} style={{ background: avatarColor(emp.name) }} aria-hidden>{initials(emp.name)}</span>
}

/* ── Team member modal (Home + Team) ── */

export function MemberModal({ emp, entries, projects, onClose }: { emp: Employee | null; entries: TimeEntry[]; projects: Project[]; onClose: () => void }) {
  if (!emp) return <Modal open={false} onClose={onClose} title="" />
  const mine = entriesFor(emp, entries)
  const week = sumHours(mine, weekStartIso())
  const month = sumHours(mine, undefined, monthKey())
  const total = sumHours(mine)
  const projNames = projects.filter(p => (p.employeeIds ?? []).includes(emp.id)).map(p => p.name)
  const schedule = emp.defaultShiftStart || emp.defaultShiftEnd ? [emp.defaultShiftStart, emp.defaultShiftEnd].filter(Boolean).join(' – ') : null
  const rows: [string, string | null | undefined][] = [
    ['Employment type', emp.employmentType], ['Time zone', emp.timezone], ['Schedule', schedule], ['Location', emp.location],
  ]
  return (
    <Modal open onClose={onClose} title={<span className="sr-only">{emp.name}</span>}
      footer={<button type="button" className="btn btn--block por-btn-lg" onClick={onClose}>Close</button>}>
      <div className="por-member">
        <PersonAvatar emp={emp} size="xl" />
        <div className="por-member__who">
          <span className="por-member__name">{emp.name}</span>
          <span className="por-member__role">{[emp.role || 'Team member', projNames.join(', ')].filter(Boolean).join(' · ')}</span>
          {emp.status && emp.status.toLowerCase() !== 'active' && <Pill status={emp.status} />}
        </div>
        <div className="por-member__stats">
          <div className="por-member__stat"><span>This week</span><strong>{hoursText(week)}</strong></div>
          <div className="por-member__stat"><span>{monthLabel()}</span><strong>{hoursText(month)}</strong></div>
          <div className="por-member__stat"><span>All time</span><strong>{hoursText(total)}</strong></div>
        </div>
        {rows.some(r => r[1]) && (
          <div className="por-member__rows">
            {rows.filter(r => r[1]).map(([k, v]) => <div key={k} className="por-member__row"><span>{k}</span><span>{v}</span></div>)}
          </div>
        )}
        {!schedule && <p className="por-member__note">Schedule details will appear here once configured.</p>}
      </div>
    </Modal>
  )
}

/* ── Loading skeleton shaped like a portal page ── */

export function PortalSkeleton({ hero }: { hero?: boolean }) {
  return (
    <div className="por-page" aria-busy="true" aria-label="Loading">
      {hero && <div className="por-skel-hero"><Skel h={110} r={16} /></div>}
      <div className="por-stats">
        {[0, 1, 2].map(i => <div key={i} className="card por-stat"><Skel w={90} h={12} /><Skel w={70} h={22} /></div>)}
      </div>
      <div className="por-grid">
        {[0, 1, 2].map(i => <div key={i} className="card por-skel-card"><Skel w="60%" h={14} /><Skel w="40%" h={12} /></div>)}
      </div>
    </div>
  )
}
