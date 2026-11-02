// Who a client email goes To and Cc: the client's email, plus the client's "Invoice CC" addresses and every
// contact marked "Gets invoices" (Client → Contacts). The main address is never repeated in Cc.
// An existing invoice uses the Cc list saved on it (clientCcEmails); older invoices without one use the client's
// current list.
import { supabase } from '../lib/supabase'
import type { Client, Invoice } from '../data/types'
import { loadClients } from './storage'
import { mergeCc, normalizeEmailList } from '../utils/emailList'

export type Recipients = { to: string; cc: string[] }

/** Emails of each client's billing contacts (contacts.is_billing). Missing table (Step 9 SQL not run) → none. */
export async function billingContactEmails(clientIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const ids = [...new Set(clientIds.filter(Boolean))]
  if (ids.length === 0) return out
  try {
    const { data, error } = await supabase.from('contacts').select('client_id,email').eq('is_billing', true).in('client_id', ids)
    if (error) return out
    for (const r of (data || []) as { client_id: string; email: string | null }[]) {
      if (!r.email) continue
      out.set(r.client_id, [...(out.get(r.client_id) ?? []), r.email])
    }
  } catch { /* no contacts: Cc from the client's own list only */ }
  return out
}

/** To + Cc for an email to a client (reminders, a new invoice in the builder) */
export async function clientRecipients(client: Client | undefined | null, to = client?.email ?? ''): Promise<Recipients> {
  const main = (to || '').trim()
  if (!client) return { to: main, cc: [] }
  const billing = (await billingContactEmails([client.id])).get(client.id) ?? []
  return { to: main, cc: mergeCc(main, normalizeEmailList(client.ccEmails), billing) }
}

/** The client an invoice belongs to: by client_id (weekly close), else by name (older invoices) */
export function clientOfInvoice(inv: Invoice, clients: Client[]): Client | undefined {
  return (inv.clientId ? clients.find(c => c.id === inv.clientId) : undefined) ?? clients.find(c => c.name === inv.clientName)
}

/** To + Cc for an existing invoice: the Cc saved on it, else the client's current Invoice CC + billing contacts */
export async function invoiceRecipients(inv: Invoice, clients?: Client[]): Promise<Recipients> {
  const to = (inv.clientEmail || '').trim()
  const saved = normalizeEmailList(inv.clientCcEmails)
  if (saved.length) return { to, cc: mergeCc(to, saved) }
  const list = clients ?? await loadClients()
  return clientRecipients(clientOfInvoice(inv, list), to)
}
