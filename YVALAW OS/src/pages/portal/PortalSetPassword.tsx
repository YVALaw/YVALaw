import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Ic, P } from '../../components/Icon'

/** Password screen — first login (portal clients, invited employees) and "Forgot password" / new sign-in links */
export default function PortalSetPassword({ title = 'Welcome to YVA Portal', next = '/portal/dashboard', subtitle = 'Set your password to activate your account' }: {
  title?: string; next?: string; subtitle?: string
}) {
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
  const score      = [hasLength, hasUpper, hasNumber].filter(Boolean).length

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

    navigate(next, { replace: true })
  }

  return (
    <div className="por-auth">
      <div className="por-auth__box">
        <div className="por-auth__brand">
          <img className="por-auth__logo" src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <h1 className="por-auth__title">{title}</h1>
          <p className="por-auth__sub">{subtitle}</p>
        </div>

        <form className="card por-auth__card" onSubmit={handleSubmit}>
          <div className="por-auth__head">
            <h2 className="por-card__title">Create your password</h2>
            <p className="por-card__sub">Choose a strong password you&apos;ll remember.</p>
          </div>

          <label className="field">
            <span className="field__label">New password</span>
            <input className="input por-input-lg" type="password" value={password} onChange={e => setPass(e.target.value)} placeholder="••••••••" autoComplete="new-password" required autoFocus />
            {password.length > 0 && (
              <>
                <span className={`por-strength por-strength--${score}`} aria-hidden><i /><i /><i /></span>
                <span className="por-rules">
                  {[{ ok: hasLength, label: '8+ chars' }, { ok: hasUpper, label: 'Uppercase' }, { ok: hasNumber, label: 'Number' }].map(({ ok, label }) => (
                    <span key={label} className={`por-rule${ok ? ' por-rule--ok' : ''}`}>
                      {ok ? <Ic d={P.check} size={12} stroke={2.6} /> : <span className="por-rule__dot" />} {label}
                    </span>
                  ))}
                </span>
              </>
            )}
          </label>

          <label className="field">
            <span className="field__label">Confirm password</span>
            <input className={`input por-input-lg${confirm.length > 0 && !matches ? ' input--invalid' : ''}`} type="password" value={confirm} onChange={e => setConf(e.target.value)} placeholder="••••••••" autoComplete="new-password" required />
            {confirm.length > 0 && !matches && <span className="field__error">Passwords do not match</span>}
            {matches && <span className="field__hint t-success por-rule--ok"><Ic d={P.check} size={11} stroke={2.6} /> Passwords match</span>}
          </label>

          {error && <div className="banner banner--danger" role="alert">{error}</div>}

          <button className="btn btn--primary btn--block por-btn-lg" type="submit" disabled={loading || !strong || !matches}>
            {loading ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>

        <p className="por-auth__foot">Questions? Contact your YVA account manager.</p>
      </div>
    </div>
  )
}
