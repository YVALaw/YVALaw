// People hub: every employee field, shared by Team → Add / Edit and the employee profile's inline edit.
import type { Employee } from '../../data/types'
import { normalizeClockInput } from '../../utils/payroll'
import { PAY_SCHEDULES, type PaySchedule } from '../../utils/moneyRules'
import { Field } from '../ui'

export const STATUS_OPTIONS = ['Active', 'Onboarding', 'Trial', 'On hold', 'Inactive']
export const TYPE_OPTIONS = ['', 'Full-time', 'Part-time', 'Project-based']

export type EmployeeFormData = {
  name: string; email: string; phone: string; payRate: string
  defaultShiftStart: string; defaultShiftEnd: string
  premiumEnabled: boolean; premiumStartTime: string; premiumPercent: string
  role: string; employmentType: string; location: string
  timezone: string; startYear: string; hireDate: string; status: string; notes: string
  worksFor: 'client' | 'yva'; manualTimeAllowed: boolean
  paySchedule: PaySchedule | ''; payAnchor: string
}

export const EMPTY_EMPLOYEE_FORM: EmployeeFormData = {
  name: '', email: '', phone: '', payRate: '', defaultShiftStart: '', defaultShiftEnd: '', premiumEnabled: false, premiumStartTime: '21:00', premiumPercent: '15', role: '', employmentType: '',
  location: '', timezone: '', startYear: '', hireDate: '', status: 'Active', notes: '', worksFor: 'client', manualTimeAllowed: false, paySchedule: '', payAnchor: '',
}

export function employeeToForm(e: Employee): EmployeeFormData {
  return {
    name: e.name ?? '', email: e.email ?? '', phone: e.phone ?? '',
    payRate: e.payRate != null ? String(e.payRate) : '',
    defaultShiftStart: e.defaultShiftStart || '',
    defaultShiftEnd: e.defaultShiftEnd || '',
    premiumEnabled: Boolean(e.premiumEnabled),
    premiumStartTime: e.premiumStartTime || '21:00',
    premiumPercent: e.premiumPercent != null ? String(e.premiumPercent) : '15',
    role: e.role ?? '', employmentType: e.employmentType ?? '', location: e.location ?? '', timezone: e.timezone ?? '',
    startYear: e.startYear != null ? String(e.startYear) : '',
    hireDate: e.hireDate ? String(e.hireDate).slice(0, 10) : '',
    status: e.status ?? 'Active', notes: e.notes ?? '',
    worksFor: e.worksFor === 'yva' ? 'yva' : 'client',
    manualTimeAllowed: e.manualTimeAllowed === true,
    paySchedule: e.paySchedule ?? '', payAnchor: e.payAnchor ?? '',
  }
}

/** The employee fields a save writes (same conversions as before the redesign). Pay schedule only when the
 *  person may change rates — otherwise the stored value is left as it is. */
export function formToEmployee(form: EmployeeFormData, opts: { schedule: boolean }): Omit<Employee, 'id'> {
  const { paySchedule, payAnchor, ...rest } = form
  return {
    ...rest,
    payRate: form.payRate ? Number(form.payRate) : undefined,
    defaultShiftStart: form.defaultShiftStart || undefined,
    defaultShiftEnd: form.defaultShiftEnd || undefined,
    premiumEnabled: form.premiumEnabled || undefined,
    premiumStartTime: form.premiumEnabled ? (form.premiumStartTime || '21:00') : undefined,
    premiumPercent: form.premiumEnabled ? Number(form.premiumPercent || 0) : undefined,
    // A hire date sets the hire year too, so everything that reads the year keeps working
    startYear: form.hireDate ? Number(form.hireDate.slice(0, 4)) : form.startYear ? Number(form.startYear) : undefined,
    hireDate: form.hireDate || null,
    notes: form.notes || undefined,
    email: form.email || undefined,
    phone: form.phone || undefined,
    role: form.role || undefined,
    employmentType: form.employmentType || undefined,
    location: form.location || undefined,
    timezone: form.timezone || undefined,
    ...(opts.schedule ? { paySchedule: paySchedule || null, payAnchor: paySchedule === 'biweekly' && payAnchor ? payAnchor : null } : {}),
  }
}

/** Grouped fields: Basics · YVA Time · Schedule & pay · Contact · Notes.
 *  `pay` shows pay rate + night premium (can.viewPayRates); `schedule` shows the pay schedule (rates.manage). */
