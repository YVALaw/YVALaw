import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Ic, P } from '../components/Icon'
import AuthLayout from '../components/settings/AuthLayout'
import { Banner, Field } from '../components/ui'

function passwordStrength(pw: string): { score: number; label: string; tone: 'weak' | 'fair' | 'strong' } {
  let score = 0
  if (pw.length >= 8)  score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  if (score <= 1) return { score, label: 'Weak',   tone: 'weak' }
  if (score <= 3) return { score, label: 'Fair',   tone: 'fair' }
  return               { score, label: 'Strong', tone: 'strong' }
}

export default function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signUp({ email, password })
    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
    }
  }

  const strength = password.length > 0 ? passwordStrength(password) : null

  if (success) {
    return (
      <AuthLayout
        center
        icon={<span className="set-auth__icon set-auth__icon--ok"><Ic d={P.check} size={24} stroke={2.4} /></span>}
        title="Account created"
        sub="Your account is waiting for approval. A YVA admin will assign your role before you can use YVA OS."
      >
        <button className="btn btn--primary btn--lg btn--block" onClick={() => navigate('/login')}>Go to sign in</button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      sub="Use the email address YVA invited. A YVA admin approves new accounts and picks your role."
      foot={<button type="button" className="link" onClick={() => navigate('/login')}>Already have an account? Sign in</button>}
    >
      <form className="set-auth__form" onSubmit={handleSubmit}>
        <Field label="Email address">
          <input className="input" type="email" autoComplete="email" value={email}
            onChange={e => setEmail(e.target.value)} placeholder="you@yvastaffing.net" required autoFocus />
        </Field>
        <Field label="Password">
          <input className="input" type="password" autoComplete="new-password" value={password}
            onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required aria-describedby="pw-strength" />
        </Field>
        {strength && (
          <div className="set-strength" id="pw-strength" aria-live="polite">
            <div className="set-strength__bars" aria-hidden>
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} className={`set-strength__bar${i <= strength.score ? ` set-strength__bar--${strength.tone}` : ''}`} />
              ))}
            </div>
            <span className={`set-strength__label set-strength__label--${strength.tone}`}>{strength.label} password</span>
          </div>
        )}

        {error && <Banner tone="danger">{error}</Banner>}

        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  )
}
