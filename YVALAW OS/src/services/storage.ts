import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/pages'
import type {
  ActivityLogEntry, AppSettings, Candidate, CommEntryType, DataSnapshot,
  Employee, Client, Expense, Invoice, InvoiceTemplate, Project, Task,
  Estimate, TimeEntry, RecurringInvoice, StaffRequest, ClientDocument,
  PaymentAttempt,
} from '../data/types'
import { LoadTracker, applyPlan, normalizeRow, planSync, toSnakeRow as toSnake, type Row } from '../utils/syncPlan'

export type ClientPortalBillingStatus = {
  hasPortalAccount: boolean
  autoPayEnabled: boolean
  hasSavedPaymentMethod: boolean
  defaultCardBrand?: string
  defaultCardLast4?: string
  defaultCardExpMonth?: number
  defaultCardExpYear?: number
  autoPayAuthorizedAt?: string
  autoPayDisabledAt?: string
}

export type ClientBillingSummary = ClientPortalBillingStatus & {
  recentAttempts: PaymentAttempt[]
  lastAttempt?: PaymentAttempt
  lastSuccessfulAttempt?: PaymentAttempt
  lastFailedAttempt?: PaymentAttempt
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

/** snake_case DB row → camelCase TS object (top-level keys only; JSONB values untouched) */
function toCamel<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ])
  ) as T
}

// What this browser last loaded from each table (id → row as stored). Saves compare against
// it so only real changes are written — see src/utils/syncPlan.ts.
const baselines = new Map<string, Map<string, Row>>()
// Which load each list a page saves came from, so a save only deletes rows that page had
const loads = new LoadTracker()

/** Record loaded rows. A full load replaces the table's baseline; a scoped load only the rows in that scope. */
function remember(table: string, items: object[], scope?: (row: Row) => boolean) {
  let base = baselines.get(table)
  if (!base || !scope) { base = new Map(); baselines.set(table, base) }
  else for (const [id, row] of base) if (scope(row)) base.delete(id)
  for (const item of items) {
    const row = normalizeRow(item as Record<string, unknown>)
    if (row.id) base.set(row.id, row)
  }
  loads.record(table, items)
}

async function fetchAll<T>(table: string): Promise<T[]> {
  const { data, error } = await fetchAllPages<Record<string, unknown>>((from, to) => supabase.from(table).select('*').order('created_at').order('id').range(from, to))
  if (error) { console.error('fetchAll(%s)', table, error); return [] }
  const items = (data || []).map(row => toCamel<T>(row as Record<string, unknown>))
  remember(table, items as object[])
  return items
}

/**
 * Save a page's list safely: insert new records, update only the changed columns of each
 * record, delete only records this browser loaded and the page removed. Records created or
 * changed by someone else since the page loaded are left alone.
 * @param scope limit deletions to part of the table (e.g. general expenses only)
 */
async function syncAll<T extends { id: string }>(
  table: string,
  items: T[],
  scope?: (row: Row) => boolean,
): Promise<void> {
  // One save per table at a time: a second quick save is planned after the first one is written,
  // so it compares with what the first one saved (two fast toggles both stick)
  const prev = saving.get(table) ?? Promise.resolve()
  const run = prev.catch(() => undefined).then(() => syncNow(table, items, scope))
  saving.set(table, run)
  try { await run } finally { if (saving.get(table) === run) saving.delete(table) }
}
const saving = new Map<string, Promise<void>>()

async function syncNow<T extends { id: string }>(table: string, items: T[], scope?: (row: Row) => boolean): Promise<void> {
  const rows = items.map(i => normalizeRow(i as unknown as Record<string, unknown>))
  const base = baselines.get(table) ?? null
  // Each row is compared with the copy it was made from (not a newer copy another screen loaded)
  const pageBase = loads.baseline(table, items, base)
  const plan = planSync(pageBase, rows, scope, loads.deletable(table, items) ?? undefined)

  if (plan.deletes.length > 0) {
    const { error } = await supabase.from(table).delete().in('id', plan.deletes)
    if (error) throw new Error(`save(${table}) delete failed: ${error.message}`)
  }
  for (const group of plan.inserts) {
    const { error } = await supabase.from(table).upsert(group)
    if (error) throw new Error(`save(${table}) insert failed: ${error.message}`)
  }
  for (const u of plan.updates) {
    const { error } = await supabase.from(table).update(u.patch).in('id', u.ids)
    if (error) throw new Error(`save(${table}) update failed: ${error.message}`)
  }
  if (base) applyPlan(base, plan, rows)
  else baselines.set(table, new Map(rows.map(r => [r.id, r])))
  loads.recordSave(table, items, plan)
}

