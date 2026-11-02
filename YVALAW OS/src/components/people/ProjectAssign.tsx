// Put a person on projects from the people side (employee form + employee page). A project's team is
// `projects.employeeIds` (the source of truth, same as Project → Edit → Team); rates per person stay in
// placement_rates (Project → Team & rates) and are never removed here.
import { useState } from 'react'
import type { Client, Project } from '../../data/types'
import { Ic, P } from '../Icon'

const CLOSED = ['completed', 'cancelled', 'archived', 'closed']
export const isOpenProject = (p: Project) => !CLOSED.includes(String(p.status || '').toLowerCase())

/** The projects list with `employeeId` on exactly `projectIds` (only projects whose team changes are new objects) */
export function withEmployeeOn(projects: Project[], employeeId: string, projectIds: string[]): Project[] {
  const want = new Set(projectIds)
  return projects.map(p => {
    const ids = p.employeeIds ?? []
    const has = ids.includes(employeeId)
    if (want.has(p.id) && !has) return { ...p, employeeIds: [...ids, employeeId] }
    if (!want.has(p.id) && has) return { ...p, employeeIds: ids.filter(id => id !== employeeId) }
    return p
  })
}

export const projectIdsOf = (projects: Project[], employeeId: string) => projects.filter(p => (p.employeeIds ?? []).includes(employeeId)).map(p => p.id)

const label = (p: Project, clients: Client[]) => {
  const client = clients.find(c => c.id === p.clientId)?.name
  return client ? `${p.name} — ${client}` : p.name
}

/** Chips for the chosen projects + a dropdown to add another (controlled) */
export function ProjectPicker({ ids, onChange, projects, clients, disabled }: {
  ids: string[]; onChange: (ids: string[]) => void; projects: Project[]; clients: Client[]; disabled?: boolean
}) {
  const [pick, setPick] = useState('')
  const chosen = ids.map(id => projects.find(p => p.id === id)).filter((p): p is Project => !!p)
  const options = projects.filter(p => !ids.includes(p.id) && isOpenProject(p)).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="ppl-projpick">
      {chosen.length > 0 && (
        <div className="ppl-projpick__chips">
          {chosen.map(p => (
            <span key={p.id} className="chip chip--on ppl-projpick__chip">
              {label(p, clients)}
              {!disabled && <button type="button" className="ppl-projpick__x" aria-label={`Remove from ${p.name}`} onClick={() => onChange(ids.filter(i => i !== p.id))}><Ic d={P.x} size={12} /></button>}
            </span>
          ))}
        </div>
      )}
      {options.length > 0 && !disabled && (
        <select className="select" aria-label="Add to a project" value={pick}
          onChange={e => { const v = e.target.value; if (v) { onChange([...ids, v]); setPick('') } }}>
          <option value="">{chosen.length ? '+ Add another project…' : '+ Add to a project…'}</option>
          {options.map(p => <option key={p.id} value={p.id}>{label(p, clients)}</option>)}
        </select>
      )}
      {options.length === 0 && chosen.length === 0 && <span className="soft">No open projects yet — create one in Operations → Projects.</span>}
    </div>
  )
}
