import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { IconCheck, IconClock, IconCopy } from '../components/Icon'
import { useRole } from '../context/RoleContext'
import { CONNECT_RETURN_KEY } from '../lib/connectApp'

/**
 * /connect-app — "Sign in with YVA OS" for the YVA Time desktop app.
 * The app opens this page with ?challenge=…&state=…; on Connect we get a one-time code
 * (desktop-link-create) and hand it back through yvatime://auth?code=…&state=…
 */
export default function ConnectAppPage() {
  const { email } = useRole()
  const params    = new URLSearchParams(window.location.search)
  const challenge = params.get('challenge') || ''
  const state     = params.get('state') || ''
  const validLink = /^[A-Za-z0-9_-]{43}$/.test(challenge) && /^[A-Za-z0-9_-]{8,64}$/.test(state)

  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [code,   setCode]   = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { sessionStorage.removeItem(CONNECT_RETURN_KEY) }, [])

  async function connect() {
    setBusy(true); setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setBusy(false); setError('You must be logged in.'); return }
    try {
      const res  = await fetch('/.netlify/functions/desktop-link-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ challenge }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not connect the app.'); return }
      setCode(data.code)
      window.location.href = `yvatime://auth?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(state)}`
    } catch {
      setError('Network error — could not connect the app.')
    } finally {
      setBusy(false)
    }
  }

  async function copyCode() {
    if (!code) return
    try { await navigator.clipboard.writeText(code); setCopied(true) } catch { window.prompt('Copy this code:', code) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 }}>
      <div className="portal-section" style={{ width: '100%', maxWidth: 440 }}>
        <div className="portal-section-header" style={{ justifyContent: 'flex-start', gap: 12 }}>
          <IconClock size={20} />
          <div>
            <div className="portal-section-title">Connect YVA Time</div>
            <div className="portal-section-sub">Sign in to the desktop app on this computer</div>
          </div>
        </div>
        <div className="portal-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!validLink ? (
            <div className="portal-message portal-message-error">
              This link is incomplete. Open YVA Time on your computer and click <strong>Sign in with YVA OS</strong> again.
            </div>
          ) : code ? (
            <>
              <div className="portal-message portal-message-success"><IconCheck size={14} /> Connected. YVA Time should open now.</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                If the app didn't open, copy this code and paste it into YVA Time (it works for 5 minutes):
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" readOnly value={code} onFocus={e => e.target.select()} style={{ fontFamily: 'monospace', fontSize: 13 }} />
                <button className="btn-ghost btn-sm" onClick={() => void copyCode()}>
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>You can close this tab.</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6 }}>
                YVA Time will track your hours as <strong>{email || 'you'}</strong>. Only connect it on a computer you use for work.
              </div>
              {error && <div className="portal-message portal-message-error">{error}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn-primary" disabled={busy} onClick={() => void connect()}>
                  {busy ? 'Connecting…' : 'Connect this computer'}
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => window.close()}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
