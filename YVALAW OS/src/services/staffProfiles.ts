// Staff profiles: YVA's own office staff (CEO, admin, accounting, recruiter, lead gen) get an employee record on the
// YVA team (works_for 'yva') linked to their login (employees.user_id), so "My profile" works and everything they do
// can be shown on their profile (Activity tab). Created from Settings → Team access or the account menu.
import { supabase } from '../lib/supabase'
import type { Employee } from '../data/types'
import { ROLE_LABELS, type UserRole } from '../lib/roles'
import { linkEmployeeLogin, loadEmployeeCounter, loadEmployees, saveEmployeeCounter, saveEmployees } from './storage'

const SESSION_KEY = 'linkedEmployeeId'

/** "ana.perez@yva.com" → "Ana Perez" (a starting point for the name field) */
export function nameFromEmail(email: string | null | undefined): string {
  const local = (email || '').split('@')[0].replace(/[._\-+]+/g, ' ').replace(/\d+/g, ' ').trim()
  return local.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

/** The employee record linked to a login, or null (any write in this browser clears kept reads, so a new link shows at once) */
export async function findProfileForLogin(userId: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase.from('employees').select('id,name').eq('user_id', userId).limit(1)
  if (error) throw new Error(error.message)
  const row = (data || [])[0] as { id: string; name: string } | undefined
  return row ? { id: String(row.id), name: row.name } : null
}

/** Keep the session's "my employee record" in step with the database (a deleted record must not linger) */
export async function refreshMyProfile(userId: string): Promise<{ id: string; name: string } | null> {
  const p = await findProfileForLogin(userId)
  try { if (p) sessionStorage.setItem(SESSION_KEY, p.id); else sessionStorage.removeItem(SESSION_KEY) } catch { /* private mode */ }
  return p
}

/** Link an existing employee record to a login, then read it back (linkEmployeeLogin doesn't report failures) */
export async function linkStaffProfile(employeeId: string, userId: string, meId?: string | null): Promise<void> {
  await linkEmployeeLogin(employeeId, userId)
  const { data, error } = await supabase.from('employees').select('id,user_id').eq('id', employeeId).limit(1)
  if (error) throw new Error(error.message)
  const row = (data || [])[0] as { user_id?: string | null } | undefined
  if (!row) throw new Error('That employee record no longer exists.')
  if (String(row.user_id ?? '') !== userId) throw new Error(row.user_id ? 'That employee record is already linked to another login.' : 'The link was not saved.')
  if (meId && meId === userId) try { sessionStorage.setItem(SESSION_KEY, employeeId) } catch { /* private mode */ }
}

/** Create the YVA-team employee record for a staff login and link it. Returns the existing one if the login already has a profile. */
export async function createStaffProfile(opts: { userId: string; email: string; name: string; role: string; position?: string; meId?: string | null }): Promise<{ employee: Employee; existed: boolean }> {
  const name = opts.name.trim()
  if (!name) throw new Error('Enter a name.')
  const existing = await findProfileForLogin(opts.userId)
  if (existing) {
    if (opts.meId === opts.userId) try { sessionStorage.setItem(SESSION_KEY, existing.id) } catch { /* private mode */ }
    return { employee: { id: existing.id, name: existing.name }, existed: true }
  }
  const employees = await loadEmployees()
  const year = String(new Date().getFullYear()).slice(-2)
  const counter = await loadEmployeeCounter()
  await saveEmployeeCounter(counter + 1)
  const employee: Employee = {
    id: crypto.randomUUID(),
    employeeNumber: `YVA${year}${String(counter).padStart(3, '0')}`,
    name,
    email: opts.email || undefined,
    role: (opts.position ?? ROLE_LABELS[opts.role as UserRole] ?? '').trim() || undefined,
    status: 'Active',
    worksFor: 'yva',
    attachments: [],
  }
  await saveEmployees([...employees, employee])
  try {
    await linkStaffProfile(employee.id, opts.userId, opts.meId)
  } catch (e) {
    throw new Error(`${employee.name} was added to the team (${employee.employeeNumber}) but the login could not be linked: ${(e as Error).message} Use "Link to existing employee" to try again.`)
  }
  return { employee: { ...employee, userId: opts.userId }, existed: false }
}
