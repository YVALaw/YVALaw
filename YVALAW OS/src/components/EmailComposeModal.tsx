// One compose window for every "write an email" button (clients, candidates…). It sends through the company
// Outlook mailbox with sendEmail() (send-email function: staff only, limits, email_log) — the same path as invoice
// emails — and only falls back to the mail app when that fails and the person agrees (sendEmail asks).
// Callers prefill To / Cc / greeting and record the send where it belongs (onSent).
import { useEffect, useState } from 'react'
import { useToast } from '../context/ToastContext'
import { Ic, P } from './Icon'
import { Banner, Field, Modal } from './ui'
import { sendEmail, type SendEmailResult } from '../services/email'
import { loadSettings } from '../services/storage'
import { formatEmailList, isEmail, parseEmailList, recipientsLabel } from '../utils/emailList'

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

export type ComposeSent = { to: string; cc: string[]; subject: string; mode: SendEmailResult['mode']; who: string }

export type ComposeProps = {
  open: boolean
  onClose: () => void
  title: string
  sub: string
  /** Prefilled To (editable) */
  to: string
  /** Prefilled Cc (editable); a promise is filled in when it arrives (e.g. a client's billing contacts) */
  cc?: string[] | Promise<{ to?: string; cc: string[] }>
  ccHint?: string
  /** Name used for "Hi <first name>," */
  greetName: string
  /** Called after the email went out (or was opened in the mail app); record it here */
  onSent: (s: ComposeSent) => void
}

export default function EmailComposeModal({ open, onClose, title, sub, to: toInit, cc: ccInit, ccHint, greetName, onSent }: ComposeProps) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    const greeting = `Hi ${firstName(greetName)},\n\n\n`
    setTo(toInit || ''); setCc(Array.isArray(ccInit) ? formatEmailList(ccInit) : ''); setSubject(''); setError(null); setSending(false)
    setBody(greeting)
    if (ccInit && !Array.isArray(ccInit)) void ccInit.then(r => { if (alive) { if (r.to) setTo(r.to); setCc(formatEmailList(r.cc)) } }).catch(() => {})
    // The signature from Settings → Email (per-person signatures come with the planned "My profile")
    void loadSettings().then(s => { if (alive) setBody(b => (b === greeting ? `${b}${s.emailSignature || s.companyName || 'YVA Staffing'}` : b)) }).catch(() => {})
    return () => { alive = false }
  }, [open])   // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (sending) return
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
      const ccShown = ccList.emails.filter(e => e.toLowerCase() !== toAddr.toLowerCase())
      const who = recipientsLabel(toAddr, ccShown)
      onSent({ to: toAddr, cc: ccShown, subject: subject.trim(), mode: r.mode, who })
      toast.success(r.mode === 'mailto' ? 'Email opened in your email app.' : `Email sent to ${who}.`)
      onClose()
    } catch (e) { setError((e as Error).message); setSending(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} sub={sub}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--primary" disabled={sending} onClick={() => void send()}><Ic d={P.send} size={15} />{sending ? 'Sending…' : 'Send email'}</button>
      </>}>
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      <div className="stack crm-compose">
        <Field label="To"><input className="input" aria-label="To" type="email" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="Cc" hint={ccHint ?? 'Separate addresses with commas.'}><input className="input" aria-label="Cc" value={cc} onChange={e => setCc(e.target.value)} placeholder="None" /></Field>
        <Field label="Subject"><input className="input" aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} autoFocus maxLength={300} /></Field>
        <Field label="Message"><textarea className="textarea crm-compose__body" aria-label="Message" value={body} onChange={e => setBody(e.target.value)} rows={9} /></Field>
      </div>
    </Modal>
  )
}
