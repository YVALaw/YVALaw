import { useState } from 'react'
import type { Client, Employee, Project, Tag } from '../../data/types'
import { PAY_SCHEDULES, type PaySchedule } from '../../utils/moneyRules'
import { TagInput } from '../TagInput'
import { Avatar, Field } from '../ui'
import { Ic, P } from '../Icon'
import { BILLING_MODELS, STAGES } from './opsUtils'

type LinkEntry = { label: string; url: string }
export type ProjectFormState = {
  name: string; rate: string; budget: string; clientId: string; status: string
  billingModel: string; startDate: string; endDate: string; notes: string
  description: string; projectNeeds: string
  links: LinkEntry[]; employeeIds: string[]; tags: string[]
  paySchedule: PaySchedule; payAnchor: string
  supervisorName: string; supervisorEmail: string; supervisorPhone: string; employeeInstructions: string
}
export const EMPTY_PROJECT_FORM: ProjectFormState = {
  name: '', rate: '', budget: '', clientId: '', status: 'planning', billingModel: 'hourly', startDate: '', endDate: '', notes: '',
  description: '', projectNeeds: '', links: [], employeeIds: [], tags: [], paySchedule: 'weekly', payAnchor: '',
  supervisorName: '', supervisorEmail: '', supervisorPhone: '', employeeInstructions: '',
}
export function formFromProject(p: Project): ProjectFormState {
  return {
    name: p.name ?? '', rate: p.rate != null ? String(p.rate) : '', budget: p.budget != null ? String(p.budget) : '',
    clientId: p.clientId ?? '', status: p.status ?? 'planning', billingModel: p.billingModel ?? 'hourly',
    startDate: p.startDate ?? '', endDate: p.endDate ?? '', notes: p.notes ?? '', description: p.description ?? '', projectNeeds: p.projectNeeds ?? '',
    links: (p.links ?? []) as LinkEntry[], employeeIds: p.employeeIds ?? [], tags: p.tags ?? [],
    paySchedule: p.paySchedule ?? 'weekly', payAnchor: p.payAnchor ?? '',
    supervisorName: p.supervisorName ?? '', supervisorEmail: p.supervisorEmail ?? '', supervisorPhone: p.supervisorPhone ?? '', employeeInstructions: p.employeeInstructions ?? '',
  }
}
/** Same field rules as before the redesign (empty → undefined/null, anchor only for biweekly) */
export function projectFields(form: ProjectFormState): Partial<Project> {
  return {
    name: form.name.trim(), rate: form.rate ? Number(form.rate) : undefined, budget: form.budget ? Number(form.budget) : undefined,
    clientId: form.clientId || null, status: form.status, billingModel: form.billingModel,
    startDate: form.startDate || undefined, endDate: form.endDate || undefined,
    description: form.description || undefined, projectNeeds: form.projectNeeds || undefined, notes: form.notes || undefined,
    links: form.links.length > 0 ? form.links : undefined, employeeIds: form.employeeIds, tags: form.tags.length > 0 ? form.tags : undefined,
    paySchedule: form.paySchedule, payAnchor: form.paySchedule === 'biweekly' && form.payAnchor ? form.payAnchor : null,
    supervisorName: form.supervisorName.trim() || null, supervisorEmail: form.supervisorEmail.trim() || null,
    supervisorPhone: form.supervisorPhone.trim() || null, employeeInstructions: form.employeeInstructions.trim() || null,
  }
}

/** Selected people as removable chips + a searchable "add member" picker */
export function TeamPicker({ ids, employees, onChange }: { ids: string[]; employees: Employee[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const needle = q.trim().toLowerCase()
  const options = employees.filter(e => !ids.includes(e.id) && (!needle || e.name.toLowerCase().includes(needle) || (e.role || '').toLowerCase().includes(needle))).slice(0, 10)
  return (
    <div className="stack ops-teampicker">
      {ids.length > 0 && (
        <div className="ops-chips-wrap">
          {ids.map(id => {
            const e = employees.find(x => x.id === id)
            if (!e) return null
            return (
              <span key={id} className="ops-person-chip">
                <Avatar name={e.name} size="sm" soft />{e.name}
                <button type="button" aria-label={`Remove ${e.name}`} onClick={() => onChange(ids.filter(x => x !== id))}><Ic d={P.x} size={12} stroke={2.4} /></button>
              </span>
            )
          })}
        </div>
      )}
      <div className="ops-combo">
        <input className="input" placeholder="Search and add team member…" aria-label="Add team member" value={q} autoComplete="off"
          onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        {open && (
          <div className="ops-combo__list" role="listbox">
            {options.map(e => (
              <button type="button" key={e.id} className="ops-combo__opt" onMouseDown={() => { onChange([...ids, e.id]); setQ(''); setOpen(false) }}>
                <b>{e.name}</b>{e.role && <span className="muted">{e.role}</span>}
              </button>
            ))}
            {options.length === 0 && <div className="ops-combo__empty">No matches</div>}
          </div>
        )}
      </div>
    </div>
  )
}

export function LinksEditor({ links, onChange }: { links: LinkEntry[]; onChange: (l: LinkEntry[]) => void }) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const add = () => { if (!label.trim() || !url.trim()) return; onChange([...links, { label: label.trim(), url: url.trim() }]); setLabel(''); setUrl('') }
  return (
    <div className="stack">
      {links.map((lk, i) => (
        <div key={i} className="ops-link-row">
          <a href={lk.url} target="_blank" rel="noopener noreferrer" className="link">{lk.label}</a>
          <span className="ops-link-row__url">{lk.url}</span>
          <button type="button" className="btn btn--xs btn--ghost btn--danger" aria-label={`Remove link ${lk.label}`} onClick={() => onChange(links.filter((_, j) => j !== i))}><Ic d={P.x} size={12} /></button>
        </div>
      ))}
      <div className="ops-link-add">
        <input className="input" aria-label="Link label" value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Drive)" />
        <input className="input" aria-label="Link URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
        <button type="button" className="btn" onClick={add} disabled={!label.trim() || !url.trim()}>+ Add</button>
      </div>
    </div>
  )
}

