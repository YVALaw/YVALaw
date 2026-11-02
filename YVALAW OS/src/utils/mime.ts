// Email helpers with no imports (tests/emailList.test.ts checks them): the request body for the send-email
// function (company Outlook mailbox) and the mailto: fallback link. Header-injection safe: line breaks are
// removed from addresses and the subject; file names lose quotes, slashes and line breaks.

/** `content` is text (encoded as UTF-8); `base64` is binary already encoded (a PDF from utils/pdf.ts) */
export type MimeAttachment = { name: string; mimeType: string; content?: string; base64?: string }

export function utf8ToBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

/** No line breaks in a header value (a "\r\nBcc: x" in a name or address can't add a header) */
export const headerSafe = (v: string) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()

const fileName = (n: string) => headerSafe(n).replace(/["\\/]/g, '') || 'attachment'

export type SendEmailRequest = {
  to: string[]
  cc: string[]
  subject: string
  text: string
  attachments: { name: string; contentType: string; base64: string }[]
}

/** The JSON body POSTed to /.netlify/functions/send-email (the server checks it again — _lib/emailRules.cjs) */
export function buildSendRequest(to: string, subject: string, body: string, attachments: readonly MimeAttachment[] = [], cc: readonly string[] = []): SendEmailRequest {
  return {
    to: headerSafe(to).split(/[,;]\s*/).map(s => s.trim()).filter(Boolean),
    cc: cc.map(headerSafe).filter(Boolean),
    subject: headerSafe(subject),
    text: String(body ?? ''),
    attachments: attachments.map(a => ({
      name: fileName(a.name),
      contentType: headerSafe(a.mimeType) || 'application/octet-stream',
      base64: (a.base64 ?? utf8ToBase64(a.content ?? '')).replace(/\s+/g, ''),
    })),
  }
}

/** mailto: link with an optional cc (percent-encoded: mail apps don't read "+" as a space) */
export function buildMailtoUrl(to: string, subject: string, body: string, cc: readonly string[] = []): string {
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`]
  if (cc.length) params.push(`cc=${encodeURIComponent(cc.join(','))}`)
  return `mailto:${encodeURIComponent(headerSafe(to)).replace(/%40/g, '@')}?${params.join('&')}`
}
