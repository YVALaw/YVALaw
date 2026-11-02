// CRM (PLAN.md Step 9): leads, lead activities / follow-ups, client contacts.
import { supabase } from '../lib/supabase'
import { loadSettings, loadInvoiceCounter, saveInvoiceCounter, logComm, invalidateSnapshotCache } from './storage'
import { sendEmail, type SendEmailResult } from './email'
import { clientRecipients } from './emailRecipients'
import { invoicePdf } from './invoiceEmail'
import { logAction } from './activityLog'
import { recipientsLabel } from '../utils/emailList'
import type { Client as Cli, Estimate, Invoice as Inv, Project } from '../data/types'
import { itemLinesFromEstimate, itemLinesSubtotal } from '../utils/invoiceLines'

export type LeadStage = 'new' | 'contacted' | 'meeting' | 'proposal' | 'won' | 'lost'
export const STAGES: { key: LeadStage; label: string }[] = [
  { key: 'new', label: 'New' }, { key: 'contacted', label: 'Contacted' }, { key: 'meeting', label: 'Meeting' },
  { key: 'proposal', label: 'Proposal' }, { key: 'won', label: 'Won' }, { key: 'lost', label: 'Lost' },
]
export type Lead = { id: string; name: string; email: string | null; phone: string | null; company: string | null; website: string | null; service: string | null; message: string | null
  source: string | null; utm: Record<string, string>; sms_consent: boolean; calendly_booked: boolean; stage: LeadStage; owner_id: string | null; value_monthly: number | null
  next_follow_up: string | null; lost_reason: string | null; client_id: string | null; project_id: string | null; created_at: string; updated_at: string }
export type LeadActivity = { id: string; lead_id: string; kind: 'note' | 'call' | 'email' | 'meeting' | 'whatsapp' | 'follow_up' | 'system'; body: string; due_on: string | null; done_at: string | null; created_by: string | null; created_at: string }
export type Contact = { id: string; client_id: string; name: string; role: string | null; email: string | null; phone: string | null; whatsapp: string | null; is_billing: boolean; notes: string | null }

const missing = (e: { code?: string; message: string } | null) => (e ? (e.code === '42P01' ? 'Run supabase/migrate-step9-crm.sql to turn on the CRM.' : e.message) : null)

export async function loadLeads(): Promise<{ rows: Lead[]; error: string | null }> {
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(1000)
  return { rows: (data || []) as Lead[], error: missing(error) }
}
export async function saveLead(l: Partial<Lead> & { name: string }): Promise<Lead> {
  const row = { name: l.name.trim(), email: l.email?.trim() || null, phone: l.phone?.trim() || null, company: l.company?.trim() || null, website: l.website?.trim() || null,
    service: l.service || null, message: l.message || null, source: l.source || null, stage: l.stage || 'new', owner_id: l.owner_id || null,
    value_monthly: l.value_monthly == null || (l.value_monthly as unknown) === '' ? null : Number(l.value_monthly), next_follow_up: l.next_follow_up || null, lost_reason: l.lost_reason || null }
  const q = l.id ? supabase.from('leads').update(row).eq('id', l.id).select().single() : supabase.from('leads').insert(row).select().single()
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data as Lead
}
export async function updateLead(id: string, patch: Partial<Lead>): Promise<void> {
  const { error } = await supabase.from('leads').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}
