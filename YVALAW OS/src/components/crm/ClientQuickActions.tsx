// Clients list quick actions (2026-11): Email (compose → company Outlook mailbox, To + Invoice CC rules), Call
// (tel: link; desktop also "Copy number"), New invoice (/invoice?create=invoice&client=<id>), Record payment (oldest
// open invoice) and Copy pay link (oldest open invoice; CEO/Admin/Accounting or invoices.send, only with Stripe on).
// Desktop list rows get a small icon group; every view (list, phone cards, pipeline cards) gets the same items at
// the top of its ⋯ menu. Pure picks live in utils/clientQuickActions.ts.
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Client, Invoice } from '../../data/types'
import { usePermission, useRole } from '../../context/RoleContext'
import { canSeePage } from '../../lib/nav'
import { useToast } from '../../context/ToastContext'
import { Ic, P } from '../Icon'
import { Banner, Field, Menu, Modal, useIsMobile, type MenuItem } from '../ui'
import RecordPaymentModal from '../RecordPaymentModal'
import { createPayLink } from '../../services/payments'
import { sendEmail } from '../../services/email'
import { clientRecipients } from '../../services/emailRecipients'
import { loadSettings, logComm } from '../../services/storage'
import { logAction } from '../../services/activityLog'
import { formatEmailList, isEmail, parseEmailList, recipientsLabel } from '../../utils/emailList'
import { oldestOpenInvoice, telHref } from '../../utils/clientQuickActions'

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

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
  const toast = useToast()
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!client) return
    let alive = true
    setTo(client.email || ''); setCc(''); setSubject(''); setError(null); setSending(false)
    setBody(`Hi ${firstName(client.name)},\n\n\n`)
    void clientRecipients(client).then(r => { if (alive) { setTo(r.to); setCc(formatEmailList(r.cc)) } }).catch(() => {})
    void loadSettings().then(s => { if (alive) setBody(b => (b === `Hi ${firstName(client.name)},\n\n\n` ? `${b}${s.emailSignature || s.companyName || 'YVA Staffing'}` : b)) }).catch(() => {})
    return () => { alive = false }
  }, [client])

  async function send() {
    if (!client || sending) return
    const toAddr = to.trim()
    const ccList = parseEmailList(cc)
    if (!isEmail(toAddr)) { setError('Enter a valid email address in To.'); return }
    if (ccList.invalid.length) { setError(`Not email addresses: ${ccList.invalid.join(', ')}`); return }
    if (!subject.trim()) { setError('Add a subject.'); return }
    if (!body.trim()) { setError('Write a message.'); return }
    setSending(true); setError(null)
    try {
      const r = await sendEmail(toAddr, subject.trim(), body, { cc: ccList.emails })
      if (r.mode === 'failed') { toast.error(`Email not sent: ${r.fallbackReason ?? 'the company mailbox could not send it.'}`); setSending(false); return }
      const who = recipientsLabel(toAddr, ccList.emails.filter(e => e.toLowerCase() !== toAddr.toLowerCase()))
      const viaApp = r.mode === 'mailto'
      void logComm(client.id, `${viaApp ? 'Email opened in the mail app' : 'Email sent'}: "${subject.trim()}" — to ${who}`, 'email')
      void logAction('client_emailed', `Emailed ${client.name}: "${subject.trim()}" to ${who}${viaApp ? ' (opened in the email app)' : ''}`,
        { table: 'clients', recordId: client.id, details: { to: toAddr, cc: ccList.emails, subject: subject.trim(), via: r.mode } })
      toast.success(viaApp ? 'Email opened in your email app.' : `Email sent to ${who}.`)
      onClose()
    } catch (e) { setError((e as Error).message); setSending(false) }
  }

  return (
    <Modal open={!!client} onClose={onClose} title={`Email ${client?.name ?? ''}`} sub="Sent from the company mailbox. A copy is kept in its Sent Items and on the client's Communications."
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" disabled={sending} onClick={() => void send()}><Ic d={P.send} size={15} />{sending ? 'Sending…' : 'Send email'}</button>
      </>}>
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      <div className="stack crm-compose">
        <Field label="To"><input className="input" aria-label="To" type="email" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="Cc" hint="The client's Invoice CC and billing contacts. Separate addresses with commas."><input className="input" aria-label="Cc" value={cc} onChange={e => setCc(e.target.value)} placeholder="None" /></Field>
        <Field label="Subject"><input className="input" aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} autoFocus maxLength={300} /></Field>
        <Field label="Message"><textarea className="textarea crm-compose__body" aria-label="Message" value={body} onChange={e => setBody(e.target.value)} rows={9} /></Field>
      </div>
    </Modal>
  )
}

