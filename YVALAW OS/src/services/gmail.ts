import { loadSettings, saveSettings } from './storage'
import { supabase } from '../lib/supabase'

type GmailUserData = {
  gmailAccessToken?: string
  gmailRefreshToken?: string
  gmailTokenExpiry?: number
  gmailEmail?: string
}

type EmailAttachment = { name: string; content: string; mimeType: string }

// null removes a key from Supabase user metadata; undefined is dropped by JSON.stringify
// and leaves the stored value in place (the old Disconnect did nothing).
type GmailUserDataPatch = { [K in keyof GmailUserData]?: GmailUserData[K] | null }

export type SendEmailResult = {
  // failed: Gmail could not send and the user chose not to open the mail app
  mode: 'gmail' | 'mailto' | 'failed'
  attached: boolean
  fallbackReason?: string
}

/** The saved Google sign-in is unusable; only connecting Gmail again fixes it */
export class GmailReconnectError extends Error {}
const RECONNECT_HINT = 'Reconnect Gmail in Settings → Integrations.'
const errorMessage = (err: unknown, fallback = 'Unknown error') => (err instanceof Error ? err.message : fallback)

async function getGmailUserData(): Promise<GmailUserData> {
  const { data: { user }, error } = await supabase.auth.getUser()
  // Reading a failed lookup as "not connected" turned a network blip into a silent switch to the mail app
  if (error) throw new Error(`Could not load your Gmail connection: ${error.message}`)
  return (user?.user_metadata || {}) as GmailUserData
}

async function saveGmailUserData(data: GmailUserDataPatch): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data })
  if (error) throw new Error(`Could not save your Gmail connection: ${error.message}`)
}

const AUTH_ENDPOINT  = 'https://accounts.google.com/o/oauth2/v2/auth'
const SEND_ENDPOINT  = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const SCOPE = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email'
const NETLIFY_GMAIL_OAUTH_ENDPOINT = '/.netlify/functions/gmail-oauth'

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generateVerifier(): Promise<string> {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return b64url(arr.buffer)
}

async function generateChallenge(verifier: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(buf)
}

export async function initiateGmailAuth(clientId: string): Promise<void> {
  const verifier  = await generateVerifier()
  const challenge = await generateChallenge(verifier)
  const state     = b64url(crypto.getRandomValues(new Uint8Array(16)).buffer)

  localStorage.setItem('gmail_pkce_verifier', verifier)
  localStorage.setItem('gmail_pkce_state', state)

  const redirect = window.location.origin + '/oauth-callback'
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  window.location.href = `${AUTH_ENDPOINT}?${params}`
}

export async function exchangeCode(code: string, clientId: string): Promise<string> {
  const verifier = localStorage.getItem('gmail_pkce_verifier')
  if (!verifier) throw new Error('PKCE verifier missing — please try connecting again.')

  const redirect = window.location.origin + '/oauth-callback'
  const res = await fetch(NETLIFY_GMAIL_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'exchange',
      code,
      clientId,
      codeVerifier: verifier,
      redirectUri: redirect,
    }),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new Error(`Token exchange failed: ${error?.error || 'Unknown server error'}`)
  }
  const data = await res.json()

  const uiRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  const ui = await uiRes.json()

  const existing = await getGmailUserData()
  await saveGmailUserData({
    gmailAccessToken: data.access_token,
    gmailRefreshToken: data.refresh_token || existing.gmailRefreshToken,
    gmailTokenExpiry: Date.now() + (data.expires_in - 60) * 1000,
    gmailEmail: ui.email as string,
  })

  const settings = await loadSettings()
  void saveSettings({ ...settings, gmailClientId: clientId })

  localStorage.removeItem('gmail_pkce_verifier')
  localStorage.removeItem('gmail_pkce_state')

  return ui.email as string
}

async function refreshAccessToken(userData: GmailUserData): Promise<string> {
  if (!userData.gmailRefreshToken) throw new GmailReconnectError(`No Gmail refresh token is saved for your account. ${RECONNECT_HINT}`)
  const { gmailClientId } = await loadSettings()
  if (!gmailClientId) throw new GmailReconnectError('The Google OAuth Client ID is missing. Add it in Settings → Integrations and reconnect Gmail.')
  let res: Response
  try {
    res = await fetch(NETLIFY_GMAIL_OAUTH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', clientId: gmailClientId, refreshToken: userData.gmailRefreshToken }),
    })
  } catch {
    throw new Error('Could not reach the Gmail token service. Check your internet connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const googleError = data?.details?.error
    if (googleError === 'invalid_grant') throw new GmailReconnectError(`Google says the saved Gmail sign-in has expired or been revoked. ${RECONNECT_HINT}`)
    if (googleError === 'invalid_client' || googleError === 'unauthorized_client') {
      throw new Error('Google rejected the OAuth client. Check that GMAIL_CLIENT_SECRET on Netlify belongs to the Client ID in Settings → Integrations.')
    }
    throw new Error(`Gmail token refresh failed: ${data?.error || `HTTP ${res.status}`}`)
  }
  if (!data.access_token) throw new Error('Gmail token refresh returned no access token.')
  saveGmailUserData({
    gmailAccessToken: data.access_token,
    gmailTokenExpiry: Date.now() + (data.expires_in - 60) * 1000,
  }).catch(err => console.warn('Could not store the refreshed Gmail token:', err))
  return data.access_token as string
}