export async function deleteLead(id: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
export async function loadActivities(leadId: string): Promise<LeadActivity[]> {
  const { data } = await supabase.from('lead_activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false })
  return (data || []) as LeadActivity[]
}
export async function addActivity(a: { leadId: string; kind: LeadActivity['kind']; body: string; dueOn?: string | null }): Promise<void> {
  const { error } = await supabase.from('lead_activities').insert({ lead_id: a.leadId, kind: a.kind, body: a.body.trim(), due_on: a.kind === 'follow_up' ? a.dueOn || null : null })
  if (error) throw new Error(error.message)
}
export async function completeActivity(id: string): Promise<void> {
  const { error } = await supabase.from('lead_activities').update({ done_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}
/** Won: create the client (+ first contact) and a project, link them to the lead */
export async function convertLead(lead: Lead, p: { clientName: string; projectName: string; rate: number | null; paymentTerms: string }): Promise<{ clientId: string; projectId: string }> {
  const clientId = crypto.randomUUID(), projectId = crypto.randomUUID()
  const c = await supabase.from('clients').insert({ id: clientId, name: p.clientName.trim(), email: lead.email, phone: lead.phone, status: 'active', payment_terms: p.paymentTerms || null,
    notes: [lead.service && `Service: ${lead.service}`, lead.source && `Lead source: ${lead.source}`, lead.message].filter(Boolean).join('\n') || null })
  if (c.error) throw new Error(`Client: ${c.error.message}`)
  const pr = await supabase.from('projects').insert({ id: projectId, name: p.projectName.trim(), client_id: clientId, rate: p.rate, status: 'active', employee_ids: [] })
  if (pr.error) {
    await supabase.from('clients').delete().eq('id', clientId)          // don't leave a client behind; a retry starts clean
    throw new Error(`Project: ${pr.error.message}`)
  }
  // From here the client + project exist: record them on the lead first, so a retry can't duplicate them
  await updateLead(lead.id, { stage: 'won', client_id: clientId, project_id: projectId })
  const ct = await supabase.from('contacts').insert({ client_id: clientId, name: lead.name, email: lead.email, phone: lead.phone, whatsapp: lead.phone, role: 'Main contact', is_billing: true })
  if (ct.error) throw new Error(`Client and project were created, but the contact could not be saved: ${ct.error.message}`)
  await addActivity({ leadId: lead.id, kind: 'system', body: `Won — client "${p.clientName}" and project "${p.projectName}" created` })
  return { clientId, projectId }
}

/** Add older leads in one go (skips people already in the list; no notifications). Returns how many were added. */
export async function importLeads(rows: import('../utils/csv').ImportedLead[]): Promise<number> {
  const { data, error } = await supabase.rpc('import_leads', { p_rows: rows })
  if (error) throw new Error(error.code === 'PGRST202' ? 'Run supabase/migrate-step9-crm.sql again to turn on importing.' : error.message)
  return Number(data) || 0
}

export async function loadContacts(clientId: string): Promise<{ rows: Contact[]; error: string | null }> {
  const { data, error } = await supabase.from('contacts').select('*').eq('client_id', clientId).order('created_at')
  return { rows: (data || []) as Contact[], error: missing(error) }
}
export async function saveContact(c: Partial<Contact> & { client_id: string; name: string }): Promise<void> {
  const row = { client_id: c.client_id, name: c.name.trim(), role: c.role || null, email: c.email || null, phone: c.phone || null, whatsapp: c.whatsapp || null, is_billing: !!c.is_billing, notes: c.notes || null }
  const { error } = c.id ? await supabase.from('contacts').update(row).eq('id', c.id) : await supabase.from('contacts').insert(row)
  if (error) throw new Error(error.message)
}
export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
export async function loadStaff(): Promise<{ user_id: string; email: string; role: string }[]> {
  const { data } = await supabase.from('user_roles').select('user_id,email,role').in('role', ['ceo', 'admin', 'accounting', 'recruiter', 'lead_gen'])
  return (data || []) as { user_id: string; email: string; role: string }[]
}

// ─── Clients hub helpers (redesign 2026-11) ───────────────────────────────────

/** Portal billing status shown in the Clients table: AutoPay on / Card saved / AutoPay off / No portal */
export type PortalStatus = 'autopay' | 'card' | 'off' | 'none'
export type PortalInfo = { status: PortalStatus; lastLoginAt: string | null }
export const PORTAL_LABEL: Record<PortalStatus, string> = { autopay: 'AutoPay on', card: 'Card saved', off: 'AutoPay off', none: 'No portal' }

/** One query for every client's portal login (client_users_internal_read). null = could not be read (shown as "—"). */
export async function loadPortalStatuses(): Promise<Map<string, PortalInfo> | null> {
  const { data, error } = await supabase.from('client_users').select('client_id,auto_pay_enabled,default_payment_method_id,last_login_at')
  if (error) return null
  const out = new Map<string, PortalInfo>()
  for (const r of (data || []) as { client_id: string; auto_pay_enabled: boolean | null; default_payment_method_id: string | null; last_login_at: string | null }[]) {
    const prev = out.get(r.client_id)
    const status: PortalStatus = r.auto_pay_enabled ? 'autopay' : r.default_payment_method_id ? 'card' : 'off'
    const rank = { autopay: 3, card: 2, off: 1, none: 0 }
    const last = [prev?.lastLoginAt, r.last_login_at].filter(Boolean).sort().pop() ?? null
    out.set(r.client_id, { status: !prev || rank[status] > rank[prev.status] ? status : prev.status, lastLoginAt: last })
  }
  return out
}

const UNPAID = new Set(['sent', 'viewed', 'overdue', 'partial'])
/** Invoices of a client: by client_id (weekly close) or by name (older invoices) — same rule as clientHealth */
export const invoicesOf = (c: Cli, invoices: Inv[]) => invoices.filter(i => (i.clientId && i.clientId === c.id) || i.clientName === c.name)
export const isUnpaid = (i: Inv) => UNPAID.has((i.status || '').toLowerCase())
export const balanceOf = (i: Inv) => (Number(i.subtotal) || 0) - (Number(i.amountPaid) || 0)
export const revenueOf = (c: Cli, invoices: Inv[]) => invoicesOf(c, invoices).reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
export const outstandingOf = (c: Cli, invoices: Inv[]) => invoicesOf(c, invoices).filter(isUnpaid).reduce((s, i) => s + balanceOf(i), 0)

const MAX_REMINDER_PDFS = 10
/** Payment reminder for every unpaid invoice of a client (Settings → Email reminder template), Cc their Invoice CC +
 *  billing contacts, each unpaid invoice attached as a PDF (up to 10). null = nothing unpaid. */
export async function sendClientReminder(c: Cli, invoices: Inv[]): Promise<{ result: SendEmailResult; count: number; total: number; to: string; cc: string[] } | null> {
  const settings = await loadSettings()
  const unpaidInvs = invoicesOf(c, invoices).filter(isUnpaid)
  if (unpaidInvs.length === 0) return null
  const totalOwed = unpaidInvs.reduce((s, inv) => s + balanceOf(inv), 0)
  const companyName = settings.companyName || 'YVA Staffing'
  const invoiceList = unpaidInvs.map(inv => `  • ${inv.number} — $${(Number(inv.subtotal) || 0).toFixed(2)}`).join('\n')
  const bodyText = settings.reminderEmailTemplate
    ? settings.reminderEmailTemplate
        .replace(/\{clientName\}/g, c.name)
        .replace(/\{invoiceNumber\}/g, unpaidInvs.length === 1 ? unpaidInvs[0].number : `${unpaidInvs.length} invoices`)
        .replace(/\{amount\}/g, `$${totalOwed.toFixed(2)}`)
        .replace(/\{dueDate\}/g, unpaidInvs[0]?.dueDate || '')
        .replace(/\{companyName\}/g, companyName)
    : `Hi ${c.name},\n\nThis is a friendly reminder that you have ${unpaidInvs.length === 1 ? 'an outstanding invoice' : `${unpaidInvs.length} outstanding invoices`} totaling $${totalOwed.toFixed(2)}:\n\n${invoiceList}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n${settings.emailSignature || companyName}`
  const { to, cc } = await clientRecipients(c)
  const attachments = []
  try {
    for (const inv of unpaidInvs.slice(0, MAX_REMINDER_PDFS)) attachments.push(await invoicePdf(inv, settings))   // one at a time: each draws in its own frame
  } catch (e) {
    return { result: { mode: 'failed', attached: false, fallbackReason: `The invoice PDFs could not be made (${(e as Error).message}). Nothing was sent.` }, count: unpaidInvs.length, total: totalOwed, to, cc }
  }
  const result = await sendEmail(to, `Outstanding Balance Reminder — ${companyName}`, bodyText, { attachments, cc })
  if (result.mode !== 'failed' && to) {
    void logAction('invoice_reminder', `Sent a balance reminder ($${totalOwed.toFixed(2)}, ${unpaidInvs.length} invoice${unpaidInvs.length === 1 ? '' : 's'}) to ${recipientsLabel(to, cc)}${result.mode === 'mailto' ? ' (opened in the email app)' : ''}`,
      { table: 'clients', recordId: c.id, details: { to, cc, via: result.mode, invoices: unpaidInvs.map(i => i.number) } })
  }
  return { result, count: unpaidInvs.length, total: totalOwed, to, cc }
}

/** Accepted estimate → a draft invoice for Finance to review and send. The estimate's lines become real
 *  invoice item lines (description × qty × price — never hours or payroll, see utils/invoiceLines.ts) and the
 *  subtotal is their sum. Numbered like Quick Invoice (INV-NNN from the shared counter). */
export async function createInvoiceFromEstimate(est: Estimate, client?: Cli, project?: Project): Promise<{ id: string; number: string }> {
  const counter = await loadInvoiceCounter()
  const id = crypto.randomUUID(), number = `INV-${String(counter).padStart(3, '0')}`
  const items = itemLinesFromEstimate(est.items)
  const subtotal = items.length ? itemLinesSubtotal(items) : Number(est.total) || 0
  const notes = [`From estimate ${est.number}`, est.notes].filter(Boolean).join('\n')
  const today = new Date(); const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const { error } = await supabase.from('invoices').insert({
    id, number, date, client_name: client?.name ?? est.clientName ?? null, client_email: client?.email ?? null, client_address: client?.address ?? null,
    client_id: client?.id ?? est.clientId ?? null, project_id: project?.id ?? est.projectId ?? null, project_name: project?.name ?? est.projectName ?? null,
    subtotal, notes, status: 'draft', items, status_history: [{ status: 'draft', changedAt: Date.now() }],
  })
  if (error) throw new Error(error.message)
  invalidateSnapshotCache()
  await saveInvoiceCounter(counter + 1).catch(() => {})
  if (client?.id) await logComm(client.id, `Draft invoice ${number} created from estimate ${est.number} ($${subtotal.toFixed(2)})`, 'system')
  return { id, number }
}
