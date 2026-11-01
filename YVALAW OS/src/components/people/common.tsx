// People hub: small shared pieces (person avatar, placement and pay-schedule labels, status tones).
import type { Client, Employee, Project } from '../../data/types'
import { initials } from '../../utils/format'
import type { Tone } from '../ui'

const AVATAR_COLORS = ['#0f766e', '#1b1e2b', '#6d28d9', '#a16207', '#1e40af', '#b45309', '#475569']
export function avatarColor(name: string) {
  let h = 0
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[Math.abs(h)]
}

/** Coloured initials (or the photo) — colour is data, so it is the one inline style here */
export function PersonAvatar({ name, photo, size = 'md' }: { name: string; photo?: string | null; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <span className={`ppl-av ppl-av--${size}`} style={photo ? undefined : { background: avatarColor(name) }} aria-hidden>
      {photo ? <img src={photo} alt="" /> : initials(name)}
    </span>
  )
}

export function employeeStatusTone(s?: string): Tone {
  switch ((s || '').toLowerCase()) {
    case 'inactive': return 'danger'
    case 'on hold': return 'warning'
    case 'onboarding': return 'info'
    case 'trial': return 'viewed'
    default: return 'success'
  }
}

export const PAY_SCHEDULE_SHORT: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Quincena', monthly: 'Monthly' }

export function projectsOf(e: Employee, projects: Project[]) {
  return projects.filter(p => (p.employeeIds || []).includes(e.id))
}

/** "Harbor Dental · Front desk", "YVA team" or "Unassigned" */
export function placementOf(e: Employee, projects: Project[], clients: Client[]): string {
  const mine = projectsOf(e, projects)
  if (mine.length === 0) return e.worksFor === 'yva' ? 'YVA team' : 'Unassigned'
  const label = (p: Project) => { const c = clients.find(x => x.id === p.clientId)?.name; return c ? `${c} · ${p.name}` : p.name }
  return mine.length === 1 ? label(mine[0]) : `${label(mine[0])} +${mine.length - 1}`
}

/** Own schedule, else the first project's (weekly by default), YVA team weekly */
export function payScheduleOf(e: Employee, projects: Project[]): { label: string; own: boolean } {
  if (e.paySchedule) return { label: PAY_SCHEDULE_SHORT[e.paySchedule] ?? e.paySchedule, own: true }
  if (e.worksFor === 'yva') return { label: 'Weekly', own: false }
  const p = projectsOf(e, projects)[0]
  return { label: PAY_SCHEDULE_SHORT[p?.paySchedule || 'weekly'], own: false }
}

export const firstName = (name: string) => name.split(' ')[0] || name

/** Next work anniversary from the hire date (yyyy-mm-dd), when it falls within `withinDays` (today included).
 *  Only the hire date gives a day — people with just a hire year never get the pill. */
export function upcomingAnniversary(e: Pick<Employee, 'hireDate'>, now = new Date(), withinDays = 30): { years: number; date: Date; days: number; label: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(e.hireDate || '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Feb 29 hires celebrate on Mar 1 in other years (Date rolls over by itself)
  let date = new Date(today.getFullYear(), mo, d)
  if (date < today) date = new Date(today.getFullYear() + 1, mo, d)
  const years = date.getFullYear() - y
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (years < 1 || days > withinDays) return null
  const md = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { years, date, days, label: `${years}-year anniversary · ${md}` }
}

/** "Nov 14, 2023" for a stored yyyy-mm-dd (read as a local date, never UTC) */
export function hireDateLabel(v?: string | null): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '')
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined
}
