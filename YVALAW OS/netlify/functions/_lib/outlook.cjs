/**
 * Send email through the company's Microsoft 365 mailbox (Microsoft Graph, app-only "client credentials").
 * One mailbox for everything (MS_SENDER_MAILBOX, e.g. contact@yvastaffing.agency). The Entra app has the
 * Mail.Send *application* permission, restricted to that one mailbox by an Exchange application access policy
 * (SETUP-AFTER-BUILD.md §3), so even a leaked secret cannot send as anyone else. No tokens ever reach the browser.
 *
 * Env: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER_MAILBOX
 */
class OutlookNotSetUp extends Error {}

const cfg = () => ({
  tenant: (process.env.MS_TENANT_ID || '').trim(),
  clientId: (process.env.MS_CLIENT_ID || '').trim(),
  secret: process.env.MS_CLIENT_SECRET || '',
  mailbox: (process.env.MS_SENDER_MAILBOX || '').trim(),
})

/** { configured, mailbox, missing[] } — never returns secrets */
function emailConfigured() {
  const c = cfg()
  const missing = [['MS_TENANT_ID', c.tenant], ['MS_CLIENT_ID', c.clientId], ['MS_CLIENT_SECRET', c.secret], ['MS_SENDER_MAILBOX', c.mailbox]]
    .filter(([, v]) => !v).map(([k]) => k)
  return { configured: missing.length === 0, mailbox: c.mailbox || null, missing }
}

let cached = null   // { token, until, key }

/** App-only access token for Microsoft Graph, kept in memory until ~5 minutes before it expires */
async function graphToken() {
  const c = cfg()
  const conf = emailConfigured()
  if (!conf.configured) throw new OutlookNotSetUp(`Outlook email is not set up: ${conf.missing.join(', ')} missing on Netlify (see SETUP-AFTER-BUILD.md §3).`)
  const key = `${c.tenant}|${c.clientId}|${c.secret.length}`
  if (cached && cached.key === key && cached.until > Date.now()) return cached.token
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    const reason = String(data.error_description || data.error || `HTTP ${res.status}`).split(/\r?\n/)[0].split(' Trace ID')[0]
    if (/AADSTS7000215|AADSTS7000222|invalid_client/i.test(reason)) throw new OutlookNotSetUp(`Microsoft rejected the app secret — MS_CLIENT_SECRET is wrong or expired (create a new one in Entra and update Netlify). ${reason}`)
    if (/AADSTS700016|AADSTS90002|AADSTS900023|unauthorized_client/i.test(reason)) throw new OutlookNotSetUp(`Microsoft doesn't recognise the app or tenant (check MS_TENANT_ID / MS_CLIENT_ID). ${reason}`)
    throw new Error(`Microsoft sign-in failed: ${reason}`)
  }
  cached = { token: data.access_token, key, until: Date.now() + Math.max(60, (Number(data.expires_in) || 3600) - 300) * 1000 }
  return cached.token
}

const recipients = list => [].concat(list || []).filter(Boolean).map(address => ({ emailAddress: { address: String(address).trim() } }))

/**
 * Send one email from the company mailbox. attachments: [{ name, contentType, base64 }].
 * Returns { from }. Throws OutlookNotSetUp (a setup problem) or Error("Microsoft rejected the email …").
 */
async function sendMail({ to, cc, subject, text, html, attachments = [], replyTo }) {
  const token = await graphToken()
  const { mailbox } = cfg()
  const message = {
    subject: String(subject || '').replace(/[\r\n]+/g, ' '),
    body: html ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: String(text || '') },
    toRecipients: recipients(to),
    ...(cc && [].concat(cc).length ? { ccRecipients: recipients(cc) } : {}),
    ...(replyTo ? { replyTo: recipients(replyTo) } : {}),
    ...(attachments.length ? {
      attachments: attachments.map(a => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.contentType || 'application/octet-stream', contentBytes: a.base64 })),
    } : {}),
  }
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true }),
  })
  if (res.status === 202 || res.ok) return { from: mailbox }
  const data = await res.json().catch(() => ({}))
  const code = data?.error?.code || ''
  const msg = data?.error?.message || `HTTP ${res.status}`
  if (res.status === 401) cached = null
  if (res.status === 401 || res.status === 403 || /AccessDenied|Authorization_RequestDenied/i.test(code)) {
    throw new OutlookNotSetUp(`Microsoft refused to send as ${mailbox}: the app needs the Mail.Send application permission with admin consent, and the mailbox access policy must include this mailbox. (${code || res.status}: ${msg})`)
  }
  if (res.status === 404 || /MailboxNotEnabledForRESTAPI|ResourceNotFound|ErrorInvalidUser/i.test(code)) {
    throw new OutlookNotSetUp(`Microsoft can't find the mailbox ${mailbox} (check MS_SENDER_MAILBOX). (${code || res.status}: ${msg})`)
  }
  throw new Error(`Microsoft rejected the email (${res.status}${code ? ` ${code}` : ''}): ${msg}`)
}

function __resetForTests() { cached = null }

module.exports = { sendMail, graphToken, emailConfigured, OutlookNotSetUp, __resetForTests }
