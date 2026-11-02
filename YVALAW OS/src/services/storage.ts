import { supabase } from '../lib/supabase'
import { cachedRead, clearReadCache, LIST_MS } from '../lib/readCache'
import { fetchAllPages } from '../lib/pages'
import type {
  ActivityLogEntry, AppSettings, Candidate, CommEntryType, DataSnapshot,
  Employee, Client, Expense, Invoice, InvoiceTemplate, Project, Task,
  Estimate, TimeEntry, RecurringInvoice, StaffRequest, ClientDocument,
  PaymentAttempt,
} from '../data/types'
import { setCompanyBranding } from '../utils/invoiceHtml'
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
  return cachedRead(`all:${table}`, () => fetchAllNow<T>(table))
}
async function fetchAllNow<T>(table: string): Promise<T[]> {
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
  const keepCc = await ccColumnReady('employees', employees.some(e => e.ccEmails?.length))
  const rows = employees.map(e => { const row = { ...e }; delete row.userId; if (!keepCc) delete row.ccEmails; return row })
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
  const keepCc = await ccColumnReady('clients', clients.some(c => c.ccEmails?.length))
  const rows = keepCc ? clients : clients.map(c => { const row = { ...c }; delete row.ccEmails; return row })
  invalidateSnapshotCache(); return syncAll('clients', rows)
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
  return cachedRead('all:invoices', loadInvoicesNow)
}
async function loadInvoicesNow(): Promise<Invoice[]> {
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
  const keepCc = await ccColumnReady('invoices', invoices.some(i => i.clientCcEmails?.length))
  const rows = keepCc ? invoices : invoices.map(i => { const row = { ...i }; delete row.clientCcEmails; return row })
  invalidateSnapshotCache(); return syncAll('invoices', rows)
}

// ─── CC email columns (supabase/migrate-cc-emails.sql) ────────────────────────

const CC_COLUMN = { clients: 'cc_emails', employees: 'cc_emails', invoices: 'client_cc_emails' } as const
const columnChecks = new Map<string, Promise<boolean>>()
/** Does the database have this CC column yet? false only when it answers "no such column" (SQL not run);
 *  a network error counts as yes, so the save goes ahead and reports its own error. Asked once per session. */
export function ccColumnExists(table: keyof typeof CC_COLUMN): Promise<boolean> {
  const column = CC_COLUMN[table]
  let check = columnChecks.get(table)
  if (!check) {
    check = Promise.resolve(supabase.from(table).select(column).limit(1)).then(
      ({ error }) => !(error && (error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find .* column/i.test(error.message))),
      () => true,
    )
    columnChecks.set(table, check)
    void check.then(ok => { if (ok) return; columnChecks.delete(table) })   // asked again next time (the SQL may have just run)
  }
  return check
}
/** Rows only carry a CC list when it's non-empty; if one does and the column is missing, the list is left out of
 *  the save (the form already says the SQL is needed) instead of the whole save failing. */
async function ccColumnReady(table: keyof typeof CC_COLUMN, anyCc: boolean): Promise<boolean> {
  return anyCc ? ccColumnExists(table) : true
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

/** The live invoice counter — always read from the database (used when a new invoice number is taken) */
export async function loadInvoiceCounter(): Promise<number> {
  const { data } = await supabase.from('counters').select('value').eq('key', 'invoice').single()
  return (data as { value: number } | null)?.value ?? 1
}
/** The counter for display in the snapshot only (kept a minute, so pages don't wait on it) */
const loadInvoiceCounterForDisplay = () => cachedRead('counter:invoice:display', loadInvoiceCounter, LIST_MS)
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

/** True once a loaded settings row had the columns from migrate-redesign-settings.sql */
let hasBrandingColumns = false

/** False until migrate-redesign-settings.sql has run (logo, website, invoice footer and Crisp can't be saved yet) */
export const settingsHaveBrandingColumns = () => hasBrandingColumns

const DEFAULT_SETTINGS: AppSettings = {
  usdToDop: 0,
  companyName: 'YVA Staffing',
  companyEmail: '',
  emailSignature: '',
}

export async function loadSettings(): Promise<AppSettings> {
  return cachedRead('settings', loadSettingsNow).then(s => ({ ...s }))
}
async function loadSettingsNow(): Promise<AppSettings> {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
  if (error || !data) return DEFAULT_SETTINGS
  const row = data as Record<string, unknown>
  // Before migrate-redesign-settings.sql runs these columns don't exist; saving them would fail the whole update
  hasBrandingColumns = 'company_website' in row
  const settings: AppSettings = {
    usdToDop:               (row.usd_to_dop as number) ?? 0,
    companyName:            (row.company_name as string) ?? 'YVA Staffing',
    companyEmail:           (row.company_email as string) ?? '',
    companyAddress:         (row.company_address as string | undefined),
    companyPhone:           (row.company_phone as string | undefined),
    companyWebsite:         (row.company_website as string | null) ?? undefined,
    invoiceFooter:          (row.invoice_footer as string | null) ?? undefined,
    companyLogoUrl:         (row.company_logo_url as string | null) ?? undefined,
    companyLogoPath:        (row.company_logo_path as string | null) ?? undefined,
    crispWebsiteId:         (row.crisp_website_id as string | null) ?? undefined,
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
  // Printed invoices / statements pick up the logo, website and footer without every caller passing them
  setCompanyBranding({ logoUrl: settings.companyLogoUrl, website: settings.companyWebsite, invoiceFooter: settings.invoiceFooter })
  return settings
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const { error } = await supabase.from('settings').update({
    usd_to_dop:               s.usdToDop,
    company_name:             s.companyName,
    company_email:            s.companyEmail,
    company_address:          s.companyAddress,
    company_phone:            s.companyPhone,
    ...(hasBrandingColumns ? {
      company_website:        s.companyWebsite || null,
      invoice_footer:         s.invoiceFooter || null,
      company_logo_url:       s.companyLogoUrl || null,
      company_logo_path:      s.companyLogoPath || null,
      crisp_website_id:       s.crispWebsiteId || null,
    } : {}),
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
// The lists themselves are shared and kept a minute by lib/readCache.ts (cleared by any write). The old
// separate 2-minute snapshot copy is gone: it was only cleared by some saves, so payments or server
// actions could leave it stale.

export function invalidateSnapshotCache() { clearReadCache() }

/** Main lists read in the background after sign-in and on each keep-warm pass, so pages open from memory even before
 *  they were first visited (lib/readCache.ts). A failure here is ignored — the page loads it again. */
export async function warmUpLists(): Promise<void> {
  await Promise.allSettled([loadSnapshot(), loadSettings(), loadCandidates(), loadEstimates(), loadActivityLog(), loadStaffRequests(), import('./tagStorage').then(m => m.loadTags())])
}

// ─── Snapshot (loads all core data in parallel) ───────────────────────────────

export async function loadSnapshot(): Promise<DataSnapshot> {
  const [employees, projects, clients, invoices, invoiceCounter] = await Promise.all([
    loadEmployees(),
    loadProjects(),
    loadClients(),
    loadInvoices(),
    loadInvoiceCounterForDisplay(),
  ])
  return { employees, projects, clients, invoices, invoiceCounter }
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
  return cachedRead('staff_requests', loadStaffRequestsNow)
}
async function loadStaffRequestsNow(): Promise<StaffRequest[]> {
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
