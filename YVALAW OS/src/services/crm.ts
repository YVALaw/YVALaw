// CRM (PLAN.md Step 9): leads, lead activities / follow-ups, client contacts.
import { supabase } from '../lib/supabase'

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
