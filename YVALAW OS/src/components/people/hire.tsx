// People hub: hiring a candidate — complete the employee profile (prefilled from the candidate), then the
// onboarding checklist. The employee is created exactly as before (same dedupe, number and fields) plus what
// the person filled in on the completion form.
import { useState } from 'react'
import type { Candidate, Employee } from '../../data/types'
import { loadEmployeeCounter, loadEmployees, saveEmployeeCounter, saveEmployees } from '../../services/storage'
import { normalizeClockInput } from '../../utils/payroll'
import { Checkbox, Field, Modal } from '../ui'

export const ONBOARDING_TASKS = [
  'Set up work email address',
  'Add to payroll system',
  'Add to employee roster in YVA OS',
  'Assign to active project',
  'Schedule onboarding call',
  'Send tools & access credentials',
  'Complete HR paperwork / NDA',
  'Add to team Slack / communication channel',
]

async function generateEmployeeNumber(): Promise<string> {
  const year = String(new Date().getFullYear()).slice(-2)
  const counter = await loadEmployeeCounter()
  await saveEmployeeCounter(counter + 1)
  return `YVA${year}${String(counter).padStart(3, '0')}`
}

export type HireDetails = {
  name: string; email: string; phone: string; role: string; worksFor: 'client' | 'yva'; employmentType: string
  status: string; startYear: string; location: string; timezone: string; defaultShiftStart: string; defaultShiftEnd: string; payRate: string; notes: string
}

export function hireDetailsFrom(c: Candidate): HireDetails {
  return {
    name: c.name, email: c.email || '', phone: c.phone || '', role: c.role || '', worksFor: 'client', employmentType: '',
    status: 'Onboarding', startYear: String(new Date().getFullYear()), location: '', timezone: '', defaultShiftStart: '', defaultShiftEnd: '', payRate: '', notes: c.notes || '',
  }
}

/** Creates the employee for a hired candidate. An existing employee with the same name or email is reused (never a duplicate). */
export async function convertCandidateToEmployee(cand: Candidate, d?: HireDetails): Promise<{ employee: Employee; existed: boolean }> {
  const employees = await loadEmployees()
  const email = (d?.email ?? cand.email ?? '').toLowerCase()
  const existing = employees.find(e =>
    e.name.toLowerCase() === (d?.name ?? cand.name).toLowerCase() ||
    (email && e.email?.toLowerCase() === email)
  )
  if (existing) return { employee: existing, existed: true }
  const empNum = await generateEmployeeNumber()
  const nextEmployee: Employee = {
    id: crypto.randomUUID(),
    employeeNumber: empNum,
    name: (d?.name ?? cand.name).trim(),
    email: (d?.email ?? cand.email) || undefined,
    phone: (d?.phone ?? cand.phone) || undefined,
    role: (d?.role ?? cand.role) || undefined,
    notes: (d?.notes ?? cand.notes) || undefined,
    attachments: cand.attachments || [],
    status: d?.status || 'Onboarding',
    ...(d ? {
      worksFor: d.worksFor,
      employmentType: d.employmentType || undefined,
      startYear: d.startYear ? Number(d.startYear) : undefined,
      location: d.location || undefined,
      timezone: d.timezone || undefined,
      defaultShiftStart: d.defaultShiftStart || undefined,
      defaultShiftEnd: d.defaultShiftEnd || undefined,
      payRate: d.payRate ? Number(d.payRate) : undefined,
    } : {}),
  }
  await saveEmployees([...employees, nextEmployee])
  return { employee: nextEmployee, existed: false }
}

