/**
 * Send email from scheduled jobs and server functions through the Gmail account chosen in
 * Settings → Notifications ("Automatic emails are sent from"), like the old CRM's reminder:
 * that person connected Gmail in YVA OS, so their refresh token is in their Supabase user
 * metadata. Failures throw with a plain-language reason (never silent).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_CLIENT_SECRET
 */
const { rest, authAdmin } = require('./supa.cjs')

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

class GmailNotSetUp extends Error {}

const b64 = s => Buffer.from(s, 'utf8').toString('base64')
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function mimeHeader(v) { return /[^\x20-\x7E]/.test(v) ? `=?UTF-8?B?${b64(v)}?=` : v }
const wrap = s => s.match(/.{1,76}/g)?.join('\r\n') ?? s
const cleanAddr = a => String(a || '').replace(/[\r\n]/g, '').trim()

/** RFC 2822 message: text (+ optional HTML alternative) and attachments ({ name, mimeType, content: string|Buffer }) */
function buildRaw({ from, fromName, to, cc, subject, text, html, attachments = [] }) {
  const mixed = `yva-mixed-${Math.random().toString(36).slice(2)}`
  const alt = `yva-alt-${Math.random().toString(36).slice(2)}`
  const head = [
    `From: ${fromName ? `${mimeHeader(fromName)} <${cleanAddr(from)}>` : cleanAddr(from)}`,
    `To: ${[].concat(to).map(cleanAddr).join(', ')}`,
    ...(cc && [].concat(cc).length ? [`Cc: ${[].concat(cc).map(cleanAddr).join(', ')}`] : []),
    `Subject: ${mimeHeader(String(subject).replace(/[\r\n]/g, ' '))}`,
    'MIME-Version: 1.0',
  ]
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(b64(text || ''))]
  const body = html
    ? [`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`, ...textPart, `--${alt}`,
       'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(b64(html)), `--${alt}--`]
    : textPart
  if (!attachments.length) return b64url([...head, ...body].join('\r\n'))
  const parts = [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, ...body]
  for (const a of attachments) {
    const name = String(a.name).replace(/["\r\n]/g, '')
    parts.push(`--${mixed}`, `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${name}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${name}"`, '', wrap(Buffer.isBuffer(a.content) ? a.content.toString('base64') : b64(String(a.content))))
  }
  parts.push(`--${mixed}--`)
  return b64url(parts.join('\r\n'))
}

/** The configured sender: { email, accessToken } — throws GmailNotSetUp with what is missing */
async function senderToken() {
  const secret = process.env.GMAIL_CLIENT_SECRET
  const [settings] = await rest('settings?id=eq.1&select=gmail_client_id,notify_sender_user_id,company_name')
  if (!settings?.gmail_client_id) throw new GmailNotSetUp('Gmail is not set up: add the Google OAuth Client ID in Settings → Integrations.')
  if (!secret) throw new GmailNotSetUp('Gmail is not set up: GMAIL_CLIENT_SECRET is missing on Netlify.')
  if (!settings.notify_sender_user_id) throw new GmailNotSetUp('No account is chosen to send automatic emails (Settings → Notifications → "Use my Gmail").')
  const user = await authAdmin(`users/${settings.notify_sender_user_id}`)
  const meta = user.user_metadata || {}
  if (!meta.gmailRefreshToken || !meta.gmailEmail) throw new GmailNotSetUp(`The sending account (${user.email}) has not connected Gmail (Settings → Integrations).`)
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.gmail_client_id, client_secret: secret, refresh_token: meta.gmailRefreshToken, grant_type: 'refresh_token' }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') throw new GmailNotSetUp(`Google says ${meta.gmailEmail}'s Gmail sign-in expired or was revoked — reconnect Gmail in Settings → Integrations.`)
    throw new Error(`Google token refresh failed: ${data.error_description || data.error || res.status}`)
  }
  return { email: meta.gmailEmail, accessToken: data.access_token, companyName: settings.company_name || 'YVA Staffing' }
}

/** Send one email from the configured sender. Returns { from, id }. */
async function sendMail(msg, sender) {
  const s = sender || await senderToken()
  const raw = buildRaw({ from: s.email, fromName: msg.fromName || s.companyName, ...msg })
  const res = await fetch(SEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Gmail refused the email (${res.status}): ${data?.error?.message || 'unknown error'}`)
  return { from: s.email, id: data.id }
}

module.exports = { sendMail, senderToken, buildRaw, GmailNotSetUp }
