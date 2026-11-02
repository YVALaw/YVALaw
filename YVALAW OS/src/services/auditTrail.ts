// Reading the "who did what" trail (audit_log, filled by the database triggers and public.log_action):
// who a login is (name from the employee record linked to it), what a record is called, where it opens,
// and the "Created by · Last changed by" signature on record pages. Reads only — the database decides
// what each person may see (history.view + the rate / payroll / bank / lead permissions).
import { supabase } from '../lib/supabase'
import { cachedRead, LIST_MS } from '../lib/readCache'

export type PersonRef = { employeeId: string; name: string }

/** Login id → the person's name + employee record (only logins linked to an employee) */
export function loadPeopleByLogin(): Promise<Map<string, PersonRef>> {
  return cachedRead('audit:people-by-login', async () => {
    const { data } = await supabase.from('employees').select('id,name,user_id').not('user_id', 'is', null)
    const map = new Map<string, PersonRef>()
    for (const r of (data || []) as { id: string; name: string; user_id: string }[]) if (r.user_id) map.set(String(r.user_id), { employeeId: String(r.id), name: r.name })
    return map
  }, LIST_MS)
}

/** Where a record opens in YVA OS (null = no page for it) */
export function recordLink(table: string, id: string | null | undefined): string | null {
  if (!id) return null
  const e = encodeURIComponent(id)
  switch (table) {
    case 'invoices':   return `/invoice?open=${e}`
    case 'clients':    return `/clients/${e}`
    case 'projects':   return `/projects/${e}`
    case 'employees':  return `/employees/${e}`
    case 'candidates': return `/candidates/${e}`
    case 'leads':      return `/leads?open=${e}`
    default:           return null
  }
}

/** Which column names a record, per table */
const NAME_COLUMN: Record<string, string> = {
  invoices: 'number', clients: 'name', projects: 'name', employees: 'name', candidates: 'name', leads: 'name', estimates: 'number',
}

/** The name a row carried in its own history entry (inserts/deletes store the whole row) */
export function nameInRow(table: string, row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null
  const v = row[NAME_COLUMN[table] ?? 'name'] ?? row.name ?? row.number ?? row.title ?? row.description
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** "table:id" → current name, for the records on screen (one small read per table; missing/forbidden ones are skipped) */
export async function loadRecordNames(refs: { table: string; id: string }[]): Promise<Map<string, string>> {
  const byTable = new Map<string, Set<string>>()
  for (const r of refs) if (NAME_COLUMN[r.table] && r.id) (byTable.get(r.table) ?? byTable.set(r.table, new Set()).get(r.table)!).add(r.id)
  const out = new Map<string, string>()
  await Promise.all([...byTable].map(async ([table, ids]) => {
    const col = NAME_COLUMN[table]
    try {
      const { data } = await supabase.from(table).select(`id,${col}`).in('id', [...ids].slice(0, 200))
      for (const r of (data || []) as unknown as Record<string, unknown>[]) {
        const v = r[col]
        if (typeof v === 'string' && v) out.set(`${table}:${r.id}`, v)
      }
    } catch { /* a table this person can't read: keep the generic label */ }
  }))
  return out
}

export type Signature = {
  created: { at: number; actorId: string | null; actorEmail: string | null } | null
  changed: { at: number; actorId: string | null; actorEmail: string | null } | null
}

/** First (insert) and latest (insert/update) history entry of one record. null = history not readable / nothing recorded. */
export async function loadSignature(table: string, recordId: string): Promise<Signature | null> {
  const base = () => supabase.from('audit_log').select('at,actor_id,actor_email,action').eq('table_name', table).eq('record_id', recordId)
  const [c, l] = await Promise.all([
    base().eq('action', 'insert').order('at', { ascending: true }).limit(1),
    base().in('action', ['insert', 'update']).order('at', { ascending: false }).limit(1),
  ])
  if (c.error || l.error) return null
  const pick = (rows: unknown[] | null) => {
    const r = (rows || [])[0] as { at: string; actor_id: string | null; actor_email: string | null } | undefined
    return r ? { at: Date.parse(r.at), actorId: r.actor_id, actorEmail: r.actor_email } : null
  }
  const sig = { created: pick(c.data), changed: pick(l.data) }
  return sig.created || sig.changed ? sig : null
}

/** A person's display name: linked employee name → email → generic */
export function actorName(actorId: string | null, actorEmail: string | null, people: Map<string, PersonRef>): string {
  if (!actorId) return 'YVA OS (automatic)'
  return people.get(actorId)?.name || actorEmail || 'A team member'
}
