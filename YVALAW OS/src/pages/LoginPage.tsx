import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '20px',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* Background accent */}
      <div style={{
        position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)',
          width: 600, height: 600,
          background: 'radial-gradient(ellipse, rgba(250,204,21,0.08) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        {/* Logo / brand */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'var(--gold)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 8px 32px rgba(250,204,21,0.3)',
          }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#1b1e2b' }}>Y</span>
          </div>
          <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)', letterSpacing: '-.02em' }}>
            YVA Staffing
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 5 }}>
            Sign in to continue
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 24,
          padding: '36px 32px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 24 }}>
            Sign in to your account
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Email address</label>
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yvastaffing.net"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
              Keep me signed in
            </label>

            {lockRemaining > 0 && (
              <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f87171' }}>
                Too many failed attempts. Try again in {Math.ceil(lockRemaining / 60000)}m {Math.ceil((lockRemaining % 60000) / 1000)}s.
              </div>
            )}

            {error && (
              <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f87171' }}>
                {error}
              </div>
            )}

            <button
              className="btn-primary"
              type="submit"
              disabled={loading || lockRemaining > 0}
              style={{ marginTop: 4, width: '100%', justifyContent: 'center', padding: '12px 20px', fontSize: 14, fontWeight: 800 }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--muted)' }}>
          Access is by invitation only. Contact your administrator.
        </div>
      </div>
    </div>
  )
}
