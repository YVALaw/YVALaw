/**
 * Pure checks for an email YVA OS is asked to send (no network, no secrets) — used by send-email.cjs and
 * unit-tested in tests/emailRules.test.ts. Throws EmailRuleError with a plain-language message.
 */
const MAX_RECIPIENTS = 10
const MAX_SUBJECT = 300
const MAX_TEXT_BYTES = 200 * 1024
const MAX_ATTACHMENT_BYTES = 4.5 * 1024 * 1024   // Netlify accepts ~6 MB request bodies; base64 adds a third
const ALLOWED_TYPES = ['application/pdf']

class EmailRuleError extends Error {}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/
const isEmail = s => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s)

/** "a@x.com, b@y.com" or ['a@x.com'] → unique (case-insensitive), trimmed list */
function addressList(v) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)
  const seen = new Set(), out = []
  for (const a of raw) {
    const s = String(a ?? '').trim().replace(/^<|>$/g, '')
    if (!s) continue
    const key = s.toLowerCase()
    if (!seen.has(key)) { seen.add(key); out.push(s) }
  }
  return out
}

/** Safe file name: no path, no control/quote characters, keeps the extension, ≤ 120 chars */
function safeFileName(name, fallback = 'document.pdf') {
  let s = String(name ?? '').split(/[\\/]/).pop() || ''
  s = s.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').replace(/\s+/g, ' ').trim()
  if (!s || /^\.+$/.test(s)) s = fallback
  if (s.length > 120) { const ext = (s.match(/\.[a-z0-9]{1,6}$/i) || [''])[0]; s = s.slice(0, 120 - ext.length) + ext }
  return s
}

const base64Bytes = s => Math.floor(s.length * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0)

/** Validate and normalise { to, cc, subject, text, attachments:[{ name, contentType, base64 }] } */
function checkEmail(input) {
  const m = input || {}
  const to = addressList(m.to)
  const toKeys = new Set(to.map(a => a.toLowerCase()))
  const cc = addressList(m.cc).filter(a => !toKeys.has(a.toLowerCase()))
  if (!to.length) throw new EmailRuleError('Add at least one recipient.')
  const bad = [...to, ...cc].filter(a => !isEmail(a))
  if (bad.length) throw new EmailRuleError(`Not a valid email address: ${bad.slice(0, 3).join(', ')}`)
  if (to.length + cc.length > MAX_RECIPIENTS) throw new EmailRuleError(`Too many recipients (${to.length + cc.length}); the limit is ${MAX_RECIPIENTS} per email.`)
  const subject = String(m.subject ?? '').replace(/[\r\n]+/g, ' ').trim()
  if (!subject) throw new EmailRuleError('The email needs a subject.')
  if (subject.length > MAX_SUBJECT) throw new EmailRuleError(`The subject is too long (max ${MAX_SUBJECT} characters).`)
  const text = String(m.text ?? '')
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new EmailRuleError('The message is too long.')
  const list = Array.isArray(m.attachments) ? m.attachments : []
  let total = 0
  const attachments = list.map((a, i) => {
    const contentType = String(a?.contentType || '').toLowerCase().split(';')[0].trim()
    if (!ALLOWED_TYPES.includes(contentType)) throw new EmailRuleError(`Only PDF attachments can be sent (attachment ${i + 1} is ${contentType || 'an unknown type'}).`)
    const base64 = String(a?.base64 || '').replace(/\s/g, '')
    if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new EmailRuleError(`Attachment ${i + 1} is empty or damaged.`)
    const size = base64Bytes(base64)
    total += size
    return { name: safeFileName(a?.name, `document-${i + 1}.pdf`), contentType, base64, size }
  })
  if (total > MAX_ATTACHMENT_BYTES) throw new EmailRuleError(`The attachments are too large together (${(total / 1048576).toFixed(1)} MB; max 4.5 MB). Send fewer PDFs per email.`)
  return { to, cc, subject, text, attachments }
}

module.exports = { checkEmail, addressList, safeFileName, isEmail, EmailRuleError, MAX_RECIPIENTS, MAX_ATTACHMENT_BYTES }