async function getAccessToken(userData: GmailUserData): Promise<string> {
  if (!userData.gmailAccessToken) throw new GmailReconnectError(`Gmail is not connected. ${RECONNECT_HINT}`)
  if (userData.gmailTokenExpiry && Date.now() > userData.gmailTokenExpiry) return refreshAccessToken(userData)
  return userData.gmailAccessToken
}

export async function isGmailConnected(): Promise<boolean> {
  const userData = await getGmailUserData()
  return !!(userData.gmailAccessToken && userData.gmailEmail)
}

export async function disconnectGmail(): Promise<void> {
  await saveGmailUserData({
    gmailAccessToken: null,
    gmailRefreshToken: null,
    gmailTokenExpiry: null,
    gmailEmail: null,
  })
}

function utf8ToBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
}

function utf8ToBase64Url(value: string): string {
  return utf8ToBase64(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function encodeMimeHeader(value: string): string {
  if (!/[^\x20-\x7E]/.test(value)) return value
  return `=?UTF-8?B?${utf8ToBase64(value)}?=`
}

// RFC 2045: base64 lines of at most 76 characters
function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') ?? value
}

function buildRaw(to: string, subject: string, body: string, from: string): string {
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n')
  return utf8ToBase64Url(msg)
}

function buildRawWithAttachments(
  to: string,
  subject: string,
  body: string,
  from: string,
  attachments: EmailAttachment[],
): string {
  const boundary = `yva-os-${crypto.randomUUID()}`
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body.replace(/\r?\n/g, '\r\n'),
  ]

  for (const attachment of attachments) {
    parts.push(
      '',
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      '',
      wrapBase64(utf8ToBase64(attachment.content)),
    )
  }

  parts.push('', `--${boundary}--`)
  return utf8ToBase64Url(parts.join('\r\n'))
}

function downloadAttachment(attachment: EmailAttachment) {
  const blob = new Blob([attachment.content], { type: attachment.mimeType || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = attachment.name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function sendGmailMessage(
  to: string,
  subject: string,
  body: string,
  attachments: EmailAttachment[] = [],
): Promise<void> {
  const userData = await getGmailUserData()
  if (!userData.gmailEmail) throw new GmailReconnectError(`Gmail is not connected. ${RECONNECT_HINT}`)

  const raw = attachments.length > 0
    ? buildRawWithAttachments(to, subject, body, userData.gmailEmail, attachments)
    : buildRaw(to, subject, body, userData.gmailEmail)

  const send = async (token: string) => {
    try {
      return await fetch(SEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      })
    } catch {
      throw new Error('Could not reach Gmail. Check your internet connection and try again.')
    }
  }
  let res = await send(await getAccessToken(userData))
  // The stored expiry is only an estimate (early revocation, a wrong PC clock): a 401 gets one forced refresh
  if (res.status === 401) res = await send(await refreshAccessToken(userData))
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail = err?.error?.message || `HTTP ${res.status}`
    if (res.status === 401) throw new GmailReconnectError(`Google rejected the saved Gmail sign-in (${detail}). ${RECONNECT_HINT}`)
    if (res.status === 403 && /insufficient/i.test(detail)) throw new GmailReconnectError(`Permission to send email was not granted (${detail}). ${RECONNECT_HINT}`)
    throw new Error(`Gmail API error ${res.status}: ${detail}`)
  }
}

function openInMailApp(to: string, subject: string, body: string, attachments: EmailAttachment[]) {
  for (const file of attachments) downloadAttachment(file)
  // Percent-encoded: mailto does not decode "+" as a space
  window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Gmail if connected; never falls back silently — the user sees why Gmail failed and decides */
export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  attachment?: EmailAttachment,
): Promise<SendEmailResult> {
  if (!to) return { mode: 'mailto', attached: false }
  const attachments = attachment ? [attachment] : []
  let fallbackReason: string
  try {
    if (await isGmailConnected()) {
      await sendGmailMessage(to, subject, body, attachments)
      return { mode: 'gmail', attached: attachments.length > 0 }
    }
    // With no OAuth client set up nobody here sends through Gmail: the mail app is the expected route
    if (!(await loadSettings()).gmailClientId) {
      openInMailApp(to, subject, body, attachments)
      return { mode: 'mailto', attached: false }
    }
    fallbackReason = 'Gmail is not connected for the account you are signed in with. Connect it in Settings → Integrations.'
  } catch (err) {
    console.error('Gmail send failed:', err)
    fallbackReason = errorMessage(err, 'Gmail send failed')
  }
  const useMailApp = window.confirm(
    `Gmail could not send this email.\n\n${fallbackReason}\n\n` +
    `Open it in your email app instead?${attachments.length > 0 ? ' The PDF will be downloaded so you can attach it.' : ''}`,
  )
  if (!useMailApp) return { mode: 'failed', attached: false, fallbackReason }
  openInMailApp(to, subject, body, attachments)
  return { mode: 'mailto', attached: false, fallbackReason }
}