export function EmployeeFields({ form, setForm, pay, schedule, withName = true }: {
  form: EmployeeFormData
  setForm: (f: EmployeeFormData) => void
  pay: boolean
  schedule: boolean
  withName?: boolean
}) {
  const set = (patch: Partial<EmployeeFormData>) => setForm({ ...form, ...patch })
  return (
    <div className="ppl-form">
      <section className="form-section">
        <h3 className="form-section__title">Basics</h3>
        <div className="form-grid">
          {withName && <Field label="Full name *" full><input className="input" value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Full name" /></Field>}
          <Field label="Role / position"><input className="input" value={form.role} onChange={e => set({ role: e.target.value })} placeholder="e.g. Intake Specialist" /></Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={e => set({ status: e.target.value })}>{STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}</select>
          </Field>
          <Field label="Employment type">
            <select className="select" value={form.employmentType} onChange={e => set({ employmentType: e.target.value })}>{TYPE_OPTIONS.map(t => <option key={t} value={t}>{t || '— Not set —'}</option>)}</select>
          </Field>
          <Field label="Hire date">
            <input className="input" type="date" value={form.hireDate}
              onChange={e => set({ hireDate: e.target.value, ...(e.target.value ? { startYear: e.target.value.slice(0, 4) } : {}) })} />
          </Field>
          <Field label="Hire year"><input className="input" inputMode="numeric" value={form.startYear} disabled={!!form.hireDate} onChange={e => set({ startYear: e.target.value })} placeholder="2025" /></Field>
        </div>
      </section>

      <section className="form-section">
        <h3 className="form-section__title">YVA Time</h3>
        <div className="form-grid">
          <Field label="Works for">
            <select className="select" value={form.worksFor} onChange={e => set({ worksFor: e.target.value === 'yva' ? 'yva' : 'client' })}>
              <option value="client">Client project (screenshots on)</option>
              <option value="yva">YVA team (screenshots off)</option>
            </select>
          </Field>
          <Field label="Manual time">
            <select className="select" value={form.manualTimeAllowed ? 'on' : 'off'} onChange={e => set({ manualTimeAllowed: e.target.value === 'on' })}>
              <option value="off">Off</option>
              <option value="on">On — can add time by hand (admin approves)</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="form-section">
        <h3 className="form-section__title">Schedule{pay || schedule ? ' & pay' : ''}</h3>
        <div className="form-grid">
          <Field label="Default shift start"><input className="input" value={form.defaultShiftStart} onChange={e => set({ defaultShiftStart: e.target.value })} onBlur={e => set({ defaultShiftStart: normalizeClockInput(e.target.value) })} placeholder="4:00 pm" /></Field>
          <Field label="Default shift end"><input className="input" value={form.defaultShiftEnd} onChange={e => set({ defaultShiftEnd: e.target.value })} onBlur={e => set({ defaultShiftEnd: normalizeClockInput(e.target.value) })} placeholder="12:00 am" /></Field>
          <Field label="Timezone"><input className="input" value={form.timezone} onChange={e => set({ timezone: e.target.value })} placeholder="America/Santo_Domingo" /></Field>
          {pay && <>
            <Field label="Pay rate ($/hr)"><input className="input" type="number" inputMode="decimal" value={form.payRate} onChange={e => set({ payRate: e.target.value })} placeholder="4.50" /></Field>
            <Field label="Premium rule">
              <select className="select" value={form.premiumEnabled ? 'night' : ''} onChange={e => set({ premiumEnabled: e.target.value === 'night' })}>
                <option value="">No premium pay</option>
                <option value="night">Night shift premium</option>
              </select>
            </Field>
            {form.premiumEnabled && <>
              <Field label="Premium starts at"><input className="input" value={form.premiumStartTime} onChange={e => set({ premiumStartTime: e.target.value })} onBlur={e => set({ premiumStartTime: normalizeClockInput(e.target.value) || '21:00' })} placeholder="9:00 pm" /></Field>
              <Field label="Premium increase %"><input className="input" type="number" value={form.premiumPercent} onChange={e => set({ premiumPercent: e.target.value })} placeholder="15" /></Field>
            </>}
          </>}
          {schedule && <>
            <Field label="Pay schedule">
              <select className="select" value={form.paySchedule} onChange={e => set({ paySchedule: e.target.value as PaySchedule | '' })}>
                <option value="">Follow the project{form.worksFor === 'yva' ? ' (weekly for the YVA team)' : ''}</option>
                {PAY_SCHEDULES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </Field>
            {form.paySchedule === 'biweekly' && <Field label="Period starts (a Monday)"><input className="input" type="date" value={form.payAnchor} onChange={e => set({ payAnchor: e.target.value })} /></Field>}
          </>}
        </div>
      </section>

      <section className="form-section">
        <h3 className="form-section__title">Contact</h3>
        <div className="form-grid">
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={e => set({ email: e.target.value })} placeholder="name@example.com" /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="+1 555 000 0000" /></Field>
          <Field label="Location"><input className="input" value={form.location} onChange={e => set({ location: e.target.value })} placeholder="Santo Domingo, DO" /></Field>
        </div>
      </section>

      <section className="form-section">
        <h3 className="form-section__title">Notes</h3>
        <Field label="Internal notes"><textarea className="textarea" rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Performance notes, schedule preferences, etc." /></Field>
      </section>
    </div>
  )
}
