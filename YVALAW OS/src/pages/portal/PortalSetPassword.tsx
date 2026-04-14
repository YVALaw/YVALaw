import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export default function PortalSetPassword() {
  const navigate              = useNavigate()
  const [password, setPass]   = useState('')
  const [confirm,  setConf]   = useState('')
  const [loading,  setLoading] = useState(false)
  const [error,    setError]  = useState<string | null>(null)

  // Password strength check
  const hasLength  = password.length >= 8
  const hasUpper   = /[A-Z]/.test(password)
  const hasNumber  = /[0-9]/.test(password)
  const strong     = hasLength && hasUpper && hasNumber
  const matches    = password === confirm && confirm.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!strong)    { setError('Password does not meet requirements.'); return }
    if (!matches)   { setError('Passwords do not match.'); return }

    setLoading(true)
    setError(null)

    const { error: pwErr } = await supabase.auth.updateUser({
      password,
      data: { must_change_password: false },
    })

    setLoading(false)

    if (pwErr) {
      setError(pwErr.message)
      return
    }

    navigate('/portal/dashboard', { replace: true })
  }

  function strengthBar() {
    const score = [hasLength, hasUpper, hasNumber].filter(Boolean).length
    const colors = ['#ef4444', '#f97316', '#22c55e']
    return (
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 999,
            background: i < score ? colors[score - 1] : 'var(--border)',
            transition: 'background .3s',
          }} />
        ))}
      </div>
    )
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
      {/* Subtle gold glow */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)',
          width: 600, height: 600,
          background: 'radial-gradient(ellipse, rgba(250,204,21,0.08) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420 }}>
        {/* Logo */}
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
            Welcome to YVA Portal
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 5 }}>
            Set your password to activate your account
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 24,
          padding: '36px 32px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
            Create your password
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>
            Choose a strong password you'll remember.
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="form-group">
              <label className="form-label">New password</label>
              <input
                className="form-input"
                type="password"
                value={password}
                onChange={e => setPass(e.target.value)}
                placeholder="••••••••"
                required
                autoFocus
              />
              {password.length > 0 && (
                <>
                  {strengthBar()}
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                    {[
                      { ok: hasLength, label: '8+ chars'      },
                      { ok: hasUpper,  label: 'Uppercase'      },
                      { ok: hasNumber, label: 'Number'         },
                    ].map(({ ok, label }) => (
                      <span key={label} style={{
                        fontSize: 11, fontWeight: 600,
                        color: ok ? '#15803d' : 'var(--muted)',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {ok ? '✓' : '○'} {label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Confirm password</label>
              <input
                className="form-input"
                type="password"
                value={confirm}
                onChange={e => setConf(e.target.value)}
                placeholder="••••••••"
                required
                style={{ borderColor: confirm.length > 0 ? (matches ? 'var(--success)' : '#ef4444') : undefined }}
              />
              {confirm.length > 0 && !matches && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Passwords do not match</div>
              )}
              {matches && (
                <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>✓ Passwords match</div>
              )}
            </div>

            {error && (
              <div style={{
                background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
                borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#ef4444',
              }}>
                {error}
              </div>
            )}

            <button
              className="btn-primary"
              type="submit"
              disabled={loading || !strong || !matches}
              style={{ marginTop: 4, width: '100%', justifyContent: 'center', padding: '12px 20px', fontSize: 14, fontWeight: 800 }}
            >
              {loading ? 'Saving…' : 'Set password & continue'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--muted)' }}>
          Questions? Contact your YVA account manager.
        </div>
      </div>
    </div>
  )
}
