// Clients list quick actions (2026-11): Email (compose → company Outlook mailbox, To + Invoice CC rules), Call
// (tel: link; desktop also "Copy number"), New invoice (/invoice?create=invoice&client=<id>), Record payment (oldest
// open invoice) and Copy pay link (oldest open invoice; CEO/Admin/Accounting or invoices.send, only with Stripe on).
// Desktop list rows get a small icon group; every view (list, phone cards, pipeline cards) gets the same items at
// the top of its ⋯ menu. Pure picks live in utils/clientQuickActions.ts.
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Invoice } from '../../data/types'
import { usePermission, useRole } from '../../context/RoleContext'
import { canSeePage } from '../../lib/nav'
import { useToast } from '../../context/ToastContext'
import { Ic, P } from '../Icon'
import { Menu, useIsMobile, type MenuItem } from '../ui'
import EmailComposeModal from '../EmailComposeModal'
import RecordPaymentModal from '../RecordPaymentModal'
import { createPayLink } from '../../services/payments'
import { clientRecipients } from '../../services/emailRecipients'
import { logComm } from '../../services/storage'
import { logAction } from '../../services/activityLog'
import { oldestOpenInvoice, telHref } from '../../utils/clientQuickActions'

export function useClientQuickActions(invoices: Invoice[], onInvoicePaid: (id: string, s: { amountPaid: number; status: string }) => void) {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const toast = useToast()
  const { role } = useRole()
  const allowed = usePermission()
  const canInvoices = canSeePage('invoices', role, allowed)
  const canRecord = canInvoices && allowed('payments.record')
  const stripeOn = !!(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)
  const canPayLink = stripeOn && (role === 'ceo' || role === 'admin' || role === 'accounting' || allowed('invoices.send'))
  const [emailFor, setEmailFor] = useState<Client | null>(null)
  const [paying, setPaying] = useState<Invoice | null>(null)
  const [linking, setLinking] = useState<string | null>(null)

  const call = (c: Client) => { const href = telHref(c.phone); if (href) window.location.href = href }
  async function copyNumber(c: Client) {
    try { await navigator.clipboard.writeText((c.phone || '').trim()); toast.success(`${c.name}'s number copied.`) }
    catch { toast.error(`Could not copy — the number is ${c.phone}.`) }
  }
  const newInvoice = (c: Client) => navigate(`/invoice?create=invoice&client=${encodeURIComponent(c.id)}`)
  function recordPayment(c: Client) {
    const inv = oldestOpenInvoice(c, invoices)
    if (inv) setPaying(inv); else toast.info(`${c.name} has no open invoice.`)
  }
  async function copyPayLink(c: Client) {
    const inv = oldestOpenInvoice(c, invoices)
    if (!inv) { toast.info(`${c.name} has no open invoice to pay.`); return }
    setLinking(c.id)
    try {
      const { url } = await createPayLink(inv.id)
      try {
        await navigator.clipboard.writeText(url)
        toast.success(`Pay link for ${inv.number} copied — paste it to the client. It opens a secure Stripe page for the current balance (card or bank) and expires in 60 days.`)
      } catch { toast.info(`Pay link for ${inv.number}: ${url}`, { duration: 20000 }) }
    } catch (e) { toast.error(`Pay link not made: ${(e as Error).message}`) }
    finally { setLinking(null) }
  }

  /** The quick items for the top of a ⋯ menu (hidden items drop out; the separator only shows when something did) */
  function menuItems(c: Client): MenuItem[] {
    const open = oldestOpenInvoice(c, invoices)
    const tel = telHref(c.phone)
    const items: MenuItem[] = [
      { label: 'Email…', icon: P.mail, onClick: () => setEmailFor(c), hidden: !c.email },
      { label: `Call ${c.phone ?? ''}`.trim(), icon: P.call, onClick: () => call(c), hidden: !tel },
      { label: 'Copy number', icon: P.copy, onClick: () => void copyNumber(c), hidden: !tel || mobile },
      { label: 'New invoice', icon: P.invoices, onClick: () => newInvoice(c), hidden: !canInvoices },
      { label: open ? `Record payment · ${open.number}` : 'Record payment', icon: P.cash, onClick: () => recordPayment(c), hidden: !canRecord || !open },
      { label: linking === c.id ? 'Making pay link…' : `Copy pay link · ${open?.number ?? ''}`, icon: P.link, onClick: () => void copyPayLink(c), hidden: !canPayLink || !open, disabled: linking === c.id },
    ]
    return items.some(i => i !== 'sep' && !i.hidden) ? [...items, 'sep'] : []
  }

  /** Desktop list rows: Email · Call · New invoice as small icon buttons (greyed when there's no email / phone) */
  function inline(c: Client): ReactNode {
    const tel = telHref(c.phone)
    return (
      <span className="crm-quick" onClick={e => e.stopPropagation()}>
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label={`Write to ${c.name}`} title={c.email ? `Email ${c.email}` : 'No email on file'} disabled={!c.email} onClick={() => setEmailFor(c)}><Ic d={P.mail} size={15} /></button>
        {tel
          ? <Menu label={`Call ${c.name}`} buttonClass="btn btn--icon btn--ghost btn--sm" trigger={<><Ic d={P.call} size={15} /><span className="sr-only">Call {c.name}</span></>}
              items={[{ label: `Call ${c.phone}`, icon: P.call, onClick: () => call(c) }, { label: 'Copy number', icon: P.copy, onClick: () => void copyNumber(c) }]} />
          : <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label={`Call ${c.name}`} title="No phone on file" disabled><Ic d={P.call} size={15} /></button>}
        {canInvoices && <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label={`New invoice for ${c.name}`} title="New invoice" onClick={() => newInvoice(c)}><Ic d={P.invoices} size={15} /></button>}
      </span>
    )
  }

  const overlays = <>
    <ClientEmailModal client={emailFor} onClose={() => setEmailFor(null)} />
    {paying && <RecordPaymentModal invoice={{ ...paying, subtotal: Number(paying.subtotal) || 0 }} onClose={() => setPaying(null)} onChanged={s => onInvoicePaid(paying.id, s)} />}
  </>
  return { menuItems, inline, overlays }
}

/** Write an email to a client from the company mailbox. To = the client's email, Cc = Invoice CC + billing contacts. */
export function ClientEmailModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  // Looked up once per client (the composer reads it when it opens)
  const recipients = useMemo(() => (client ? clientRecipients(client) : []), [client])
  return (
    <EmailComposeModal open={!!client} onClose={onClose} title={`Email ${client?.name ?? ''}`}
      sub="Sent from the company mailbox. A copy is kept in its Sent Items and on the client's Communications."
      to={client?.email || ''} cc={recipients} greetName={client?.name ?? ''}
      ccHint="The client's Invoice CC and billing contacts. Separate addresses with commas."
      onSent={({ to, cc, subject, mode, who }) => {
        if (!client) return
        const viaApp = mode === 'mailto'
        void logComm(client.id, `${viaApp ? 'Email opened in the mail app' : 'Email sent'}: "${subject}" — to ${who}`, 'email')
        void logAction('client_emailed', `Emailed ${client.name}: "${subject}" to ${who}${viaApp ? ' (opened in the email app)' : ''}`,
          { table: 'clients', recordId: client.id, details: { to, cc, subject, via: mode } })
      }} />
  )
}
