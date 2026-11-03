// Team → By project board (2026-11): drag a person to another project lane (or the Unassigned lane), or ⋯ →
// "Move to project…". Only `projects.employeeIds` (the team list, same as Project → Edit → Team) changes;
// placement rates are never touched. Pure (type imports only) so tests/teamAssign.test.ts can run it directly.
import type { Project } from '../data/types'

/** move: off `from`, onto `to` · add: onto `to`, stays on `from` · `to` null = only take them off `from` (Unassigned) */
export type AssignMode = 'move' | 'add'

/** The projects list after the drop (projects whose team doesn't change keep the same object, so only those are saved) */
export function applyTeamDrop(projects: Project[], employeeId: string, from: string | null, to: string | null, mode: AssignMode): Project[] {
  const takeOff = from && from !== to && (mode === 'move' || to === null) ? from : null
  return projects.map(p => {
    const ids = p.employeeIds ?? []
    const has = ids.includes(employeeId)
    if (p.id === to && !has) return { ...p, employeeIds: [...ids, employeeId] }
    if (p.id === takeOff && has) return { ...p, employeeIds: ids.filter(id => id !== employeeId) }
    return p
  })
}

/** What a drop would do — the confirm popover's choices. null = nothing to do (same lane, already there). */
export function dropChoices(projects: Project[], employeeId: string, from: string | null, to: string | null): { move: boolean; add: boolean; remove: boolean } | null {
  if (from === to) return null
  if (to === null) return from ? { move: false, add: false, remove: true } : null
  const target = projects.find(p => p.id === to)
  if (!target) return null
  const already = (target.employeeIds ?? []).includes(employeeId)
  if (!from) return already ? null : { move: false, add: true, remove: false }   // from Unassigned: adding is the only thing
  return { move: true, add: !already, remove: false }
}

/** Ids of the projects whose team differs between two lists (what a save will write) */
export const changedProjectIds = (before: Project[], after: Project[]) => after.filter((p, i) => p !== before[i]).map(p => p.id)
