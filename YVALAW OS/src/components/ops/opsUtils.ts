// Operations hub (Projects, Time tracking, Calendar): small shared helpers. No React.
import type { Project, TimeEntry } from '../../data/types'
import type { Tone } from '../ui'

export type ProjectStage = 'planning' | 'active' | 'hiring' | 'review' | 'completed' | 'on-hold'
export const STAGES: { key: ProjectStage; label: string; tone: Tone }[] = [
  { key: 'planning', label: 'Planning', tone: 'neutral' },
  { key: 'active', label: 'Active', tone: 'success' },
  { key: 'hiring', label: 'Hiring', tone: 'partial' },
  { key: 'review', label: 'Review', tone: 'viewed' },
  { key: 'completed', label: 'Completed', tone: 'teal' },
  { key: 'on-hold', label: 'Paused', tone: 'warning' },
]
export const stageOf = (p: Project): ProjectStage => {
  const s = String(p.status || 'planning').toLowerCase()
  return (STAGES.some(x => x.key === s) ? s : 'planning') as ProjectStage
}
export const stageInfo = (p: Project) => STAGES.find(s => s.key === stageOf(p))!
/** Active/Paused/All filter on the Projects page: "Active" = everything still running (not paused, not completed) */
export type ProjectFilter = 'active' | 'paused' | 'all'
export function matchesFilter(p: Project, f: ProjectFilter): boolean {
  const s = stageOf(p)
  if (f === 'all') return true
  if (f === 'paused') return s === 'on-hold'
  return s !== 'on-hold' && s !== 'completed'
}

export const PAY_SHORT: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-weekly', semimonthly: 'Quincena', monthly: 'Monthly' }
export const payShort = (p: Project) => PAY_SHORT[p.paySchedule ?? 'weekly'] ?? 'Weekly'

export const BILLING_MODELS = ['hourly', 'fixed', 'retainer'] as const
export const EXPENSE_CATS = ['', 'Software', 'Hardware', 'Contractor', 'Travel', 'Marketing', 'Other']

export const uid = () => crypto.randomUUID()
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const monthPrefix = () => todayIso().slice(0, 7)
export const monthShort = () => new Date().toLocaleDateString('en-US', { month: 'short' })

/** Hours logged on a project this calendar month (time log: approved YVA Time + manual) */
export function projectMonthHours(p: Project, entries: TimeEntry[]): number {
  const m = monthPrefix()
  return entries.filter(e => e.projectId === p.id && e.date.startsWith(m)).reduce((s, e) => s + (Number(e.hours) || 0), 0)
}
/** decimal hours → "362h" / "7h 30m" */
export function hoursLabel(h: number): string {
  const m = Math.round(h * 60)
  if (m === 0) return '0h'
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`
}
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