/** Every project setting, grouped (New project drawer and Edit project drawer) */
export default function ProjectFormFields({ form, setForm, clients, employees, allTags, onTagCreated }: {
  form: ProjectFormState; setForm: (f: (prev: ProjectFormState) => ProjectFormState) => void
  clients: Client[]; employees: Employee[]; allTags: Tag[]; onTagCreated: (t: Tag) => void
}) {
  const set = <K extends keyof ProjectFormState>(k: K, v: ProjectFormState[K]) => setForm(f => ({ ...f, [k]: v }))
  return (
    <>
      <div className="form-section">
        <h3 className="form-section__title">Basics</h3>
        <div className="form-grid form-grid--2">
          <Field label="Project name *" full><input className="input" aria-label="Project name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Intake Team" autoFocus /></Field>
          <Field label="Client">
            <select className="select" aria-label="Client" value={form.clientId} onChange={e => set('clientId', e.target.value)}>
              <option value="">— No client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Stage">
            <select className="select" aria-label="Stage" value={form.status} onChange={e => set('status', e.target.value)}>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.key === 'on-hold' ? 'Paused (on hold)' : s.label}</option>)}
            </select>
          </Field>
          <Field label="Billing model">
            <select className="select" aria-label="Billing model" value={form.billingModel} onChange={e => set('billingModel', e.target.value)}>
              {BILLING_MODELS.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Default bill rate ($/hr)" hint="Per-person rates live in Team & rates"><input className="input" aria-label="Rate" type="number" inputMode="decimal" value={form.rate} onChange={e => set('rate', e.target.value)} placeholder="12.00" /></Field>
          <Field label="Budget ($)"><input className="input" aria-label="Budget" type="number" inputMode="decimal" value={form.budget} onChange={e => set('budget', e.target.value)} placeholder="Total project budget" /></Field>
          <Field label="Start date"><input className="input" aria-label="Start date" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} /></Field>
          <Field label="End date"><input className="input" aria-label="End date" type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} /></Field>
        </div>
      </div>

      <div className="form-section">
        <h3 className="form-section__title">Pay schedule and supervisor</h3>
        <div className="form-grid form-grid--2">
          <Field label="Pay schedule">
            <select className="select" aria-label="Pay schedule" value={form.paySchedule} onChange={e => set('paySchedule', e.target.value as PaySchedule)}>
              {PAY_SCHEDULES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          {form.paySchedule === 'biweekly'
            ? <Field label="First period starts (Monday)"><input className="input" aria-label="First period starts" type="date" value={form.payAnchor} onChange={e => set('payAnchor', e.target.value)} /></Field>
            : <div className="hide-phone" />}
          <Field label="Client supervisor"><input className="input" aria-label="Supervisor name" value={form.supervisorName} placeholder="Name" onChange={e => set('supervisorName', e.target.value)} /></Field>
          <Field label="Supervisor email"><input className="input" aria-label="Supervisor email" type="email" value={form.supervisorEmail} placeholder="name@client.com" onChange={e => set('supervisorEmail', e.target.value)} /></Field>
          <Field label="Supervisor phone / WhatsApp"><input className="input" aria-label="Supervisor phone" value={form.supervisorPhone} placeholder="+1 305 555 0100" onChange={e => set('supervisorPhone', e.target.value)} /></Field>
          <Field label="Instructions for the team" hint="Shown in My workspace → My client" full>
            <textarea className="textarea" aria-label="Instructions for the team" rows={3} value={form.employeeInstructions} onChange={e => set('employeeInstructions', e.target.value)} placeholder="e.g. Answer calls with: Thank you for calling Halavi Law…" />
          </Field>
        </div>
      </div>

      <div className="form-section">
        <h3 className="form-section__title">Team</h3>
        <TeamPicker ids={form.employeeIds} employees={employees} onChange={ids => set('employeeIds', ids)} />
      </div>

      <div className="form-section">
        <h3 className="form-section__title">Details</h3>
        <div className="form-grid form-grid--2">
          <Field label="Description" full><textarea className="textarea" aria-label="Description" rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Overview of the project…" /></Field>
          <Field label="Project needs" full><textarea className="textarea" aria-label="Project needs" rows={2} value={form.projectNeeds} onChange={e => set('projectNeeds', e.target.value)} placeholder="Skills, roles, or requirements needed…" /></Field>
          <Field label="Notes" full><textarea className="textarea" aria-label="Notes" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </div>
      </div>

      <div className="form-section">
        <h3 className="form-section__title">Tags</h3>
        <TagInput tags={form.tags} onChange={tags => set('tags', tags)} allTags={allTags} onTagCreated={onTagCreated} />
      </div>

      <div className="form-section">
        <h3 className="form-section__title">Documents and links</h3>
        <LinksEditor links={form.links} onChange={links => set('links', links)} />
      </div>
    </>
  )
}
