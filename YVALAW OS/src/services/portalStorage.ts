/**
 * portalStorage.ts
 * Client-scoped data fetching for the client portal.
 * All functions scope queries to the authenticated client's data only.
 * Internal OS storage functions are in storage.ts — do not use those in portal pages.
 */

import { supabase } from '../lib/supabase'
import type { Client, ClientDocument, Employee, Invoice, Project, TimeEntry, WorkingHourPrefs } from '../data/types'

// ── Snake-to-camel key conversion (mirrors storage.ts) ───────────────────────

function toCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    out[camel] = v
  }
  return out
}

function rowsToClients(rows: Record<string, unknown>[]): Client[] {
  return rows.map(r => {
    const c = toCamel(r) as unknown as Client
    if (!Array.isArray(c.tags))      c.tags      = []
    if (!Array.isArray(c.links))     c.links     = []
    if (!Array.isArray(c.contracts)) c.contracts = []
    return c
  })
}

function rowsToProjects(rows: Record<string, unknown>[]): Project[] {
  return rows.map(r => {
    const p = toCamel(r) as unknown as Project
    if (!Array.isArray(p.employeeIds)) p.employeeIds = []
    if (!Array.isArray(p.tags))        p.tags        = []
    if (!Array.isArray(p.links))       p.links       = []
    if (!Array.isArray(p.contracts))   p.contracts   = []
    return p
  })
}

function rowsToInvoices(rows: Record<string, unknown>[]): Invoice[] {
  return rows.map(r => {
    const inv = toCamel(r) as unknown as Invoice
    if (!Array.isArray(inv.items)) inv.items = []
    if (!Array.isArray(inv.tags))  inv.tags  = []
    return inv
  })
}

function rowsToEmployees(rows: Record<string, unknown>[]): Employee[] {
  return rows.map(r => toCamel(r) as unknown as Employee)
}

// ── Portal data loaders ───────────────────────────────────────────────────────

/** Load the client record for the authenticated portal user */
export async function loadPortalClient(clientId: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (error || !data) return null
  return rowsToClients([data as Record<string, unknown>])[0]
}

/** Load projects belonging to this client */
export async function loadPortalProjects(clientId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('client_id', clientId)

  if (error || !data) return []
  return rowsToProjects(data as Record<string, unknown>[])
}

/**
 * Load invoices for this client (matched by client name).
 * Scoped to sent/viewed/paid/overdue/partial status only — drafts are internal.
 */
export async function loadPortalInvoices(clientName: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('client_name', clientName)
    .not('status', 'eq', 'draft')
    .order('date', { ascending: false })

  if (error || !data) return []
  return rowsToInvoices(data as Record<string, unknown>[])
}

/**
 * Load employees assigned to any of the client's projects.
 * Deduplicates across multiple projects.
 */
export async function loadPortalEmployees(projects: Project[]): Promise<Employee[]> {
  const allIds = [...new Set(projects.flatMap(p => p.employeeIds ?? []))]
  if (allIds.length === 0) return []

  const { data, error } = await supabase
    .from('employees')
    .select('id, name, role, photo_url, email, timezone, status, employment_type, default_shift_start, default_shift_end, location')
    .in('id', allIds)

  if (error || !data) return []
  return rowsToEmployees(data as Record<string, unknown>[])
}

/**
 * Load time entries for the client's projects.
 * Scoped to project_id so clients only see entries for their own work.
 */
export async function loadPortalTimeEntries(projectIds: string[]): Promise<TimeEntry[]> {
  if (projectIds.length === 0) return []
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .in('project_id', projectIds)
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(r => toCamel(r) as unknown as TimeEntry)
}

/** Compute outstanding balance from a list of invoices */
export function computeOutstanding(invoices: Invoice[]): number {
  return invoices
    .filter(inv => {
      const s = (inv.status ?? '').toLowerCase()
      return s === 'sent' || s === 'viewed' || s === 'overdue' || s === 'partial'
    })
    .reduce((sum, inv) => sum + ((Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)), 0)
}

/** Compute total hours billed in a given month (YYYY-MM) from invoices */
export function computeMonthHours(invoices: Invoice[], yearMonth: string): number {
  return invoices
    .filter(inv => (inv.billingStart ?? inv.date ?? '').startsWith(yearMonth))
    .reduce((sum, inv) => {
      const itemHours = (inv.items ?? []).reduce((s, item) => s + (Number(item.hoursTotal) || 0), 0)
      return sum + itemHours
    }, 0)
}

/** Format USD amount */
export function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
}

