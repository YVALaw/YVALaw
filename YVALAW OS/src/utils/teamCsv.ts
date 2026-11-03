// People → Team → Export CSV (2026-11): the rows of the currently filtered team list.
// Only contact / placement fields. NEVER pay rates, premiums, bank / PayPal details, notes, attachments or CC
// lists — the columns are an explicit allow-list, so a new Employee field can't leak into the file by itself.
// Pure (type imports only) so tests/teamCsv.test.ts can run it directly.
import type { Client, Employee, Project } from '../data/types'

export const TEAM_CSV_HEADER = ['Employee #', 'Name', 'Email', 'Phone', 'Role / position', 'Works for', 'Status', 'Projects', 'Hire date', 'Location', 'Pay schedule'] as const

/** `paySchedule(e)` = the label the Team page shows (components/people/common.tsx payScheduleOf) */
export function teamCsvRows(employees: Employee[], projects: Project[], clients: Client[], paySchedule: (e: Employee) => string): string[][] {
  const projectLabel = (p: Project) => { const c = clients.find(x => x.id === p.clientId)?.name; return c ? `${p.name} (${c})` : p.name }
  return [
    [...TEAM_CSV_HEADER],
    ...employees.map(e => [
      e.employeeNumber ?? '',
      e.name ?? '',
      e.email ?? '',
      e.phone ?? '',
      e.role ?? '',
      e.worksFor === 'yva' ? 'YVA team' : 'Client project',
      e.status || 'Active',
      projects.filter(p => (p.employeeIds ?? []).includes(e.id)).map(projectLabel).sort((a, b) => a.localeCompare(b)).join('; '),
      e.hireDate || (e.startYear != null ? String(e.startYear) : ''),
      e.location ?? '',
      paySchedule(e),
    ]),
  ]
}

/** team-2026-11-03.csv */
export const teamCsvFileName = (now = new Date()) =>
  `team-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.csv`
