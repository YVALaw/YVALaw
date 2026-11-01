import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Ic, P } from '../components/Icon'
import AuthLayout from '../components/settings/AuthLayout'
import { Banner, Field } from '../components/ui'
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

  const timeIcon = (tone: string, d: string) => <span className={`set-auth__icon set-auth__icon--${tone}`}><Ic d={d} size={24} stroke={2.2} /></span>

  if (!validLink) {
    return (
      <AuthLayout title="Connect YVA Time" sub="Sign in to the desktop app on this computer" icon={timeIcon('bad', P.alert)}>
        <Banner tone="danger">
          This link is incomplete. Open YVA Time on your computer and click <strong>Sign in with YVA OS</strong> again.
        </Banner>
      </AuthLayout>
    )
  }

  if (code) {
    return (
      <AuthLayout title="Connected" sub="YVA Time should open now." icon={timeIcon('ok', P.check)} foot="You can close this tab.">
        <Banner tone="success">Connected. YVA Time should open now.</Banner>
        <Field label="If the app didn't open, copy this code and paste it into YVA Time (it works for 5 minutes):">
          <div className="set-code-box">
            <input className="input" readOnly value={code} onFocus={e => e.target.select()} aria-label="Sign-in code" />
            <button type="button" className="btn" onClick={() => void copyCode()}>
              <Ic d={copied ? P.check : P.copy} size={15} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </Field>
        <a className="btn btn--block" href={`yvatime://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`}>Open YVA Time again</a>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Connect YVA Time" sub="Sign in to the desktop app on this computer" icon={timeIcon('gold', P.time)}>
      <p className="set-auth__sub">
        YVA Time will track your hours as <strong>{email || 'you'}</strong>. Only connect it on a computer you use for work.
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="stack">
        <button className="btn btn--primary btn--lg btn--block" disabled={busy} onClick={() => void connect()}>
          {busy ? 'Connecting…' : 'Connect this computer'}
        </button>
        <button className="btn btn--ghost btn--block" disabled={busy} onClick={() => window.close()}>Cancel</button>
      </div>
    </AuthLayout>
  )
}