export function HireModal({ candidate, open, onClose, onConfirm, busy, pay }: {
  candidate: Candidate | null; open: boolean; onClose: () => void; onConfirm: (d: HireDetails) => void; busy: boolean; pay: boolean
}) {
  const [d, setD] = useState<HireDetails | null>(null)
  const [forId, setForId] = useState<string | null>(null)
  if (candidate && forId !== candidate.id) { setForId(candidate.id); setD(hireDetailsFrom(candidate)) }
  if (!candidate || !d) return null
  const set = (patch: Partial<HireDetails>) => setD({ ...d, ...patch })
  return (
    <Modal open={open} onClose={onClose} size="wide" title={`Hire ${candidate.name}`} sub="Complete the employee profile. The candidate card is removed once the employee is created."
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn--primary" disabled={busy || !d.name.trim()} onClick={() => onConfirm(d)}>{busy ? 'Creating…' : 'Create employee'}</button>
      </>}>
      <div className="form-grid">
        <Field label="Full name *"><input className="input" value={d.name} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Role / position"><input className="input" value={d.role} onChange={e => set({ role: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={d.email} onChange={e => set({ email: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={d.phone} onChange={e => set({ phone: e.target.value })} /></Field>
        <Field label="Works for">
          <select className="select" value={d.worksFor} onChange={e => set({ worksFor: e.target.value === 'yva' ? 'yva' : 'client' })}>
            <option value="client">Client project (screenshots on)</option>
            <option value="yva">YVA team (screenshots off)</option>
          </select>
        </Field>
        <Field label="Employment type">
          <select className="select" value={d.employmentType} onChange={e => set({ employmentType: e.target.value })}>
            {['', 'Full-time', 'Part-time', 'Project-based'].map(t => <option key={t} value={t}>{t || '— Not set —'}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className="select" value={d.status} onChange={e => set({ status: e.target.value })}>{['Onboarding', 'Trial', 'Active'].map(s => <option key={s}>{s}</option>)}</select>
        </Field>
        <Field label="Hire year"><input className="input" inputMode="numeric" value={d.startYear} onChange={e => set({ startYear: e.target.value })} /></Field>
        <Field label="Default shift start"><input className="input" value={d.defaultShiftStart} placeholder="9:00 am" onChange={e => set({ defaultShiftStart: e.target.value })} onBlur={e => set({ defaultShiftStart: normalizeClockInput(e.target.value) })} /></Field>
        <Field label="Default shift end"><input className="input" value={d.defaultShiftEnd} placeholder="5:00 pm" onChange={e => set({ defaultShiftEnd: e.target.value })} onBlur={e => set({ defaultShiftEnd: normalizeClockInput(e.target.value) })} /></Field>
        <Field label="Location"><input className="input" value={d.location} placeholder="Santo Domingo, DO" onChange={e => set({ location: e.target.value })} /></Field>
        <Field label="Timezone"><input className="input" value={d.timezone} placeholder="America/Santo_Domingo" onChange={e => set({ timezone: e.target.value })} /></Field>
        {pay && <Field label="Pay rate ($/hr)"><input className="input" type="number" inputMode="decimal" value={d.payRate} onChange={e => set({ payRate: e.target.value })} /></Field>}
        <Field label="Notes" full><textarea className="textarea" rows={2} value={d.notes} onChange={e => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

export function OnboardingChecklist({ checked, toggle }: { checked: Set<number>; toggle: (i: number) => void }) {
  const pct = Math.round(checked.size / ONBOARDING_TASKS.length * 100)
  return (
    <div className="stack">
      <div className="row row--between"><span className="muted">{checked.size} / {ONBOARDING_TASKS.length} completed</span><span className="num muted">{pct}%</span></div>
      <div className="progress"><div className="progress__fill" style={{ width: `${pct}%` }} /></div>
      <div className="ppl-checklist">
        {ONBOARDING_TASKS.map((task, i) => (
          <div key={i} className={`ppl-check${checked.has(i) ? ' ppl-check--done' : ''}`}><Checkbox checked={checked.has(i)} onChange={() => toggle(i)} label={task} /></div>
        ))}
      </div>
      {checked.size === ONBOARDING_TASKS.length && <div className="banner banner--success">All onboarding tasks complete!</div>}
    </div>
  )
}

export function OnboardingModal({ candidate, employee, onClose, onOpenEmployee }: { candidate: Candidate | null; employee?: Employee | null; onClose: () => void; onOpenEmployee?: () => void }) {
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [forId, setForId] = useState<string | null>(null)
  if (candidate && forId !== candidate.id) { setForId(candidate.id); setChecked(new Set()) }
  const toggle = (i: number) => setChecked(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })
  return (
    <Modal open={!!candidate} onClose={onClose} title={`Onboarding — ${candidate?.name ?? ''}`}
      sub={`${candidate?.role || 'New hire'}${employee?.employeeNumber ? ` · employee ${employee.employeeNumber}` : ''}`}
      footer={<>
        {onOpenEmployee && <button type="button" className="btn btn--ghost" onClick={onOpenEmployee}>Open employee profile</button>}
        <button type="button" className="btn" onClick={onClose}>Close</button>
        {checked.size === ONBOARDING_TASKS.length && <button type="button" className="btn btn--primary" onClick={onClose}>All done!</button>}
      </>}>
      <p className="ppl-p">Complete the following steps to onboard {candidate?.name.split(' ')[0]}:</p>
      <OnboardingChecklist checked={checked} toggle={toggle} />
    </Modal>
  )
}
