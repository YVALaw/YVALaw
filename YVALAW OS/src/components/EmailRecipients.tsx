// "To … · Cc …" shown wherever a client email is about to go out (builder, Quick invoice, invoice preview,
// client reminder). Uses only design-system classes, so any hub can show it.
import { useEffect, useState } from 'react'
import type { Client, Invoice } from '../data/types'
import { clientRecipients, invoiceRecipients, type Recipients } from '../services/emailRecipients'

/** Recipients for a client (null while loading / no client) */
export function useClientRecipients(client: Client | undefined | null, version = 0): Recipients | null {
  const [r, setR] = useState<Recipients | null>(null)
  const key = client ? `${client.id}|${client.email ?? ''}|${(client.ccEmails ?? []).join(',')}|${version}` : ''
  useEffect(() => {
    let live = true
    setR(null)
    if (client) void clientRecipients(client).then(x => { if (live) setR(x) })
    return () => { live = false }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return r
}

/** Recipients for an existing invoice (its saved Cc, else the client's current list) */
export function useInvoiceRecipients(inv: Invoice | undefined | null, clients?: Client[]): Recipients | null {
  const [r, setR] = useState<Recipients | null>(null)
  useEffect(() => {
    let live = true
    setR(null)
    if (inv) void invoiceRecipients(inv, clients).then(x => { if (live) setR(x) })
    return () => { live = false }
  }, [inv?.id, inv?.clientEmail, (inv?.clientCcEmails ?? []).join(','), clients])   // eslint-disable-line react-hooks/exhaustive-deps
  return r
}

/** One muted line: "Emails go to ap@firm.com · Cc accounting@firm.com, owner@firm.com" */
export function RecipientsHint({ recipients, prefix = 'Emails go to', className, bare }: { recipients: Recipients | null; prefix?: string; className?: string; bare?: boolean }) {
  if (!recipients) return null
  const text = <>
    {recipients.to ? <>{prefix} <strong>{recipients.to}</strong></> : 'No email on file'}
    {recipients.to && recipients.cc.length > 0 && <> · Cc {recipients.cc.join(', ')}</>}
  </>
  // bare: inside a Field hint (Field already wraps it in .field__hint)
  if (bare) return <span data-recipients="">{text}</span>
  return <span className={`field__hint${className ? ` ${className}` : ''}`} data-recipients="">{text}</span>
}