/** Upload a document from the client portal */
export async function uploadPortalDocument(params: {
  clientId: string
  file: File
  category: ClientDocument['category']
  uploadedBy?: string
}): Promise<ClientDocument> {
  const ext  = params.file.name.split('.').pop() ?? 'bin'
  const path = `client-docs/${params.clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error: storageErr } = await supabase.storage
    .from('attachments')
    .upload(path, params.file, { upsert: false, contentType: params.file.type })
  if (storageErr) throw new Error(storageErr.message)

  const { data: urlData } = supabase.storage.from('attachments').getPublicUrl(path)

  const doc: ClientDocument = {
    id:         crypto.randomUUID(),
    clientId:   params.clientId,
    name:       params.file.name,
    category:   params.category,
    fileUrl:    urlData.publicUrl,
    filePath:   path,
    fileSize:   params.file.size,
    uploadedAt: Date.now(),
    uploadedBy: params.uploadedBy ?? 'Client',
  }

  const row = {
    id:          doc.id,
    client_id:   doc.clientId,
    name:        doc.name,
    category:    doc.category,
    file_url:    doc.fileUrl,
    file_path:   doc.filePath,
    file_size:   doc.fileSize,
    uploaded_at: new Date(doc.uploadedAt).toISOString(),  // timestamptz column
    uploaded_by: doc.uploadedBy,
  }
  const { error: dbErr } = await supabase.from('client_documents').insert(row)
  if (dbErr) throw new Error(dbErr.message)

  return doc
}

/** Load documents shared with this client */
export async function loadPortalDocuments(clientId: string): Promise<ClientDocument[]> {
  const { data, error } = await supabase
    .from('client_documents')
    .select('*')
    .eq('client_id', clientId)
    .order('uploaded_at', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(r => {
    const doc = toCamel(r) as unknown as ClientDocument
    // uploaded_at is timestamptz in DB — normalise to ms number
    if (typeof (doc as unknown as Record<string,unknown>).uploadedAt === 'string') {
      doc.uploadedAt = new Date((doc as unknown as Record<string,unknown>).uploadedAt as string).getTime()
    }
    return doc
  })
}

/** Load working hour preferences for this client */
export async function loadPortalWorkingHours(clientId: string): Promise<WorkingHourPrefs | null> {
  const { data, error } = await supabase
    .from('working_hour_prefs')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !data) return null
  return toCamel(data as Record<string, unknown>) as unknown as WorkingHourPrefs
}

/** Save (upsert) working hour preferences for this client */
export async function savePortalWorkingHours(prefs: WorkingHourPrefs): Promise<void> {
  const row = {
    id:              prefs.id,
    client_id:       prefs.clientId,
    monday_start:    prefs.mondayStart    ?? null,
    monday_end:      prefs.mondayEnd      ?? null,
    tuesday_start:   prefs.tuesdayStart   ?? null,
    tuesday_end:     prefs.tuesdayEnd     ?? null,
    wednesday_start: prefs.wednesdayStart ?? null,
    wednesday_end:   prefs.wednesdayEnd   ?? null,
    thursday_start:  prefs.thursdayStart  ?? null,
    thursday_end:    prefs.thursdayEnd    ?? null,
    friday_start:    prefs.fridayStart    ?? null,
    friday_end:      prefs.fridayEnd      ?? null,
    timezone:        prefs.timezone       ?? null,
    notes:           prefs.notes          ?? null,
    updated_at:      new Date().toISOString(),
  }
  const { error } = await supabase
    .from('working_hour_prefs')
    .upsert(row, { onConflict: 'client_id' })
  if (error) throw new Error(error.message)
}

/**
 * Mark an invoice as paid after a successful Stripe payment.
 * The webhook also updates this, but this call gives instant UI feedback.
 */
export async function markPortalInvoicePaid(invoiceId: string, amountPaid: number): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ status: 'paid', amount_paid: amountPaid })
    .eq('id', invoiceId)
  if (error) throw new Error(error.message)
}

/** Submit a staff request from the client portal */
export async function submitStaffRequest(params: {
  clientId: string
  clientName: string
  role: string
  hoursPerWeek?: number
  startDate?: string
  notes?: string
}): Promise<void> {
  const { error } = await supabase.from('staff_requests').insert({
    id:            crypto.randomUUID(),
    client_id:     params.clientId,
    client_name:   params.clientName,
    type:          'additional',
    role:          params.role || null,
    hours_per_week: params.hoursPerWeek || null,
    start_date:    params.startDate || null,
    notes:         params.notes || null,
    status:        'pending',
  })
  if (error) throw new Error(error.message)
}
