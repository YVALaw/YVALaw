// Sending email from YVA OS (2026-11): everything goes out from the company Outlook mailbox through the
// send-email Netlify function (Microsoft Graph, netlify/functions/_lib/outlook.cjs). No email tokens live in the
// browser. Failures are never silent: the person sees why and decides whether to open their mail app instead
// (the PDFs are then downloaded so they can attach them by hand).
import { supabase } from '../lib/supabase'
import { buildMailtoUrl, buildSendRequest, type MimeAttachment } from '../utils/mime'
import { mergeCc } from '../utils/emailList'

/** `content` = text; `base64` = binary (a PDF from utils/pdf.ts) */
export type EmailAttachment = MimeAttachment
export type SendEmailOptions = { attachments?: EmailAttachment[]; cc?: readonly string[] }

export type SendEmailResult = {
  // outlook: sent from the company mailbox · mailto: handed to the mail app · failed: not sent, user declined the mail app
  mode: 'outlook' | 'mailto' | 'failed'
  attached: boolean
  fallbackReason?: string
}

export type EmailStatus = {
  configured: boolean
  mailbox: string | null
  missing?: string[]
  /** only with check: Microsoft accepted the app's sign-in */
  ok?: boolean
  problem?: string
}

const SEND_URL = '/.netlify/functions/send-email'
const STATUS_URL = '/.netlify/functions/email-status'

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session has expired. Sign in again and retry.')
  return { Authorization: `Bearer ${token}` }
}

/** Which mailbox YVA OS sends from; `check` also asks Microsoft whether the app can sign in (no email sent) */
export async function loadEmailStatus(check = false): Promise<EmailStatus> {
  const res = await fetch(`${STATUS_URL}${check ? '?check=1' : ''}`, { headers: await authHeader() })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not check email sending (HTTP ${res.status}).`)
  return data as EmailStatus
}

class NotSetUp extends Error {}

/** Send through the company mailbox; throws with a plain-language reason */
export async function sendOutlookMessage(to: string, subject: string, body: string, attachments: EmailAttachment[] = [], cc: readonly string[] = []): Promise<{ from: string }> {
  const payload = JSON.stringify(buildSendRequest(to, subject, body, attachments, cc))
  let res: Response
  try {
    res = await fetch(SEND_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: payload })
  } catch {
    throw new Error('Could not reach YVA OS to send the email. Check your internet connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.ok && data.ok) return { from: data.from }
  if (res.status === 503 && data.notSetUp) throw new NotSetUp(data.error || 'Outlook email is not set up yet.')
  if (res.status === 413) throw new Error('The email and its PDFs are too large to send in one go. Send fewer PDFs per email.')
  throw new Error(data.error || `Email could not be sent (HTTP ${res.status}).`)
}

function attachmentBlob(attachment: EmailAttachment): Blob {
  if (attachment.base64 != null) {
    const bin = atob(attachment.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: attachment.mimeType || 'application/octet-stream' })
  }
  return new Blob([attachment.content ?? ''], { type: attachment.mimeType || 'application/octet-stream' })
}

/** Save an attachment (the PDF) to the computer — the mail app route can't attach it by itself */
export function downloadAttachment(attachment: EmailAttachment) {
  const url = URL.createObjectURL(attachmentBlob(attachment))
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function openInMailApp(to: string, subject: string, body: string, attachments: EmailAttachment[], cc: readonly string[]) {
  for (const file of attachments) downloadAttachment(file)
  window.location.href = buildMailtoUrl(to, subject, body, cc)
}

/** Send from the company Outlook mailbox; never falls back silently — the user sees why it failed and decides.
 *  `cc` is cleaned (valid addresses, once each, never the To address). */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  if (!to) return { mode: 'mailto', attached: false }
  const attachments = options.attachments ?? []
  const cc = mergeCc(to, options.cc)
  const hasPdf = attachments.some(a => a.mimeType === 'application/pdf')
  let fallbackReason: string
  let notSetUp = false
  try {
    await sendOutlookMessage(to, subject, body, attachments, cc)
    return { mode: 'outlook', attached: attachments.length > 0 }
  } catch (err) {
    notSetUp = err instanceof NotSetUp
    if (!notSetUp) console.error('Email send failed:', err)
    fallbackReason = err instanceof Error ? err.message : 'Email could not be sent.'
  }
  const useMailApp = window.confirm(
    (notSetUp
      ? `Outlook email isn't set up in YVA OS yet, so this email can't be sent from the company mailbox.\n\n${fallbackReason}\n\n`
      : `The email could not be sent from the company mailbox.\n\n${fallbackReason}\n\n`) +
    `Open it in your email app instead?${attachments.length > 0 ? ` The ${hasPdf ? 'PDF' : 'attachment'} will be downloaded so you can attach it.` : ''}`,
  )
  if (!useMailApp) return { mode: 'failed', attached: false, fallbackReason }
  openInMailApp(to, subject, body, attachments, cc)
  return { mode: 'mailto', attached: false, fallbackReason }
}
