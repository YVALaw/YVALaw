// Settings → Integrations / Email: is this login's Gmail connection actually usable?
// Asks Google (tokeninfo) instead of trusting that a token string is stored, refreshing the
// access token once through the same Netlify function services/gmail.ts uses.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadSettings } from '../../services/storage'
import { isGmailConnected } from '../../services/gmail'

export type GmailState = 'checking' | 'off' | 'ok' | 'reconnect' | 'problem'
export type GmailStatus = { state: GmailState; email?: string; reason?: string }

type Meta = { gmailAccessToken?: string; gmailRefreshToken?: string; gmailTokenExpiry?: number; gmailEmail?: string }

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

async function refresh(meta: Meta): Promise<{ token?: string; status?: GmailStatus }> {
  if (!meta.gmailRefreshToken) return { status: { state: 'reconnect', email: meta.gmailEmail, reason: 'No Gmail refresh token is saved for your account.' } }
  const { gmailClientId } = await loadSettings()
  if (!gmailClientId) return { status: { state: 'reconnect', email: meta.gmailEmail, reason: 'The Google OAuth Client ID is missing. Add it below and reconnect Gmail.' } }
  let res: Response
  try {
    res = await fetch('/.netlify/functions/gmail-oauth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', clientId: gmailClientId, refreshToken: meta.gmailRefreshToken }),
    })
  } catch {
    return { status: { state: 'problem', email: meta.gmailEmail, reason: 'Could not reach the Gmail token service. Check your internet connection and try again.' } }
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const g = data?.details?.error
    if (g === 'invalid_grant') return { status: { state: 'reconnect', email: meta.gmailEmail, reason: 'Google says the saved Gmail sign-in has expired or been revoked.' } }
    if (g === 'invalid_client' || g === 'unauthorized_client') {
      return { status: { state: 'problem', email: meta.gmailEmail, reason: 'Google rejected the OAuth client. Check that GMAIL_CLIENT_SECRET on Netlify belongs to the Client ID below.' } }
    }
    return { status: { state: 'problem', email: meta.gmailEmail, reason: `Gmail token refresh failed: ${data?.error || `HTTP ${res.status}`}` } }
  }
  if (!data.access_token) return { status: { state: 'problem', email: meta.gmailEmail, reason: 'Gmail token refresh returned no access token.' } }
  // Same storage as services/gmail.ts (user metadata); a failed store only costs a refresh next time
  void supabase.auth.updateUser({ data: { gmailAccessToken: data.access_token, gmailTokenExpiry: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 } })
  return { token: data.access_token as string }
}

export async function checkGmailConnection(): Promise<GmailStatus> {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) return { state: 'problem', reason: `Could not load your Gmail connection: ${error.message}` }
  const meta = (user?.user_metadata || {}) as Meta
  if (!meta.gmailAccessToken || !meta.gmailEmail) return { state: 'off' }

  let token = meta.gmailAccessToken
  let refreshed = false
  if (meta.gmailTokenExpiry && Date.now() > meta.gmailTokenExpiry) {
    const r = await refresh(meta)
    if (r.status) return r.status
    token = r.token!; refreshed = true
  }
  for (;;) {
    let res: Response
    try {
      res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
    } catch {
      return { state: 'problem', email: meta.gmailEmail, reason: 'Could not reach Google to check the connection. Check your internet connection and try again.' }
    }
    if (res.ok) {
      const info = await res.json().catch(() => ({}))
      const scopes = String(info?.scope || '').split(' ')
      if (!scopes.includes(SEND_SCOPE)) return { state: 'reconnect', email: meta.gmailEmail, reason: 'The saved sign-in is missing permission to send email.' }
      return { state: 'ok', email: meta.gmailEmail }
    }
    if (res.status === 400 || res.status === 401) {
      if (refreshed) return { state: 'reconnect', email: meta.gmailEmail, reason: 'Google no longer accepts the saved Gmail sign-in.' }
      const r = await refresh(meta)
      if (r.status) return r.status
      token = r.token!; refreshed = true
      continue
    }
    return { state: 'problem', email: meta.gmailEmail, reason: `Google answered HTTP ${res.status} while checking the connection.` }
  }
}

/** Gmail connection for this login, checked with Google. `recheck` runs it again. */
export function useGmailStatus() {
  const [status, setStatus] = useState<GmailStatus>({ state: 'checking' })
  const recheck = useCallback(async () => {
    setStatus(s => ({ ...s, state: 'checking' }))
    try {
      // Cheap local check first, then ask Google
      if (!(await isGmailConnected())) { setStatus({ state: 'off' }); return }
      setStatus(await checkGmailConnection())
    } catch (e) {
      setStatus({ state: 'problem', reason: e instanceof Error ? e.message : 'Unknown error' })
    }
  }, [])
  useEffect(() => { void recheck() }, [recheck])
  return { status, setStatus, recheck }
}
