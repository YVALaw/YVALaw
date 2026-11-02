import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { APP_URL } from '../lib/appUrl'
import AuthLayout from '../components/settings/AuthLayout'
import { Banner, Checkbox, Field } from '../components/ui'
import { useToast } from '../context/ToastContext'

type ResetState = 'idle' | 'sending' | 'sent' | 'error'

const LAST_EMAIL_KEY   = 'yva_last_email'
const ATTEMPTS_KEY     = 'yva_login_attempts'
const MAX_ATTEMPTS     = 5
const LOCKOUT_MS       = 15 * 60 * 1000 // 15 minutes

type AttemptsRecord = { count?: number; lockedUntil?: number }

function getAttempts(): AttemptsRecord {
  try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}') } catch { return {} }
}
function saveAttempts(r: AttemptsRecord) { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(r)) }
function clearAttempts() { localStorage.removeItem(ATTEMPTS_KEY) }

function getLockoutRemaining(): number {
  const r = getAttempts()
  if (!r.lockedUntil) return 0
  return Math.max(0, r.lockedUntil - Date.now())
}

export default function LoginPage() {
  const [email, setEmail]         = useState(() => localStorage.getItem(LAST_EMAIL_KEY) || '')
  const [password, setPassword]   = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [lockRemaining, setLockRemaining] = useState(getLockoutRemaining())
  const [resetState, setResetState]       = useState<ResetState>('idle')
  const [resetMsg, setResetMsg]           = useState<string | null>(null)   // problems only; "email sent" is a toast
  const toast = useToast()

  useEffect(() => {
    if (lockRemaining <= 0) return
    const t = setInterval(() => {
      const rem = getLockoutRemaining()
      setLockRemaining(rem)
      if (rem <= 0) { clearAttempts(); clearInterval(t) }
    }, 1000)
    return () => clearInterval(t)
  }, [lockRemaining])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (getLockoutRemaining() > 0) return

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)

    if (error) {
      const rec = getAttempts()
      const count = (rec.count || 0) + 1
      if (count >= MAX_ATTEMPTS) {
        saveAttempts({ count, lockedUntil: Date.now() + LOCKOUT_MS })
        setLockRemaining(LOCKOUT_MS)
        setError('Too many failed attempts. Account locked for 15 minutes.')
      } else {
        saveAttempts({ count })
        setError(`${error.message} (${MAX_ATTEMPTS - count} attempt${MAX_ATTEMPTS - count !== 1 ? 's' : ''} remaining)`)
      }
      return
    }

    clearAttempts()
    localStorage.setItem(LAST_EMAIL_KEY, email)
    if (!rememberMe) {
      window.addEventListener('beforeunload', () => { void supabase.auth.signOut() }, { once: true })
    }
  }

  async function handleForgotPassword() {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setResetMsg('Enter your email address above, then click Forgot password.')
      setResetState('error')
      return
    }
    setResetState('sending')
    setResetMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: `${APP_URL}reset-password`,   // opens "Choose a new password" (App.tsx)
    })
    if (error) {
      setResetState('error')
      setResetMsg(error.message)
    } else {
      setResetState('sent')
      toast.success(`Password reset email sent to ${trimmedEmail}. Check your inbox.`)
    }
  }

  const lockText = `Too many failed attempts. Try again in ${Math.ceil(lockRemaining / 60000)}m ${Math.ceil((lockRemaining % 60000) / 1000)}s.`

  return (
    <AuthLayout
      brand="YVA Staffing"
      title="Sign in"
      sub="Welcome back. Sign in to YVA OS to continue."
      foot="Access is by invitation only. Contact your administrator."
    >
      <form className="set-auth__form" onSubmit={handleSubmit}>
        <Field label="Email address">
          <input className="input" type="email" autoComplete="username" value={email}
            onChange={e => setEmail(e.target.value)} placeholder="you@yvastaffing.net" required autoFocus />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
        </Field>

        <div className="set-auth__row">
          <Checkbox checked={rememberMe} onChange={setRememberMe} label="Keep me signed in" />
          <button type="button" className="link" disabled={resetState === 'sending'} onClick={() => void handleForgotPassword()}>
            {resetState === 'sending' ? 'Sending…' : 'Forgot password?'}
          </button>
        </div>

        {resetMsg && <Banner tone="danger">{resetMsg}</Banner>}
        {lockRemaining > 0 && <Banner tone="danger">{lockText}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}

        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={loading || lockRemaining > 0}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  )
}
