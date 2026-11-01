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
