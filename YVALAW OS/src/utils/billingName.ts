/** The name an invoice is made out to: the client's "Company / legal name", else the client's name.
 *  Clients often have a contact person as their name ("Sean Mahbobian-Fard") and the firm as the company
 *  ("Top Law Assist"). Same rule as the weekly close (netlify/functions/_lib/weekclose.cjs billingName). */
export function billingName(client?: { name?: string | null; company?: string | null } | null): string {
  return String(client?.company || '').trim() || String(client?.name || '').trim()
}

/** The client an invoice belongs to: by client id first, else by the name on the invoice (the client's name or company) */
export function clientOfInvoice<C extends { id: string; name: string; company?: string | null }>(
  clients: C[], inv: { clientId?: string | null; clientName?: string | null },
): C | undefined {
  return (inv.clientId ? clients.find(c => c.id === inv.clientId) : undefined)
    ?? clients.find(c => c.name === inv.clientName)
    ?? (inv.clientName ? clients.find(c => !!c.company && c.company.trim() === inv.clientName) : undefined)
}