// ─── Employees ────────────────────────────────────────────────────────────────

export async function loadEmployees(): Promise<Employee[]> {
  return fetchAll<Employee>('employees')
}
export async function saveEmployees(employees: Employee[]): Promise<void> {
  // userId (the login link) is never written by a whole-table save — a stale list
  // must not unlink a login. It is set by linkEmployeeLogin or the invite-employee function.
  const rows = employees.map(e => { const row = { ...e }; delete row.userId; return row })
  invalidateSnapshotCache(); return syncAll('employees', rows)
}

/** Link an employee record to a login, only if it is not linked yet */
export async function linkEmployeeLogin(employeeId: string, userId: string): Promise<void> {
  invalidateSnapshotCache()
  const { error } = await supabase.from('employees').update({ user_id: userId }).eq('id', employeeId).is('user_id', null)
  if (error) console.error('linkEmployeeLogin failed', error)
}

// ─── Clients ──────────────────────────────────────────────────────────────────

export async function loadClients(): Promise<Client[]> {
  return fetchAll<Client>('clients')
}
export async function saveClients(clients: Client[]): Promise<void> {
  invalidateSnapshotCache(); return syncAll('clients', clients)
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function loadProjects(): Promise<Project[]> {
  return fetchAll<Project>('projects')
}
export async function saveProjects(projects: Project[]): Promise<void> {
  invalidateSnapshotCache(); return syncAll('projects', projects)
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function loadInvoices(): Promise<Invoice[]> {
  const { data, error } = await fetchAllPages<Record<string, unknown>>((from, to) => supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false }).order('id').range(from, to))
  if (error) { console.error('loadInvoices', error); return [] }
  const items = (data || []).map(row => toCamel<Invoice>(row as Record<string, unknown>))
  remember('invoices', items)
  return items
}
export async function saveInvoices(invoices: Invoice[]): Promise<void> {
  invalidateSnapshotCache(); return syncAll('invoices', invoices)
}

// ─── Candidates ───────────────────────────────────────────────────────────────

