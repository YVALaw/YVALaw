// The raw email Gmail's API sends (RFC 2822): From / To / Cc / Subject, text body, attachments.
// Pure (no imports) so tests/emailList.test.ts can check the headers. Header-injection safe: line breaks are
// removed from every header value, the subject is MIME-encoded, attachment names lose quotes and line breaks.

/** `content` is text (encoded as UTF-8); `base64` is binary already encoded (a PDF) */
export type MimeAttachment = { name: string; mimeType: string; content?: string; base64?: string }

export type MimeMessage = {
  from: string
  to: string
  cc?: readonly string[]
  subject: string
  body: string
  attachments?: readonly MimeAttachment[]
  /** fixed in tests; random otherwise */
  boundary?: string
}

export function utf8ToBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

/** No line breaks in a header value (a "\r\nBcc: x" in a name or address can't add a header) */
export const headerSafe = (v: string) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()

export function encodeMimeHeader(value: string): string {
  const v = headerSafe(value)
  if (!/[^\x20-\x7E]/.test(v)) return v
  return `=?UTF-8?B?${utf8ToBase64(v)}?=`
}

/** RFC 2045: base64 lines of at most 76 characters */
export function wrapBase64(value: string): string {
  return value.replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') ?? value
}

const fileName = (n: string) => headerSafe(n).replace(/["\\]/g, '') || 'attachment'

/** The message as text (Gmail wants it base64url-encoded — see gmail.ts) */
export function buildMimeMessage(m: MimeMessage): string {
  const cc = (m.cc ?? []).map(headerSafe).filter(Boolean)
  const head = [
    `From: ${headerSafe(m.from)}`,
    `To: ${headerSafe(m.to)}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${encodeMimeHeader(m.subject)}`,
    'MIME-Version: 1.0',
  ]
  const attachments = m.attachments ?? []
  if (attachments.length === 0) {
    return [...head, 'Content-Type: text/plain; charset=utf-8', '', m.body].join('\r\n')
  }
  const boundary = m.boundary || `yva-os-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const parts = [
    ...head,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(utf8ToBase64(m.body.replace(/\r?\n/g, '\r\n'))),
  ]
  for (const a of attachments) {
    const name = fileName(a.name)
    parts.push(
      '',
      `--${boundary}`,
      `Content-Type: ${headerSafe(a.mimeType) || 'application/octet-stream'}; name="${name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`,
      '',
      wrapBase64(a.base64 ?? utf8ToBase64(a.content ?? '')),
    )
  }
  parts.push('', `--${boundary}--`)
  return parts.join('\r\n')
}

/** mailto: link with an optional cc (percent-encoded: mail apps don't read "+" as a space) */
export function buildMailtoUrl(to: string, subject: string, body: string, cc: readonly string[] = []): string {
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`]
  if (cc.length) params.push(`cc=${encodeURIComponent(cc.join(','))}`)
  return `mailto:${encodeURIComponent(headerSafe(to)).replace(/%40/g, '@')}?${params.join('&')}`
}