export async function loadCandidates(): Promise<Candidate[]> {
  return fetchAll<Candidate>('candidates')
}
export async function saveCandidates(candidates: Candidate[]): Promise<void> {
  return syncAll('candidates', candidates)
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function loadTasks(): Promise<Task[]> {
  return fetchAll<Task>('tasks')
}
export async function saveTasks(tasks: Task[]): Promise<void> {
  return syncAll('tasks', tasks)
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export async function loadExpenses(): Promise<Expense[]> {
  return fetchAll<Expense>('expenses')
}
export async function saveExpenses(expenses: Expense[]): Promise<void> {
  return syncAll('expenses', expenses)
}

export async function loadGeneralExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .is('project_id', null)
    .order('created_at')
  if (error) { console.error('loadGeneralExpenses', error); return [] }
  const items = (data || []).map(row => toCamel<Expense>(row as Record<string, unknown>))
  remember('expenses', items, isGeneralExpense)
  return items
}
const isGeneralExpense = (row: Row) => row.project_id == null
export async function saveGeneralExpenses(expenses: Expense[]): Promise<void> {
  // Only general (no project) expenses can be removed from this page — it never loads project expenses
  return syncAll('expenses', expenses, isGeneralExpense)
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export async function loadActivityLog(): Promise<ActivityLogEntry[]> {
  return fetchAll<ActivityLogEntry>('activity_log')
}
export async function saveActivityLog(entries: ActivityLogEntry[]): Promise<void> {
  return syncAll('activity_log', entries)
}

/** Append a single comm entry using a single INSERT (no read-modify-write). */
export async function logComm(
  clientId: string,
  note: string,
  type: CommEntryType = 'system',
  auto = true,
): Promise<void> {
  const { error } = await supabase.from('activity_log').insert({
    id:         crypto.randomUUID(),
    client_id:  clientId,
    note,
    created_at: Date.now(),
    type,
    auto,
  })
  if (error) console.error('logComm', error)
}

// ─── Invoice Templates ────────────────────────────────────────────────────────

export async function loadInvoiceTemplates(): Promise<InvoiceTemplate[]> {
  return fetchAll<InvoiceTemplate>('invoice_templates')
}
export async function saveInvoiceTemplates(templates: InvoiceTemplate[]): Promise<void> {
  return syncAll('invoice_templates', templates)
}

// ─── Counters ─────────────────────────────────────────────────────────────────

export async function loadInvoiceCounter(): Promise<number> {
  const { data } = await supabase.from('counters').select('value').eq('key', 'invoice').single()
  return (data as { value: number } | null)?.value ?? 1
}
export async function saveInvoiceCounter(n: number): Promise<void> {
  const { error } = await supabase.from('counters').update({ value: n }).eq('key', 'invoice')
  if (error) throw new Error(`saveInvoiceCounter failed: ${error.message}`)
}

export async function loadEmployeeCounter(): Promise<number> {
  const { data } = await supabase.from('counters').select('value').eq('key', 'employee').single()
  return (data as { value: number } | null)?.value ?? 1
}
export async function saveEmployeeCounter(n: number): Promise<void> {
  const { error } = await supabase.from('counters').update({ value: n }).eq('key', 'employee')
  if (error) throw new Error(`saveEmployeeCounter failed: ${error.message}`)
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  usdToDop: 0,
  companyName: 'YVA Staffing',
  companyEmail: '',
  emailSignature: '',
}

export async function loadSettings(): Promise<AppSettings> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
  if (error || !data) return DEFAULT_SETTINGS
  const row = data as Record<string, unknown>
  return {
    usdToDop:               (row.usd_to_dop as number) ?? 0,
    companyName:            (row.company_name as string) ?? 'YVA Staffing',
    companyEmail:           (row.company_email as string) ?? '',
    companyAddress:         (row.company_address as string | undefined),
    companyPhone:           (row.company_phone as string | undefined),
    emailSignature:         (row.email_signature as string) ?? '',
    reminderDay:            row.reminder_day != null ? (row.reminder_day as number) : undefined,
    reminderLastFired:      (row.reminder_last_fired as string | undefined),
    monthlyGoal:            row.monthly_goal != null ? (row.monthly_goal as number) : undefined,
    invoiceEmailTemplate:   (row.invoice_email_template as string | undefined),
    statementEmailTemplate: (row.statement_email_template as string | undefined),
    reminderEmailTemplate:  (row.reminder_email_template as string | undefined),
    gmailClientId:          (row.gmail_client_id as string | undefined),
    // gmailClientSecret is intentionally omitted — it must only live in the
    // GMAIL_CLIENT_SECRET Netlify env var and must never be loaded from the DB.
    gmailAccessToken:       (row.gmail_access_token as string | undefined),
    gmailRefreshToken:      (row.gmail_refresh_token as string | undefined),
    gmailTokenExpiry:       row.gmail_token_expiry != null ? (row.gmail_token_expiry as number) : undefined,
    gmailEmail:             (row.gmail_email as string | undefined),
  }
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const { error } = await supabase.from('settings').update({
    usd_to_dop:               s.usdToDop,
    company_name:             s.companyName,
    company_email:            s.companyEmail,
    company_address:          s.companyAddress,
    company_phone:            s.companyPhone,
    email_signature:          s.emailSignature,
    reminder_day:             s.reminderDay ?? null,
    reminder_last_fired:      s.reminderLastFired ?? null,
    monthly_goal:             s.monthlyGoal ?? null,
    invoice_email_template:   s.invoiceEmailTemplate ?? null,
    statement_email_template: s.statementEmailTemplate ?? null,
    reminder_email_template:  s.reminderEmailTemplate ?? null,
    gmail_client_id:          s.gmailClientId ?? null,
    // gmail_client_secret is intentionally excluded — it must only live in
    // the GMAIL_CLIENT_SECRET Netlify env var, never in the database.
    gmail_access_token:       s.gmailAccessToken ?? null,
    gmail_refresh_token:      s.gmailRefreshToken ?? null,
    gmail_token_expiry:       s.gmailTokenExpiry ?? null,
    gmail_email:              s.gmailEmail ?? null,
  }).eq('id', 1)
  if (error) console.error('saveSettings', error)
}

// ─── Snapshot cache ───────────────────────────────────────────────────────────

let _snapCache: { data: DataSnapshot; at: number } | null = null
const SNAP_TTL = 120_000 // 2 minutes

export function invalidateSnapshotCache() { _snapCache = null }

// ─── Snapshot (loads all core data in parallel) ───────────────────────────────

export async function loadSnapshot(): Promise<DataSnapshot> {
  if (_snapCache && Date.now() - _snapCache.at < SNAP_TTL) return _snapCache.data
  const [employees, projects, clients, invoices, invoiceCounter] = await Promise.all([
    loadEmployees(),
    loadProjects(),
    loadClients(),
    loadInvoices(),
    loadInvoiceCounter(),
  ])
  const data = { employees, projects, clients, invoices, invoiceCounter }
  _snapCache = { data, at: Date.now() }
  return data
}

/** @deprecated — use loadSnapshot() */
export function loadSnapshotFromLocalStorage(): DataSnapshot {
  return { employees: [], projects: [], clients: [], invoices: [], invoiceCounter: 1 }
}

// ─── User Roles ───────────────────────────────────────────────────────────────

export type UserRoleRow = { user_id: string; email: string; role: string }

export async function loadUserRoles(): Promise<UserRoleRow[]> {
  const { data } = await supabase.from('user_roles').select('*').order('email')
  return (data || []) as UserRoleRow[]
}

export async function upsertUserRole(userId: string, email: string, role: string): Promise<void> {
  await supabase.from('user_roles').update({ role }).eq('user_id', userId)
}

// ─── Estimates ────────────────────────────────────────────────────────────────

export async function loadEstimates(): Promise<Estimate[]> {
  return fetchAll<Estimate>('estimates')
}
export async function saveEstimates(estimates: Estimate[]): Promise<void> {
  return syncAll('estimates', estimates)
}

// ─── Time Entries ─────────────────────────────────────────────────────────────

export async function loadTimeEntries(): Promise<TimeEntry[]> {
  return fetchAll<TimeEntry>('time_entries')
}
// One entry at a time — never a whole-table sync: approved YVA Time hours are written
// server-side (yva_time_approve), and a stale list must not delete them.
export async function upsertTimeEntry(entry: TimeEntry): Promise<void> {
  const row = toSnake(entry as unknown as Record<string, unknown>)
  delete row['created_at']
  for (const key of Object.keys(row)) if (row[key] === '') row[key] = null
  const { error } = await supabase.from('time_entries').upsert(row)
  if (error) throw new Error(`upsertTimeEntry failed: ${error.message}`)
}

export async function deleteTimeEntry(id: string): Promise<void> {
  const { error } = await supabase.from('time_entries').delete().eq('id', id).neq('source', 'tracker')
  if (error) throw new Error(`deleteTimeEntry failed: ${error.message}`)
}

// ─── Recurring Invoices ───────────────────────────────────────────────────────

export async function loadRecurringInvoices(): Promise<RecurringInvoice[]> {
  return fetchAll<RecurringInvoice>('recurring_invoices')
}
export async function saveRecurringInvoices(items: RecurringInvoice[]): Promise<void> {
  return syncAll('recurring_invoices', items)
}

// ─── Client Documents ─────────────────────────────────────────────────────────

export async function loadClientDocuments(clientId: string): Promise<ClientDocument[]> {
  const { data, error } = await supabase
    .from('client_documents')
    .select('*')
    .eq('client_id', clientId)
    .order('uploaded_at', { ascending: false })
  if (error) { console.error('loadClientDocuments', error); return [] }
  const docs = (data || []).map(r => {
    const doc = toCamel<ClientDocument>(r as Record<string, unknown>)
    // uploaded_at is timestamptz in DB — normalise to ms number
    if (typeof (doc as unknown as Record<string,unknown>).uploadedAt === 'string') {
      doc.uploadedAt = new Date((doc as unknown as Record<string,unknown>).uploadedAt as string).getTime()
    }
    return doc
  })
  return Promise.all(docs.map(async doc => {
    if (!doc.filePath) return doc
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrl(doc.filePath, 60 * 60)
    return signed?.signedUrl ? { ...doc, fileUrl: signed.signedUrl } : doc
  }))
}

export async function addClientDocument(doc: ClientDocument): Promise<void> {
  const row = toSnake(doc as unknown as Record<string, unknown>)
  delete row['created_at']
  // uploaded_at column is timestamptz — send as ISO string, not ms integer
  row['uploaded_at'] = new Date(doc.uploadedAt).toISOString()
  const { error } = await supabase.from('client_documents').insert(row)
  if (error) throw new Error(error.message)
}

export async function removeClientDocument(id: string): Promise<void> {
  const { error } = await supabase.from('client_documents').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Staff Requests ───────────────────────────────────────────────────────────

export async function loadStaffRequests(): Promise<StaffRequest[]> {
  const { data, error } = await supabase
    .from('staff_requests')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error('loadStaffRequests', error); return [] }
  return (data || []).map(row => toCamel<StaffRequest>(row as Record<string, unknown>))
}

export async function updateStaffRequestStatus(
  id: string,
  status: StaffRequest['status']
): Promise<void> {
  const { error } = await supabase
    .from('staff_requests')
    .update({ status })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function countPendingStaffRequests(): Promise<number> {
  const { count, error } = await supabase
    .from('staff_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) return 0
  return count ?? 0
}

export async function loadClientPortalBillingStatus(clientId: string): Promise<ClientPortalBillingStatus> {
  const { data, error } = await supabase
    .from('client_users')
    .select('auto_pay_enabled, default_payment_method_id, default_card_brand, default_card_last4, default_card_exp_month, default_card_exp_year, auto_pay_authorized_at, auto_pay_disabled_at')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error || !data) {
    return { hasPortalAccount: false, autoPayEnabled: false, hasSavedPaymentMethod: false }
  }

  const row = toCamel<Record<string, unknown>>(data as Record<string, unknown>)
  return {
    hasPortalAccount:       true,
    autoPayEnabled:        row.autoPayEnabled === true,
    hasSavedPaymentMethod: Boolean(row.defaultPaymentMethodId),
    defaultCardBrand:      row.defaultCardBrand as string | undefined,
    defaultCardLast4:      row.defaultCardLast4 as string | undefined,
    defaultCardExpMonth:   row.defaultCardExpMonth as number | undefined,
    defaultCardExpYear:    row.defaultCardExpYear as number | undefined,
    autoPayAuthorizedAt:   row.autoPayAuthorizedAt as string | undefined,
    autoPayDisabledAt:     row.autoPayDisabledAt as string | undefined,
  }
}

export async function loadClientPaymentAttempts(clientId: string, limit = 8): Promise<PaymentAttempt[]> {
  const { data, error } = await supabase
    .from('payment_attempts')
    .select('*')
    .eq('client_id', clientId)
    .order('attempted_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    if (error && error.code !== '42P01') console.error('loadClientPaymentAttempts', error)
    return []
  }

  return (data || []).map(row => toCamel<PaymentAttempt>(row as Record<string, unknown>))
}

export async function loadClientBillingSummary(clientId: string): Promise<ClientBillingSummary> {
  const [status, recentAttempts] = await Promise.all([
    loadClientPortalBillingStatus(clientId),
    loadClientPaymentAttempts(clientId),
  ])

  return {
    ...status,
    recentAttempts,
    lastAttempt: recentAttempts[0],
    lastSuccessfulAttempt: recentAttempts.find(a => a.status === 'succeeded'),
    lastFailedAttempt: recentAttempts.find(a => a.status === 'failed'),
  }
}
