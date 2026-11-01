import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { exchangeCode } from '../services/gmail'
import { loadSettings } from '../services/storage'
import { Ic, P } from '../components/Icon'
import AuthLayout from '../components/settings/AuthLayout'

const BACK = '/settings?tab=integrations'
type Step = 'google' | 'exchange' | 'done'

export default function OAuthCallbackPage() {
  const navigate = useNavigate()
  const [msg, setMsg]   = useState('Connecting Gmail…')
  const [ok,  setOk]    = useState<boolean | null>(null)
  const [step, setStep] = useState<Step>('google')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code   = params.get('code')
    const error  = params.get('error')

    if (error) {
      setMsg(`Google returned an error: ${error}`)
      setOk(false)
      setTimeout(() => navigate(BACK), 3000)
      return
    }
    if (!code) {
      setMsg('No authorization code received.')
      setOk(false)
      setTimeout(() => navigate(BACK), 3000)
      return
    }

    void (async () => {
      setStep('exchange')
      const settings = await loadSettings()
      const clientId = settings.gmailClientId
      if (!clientId) {
        setMsg('Gmail Client ID not found in settings.')
        setOk(false)
        setTimeout(() => navigate(BACK), 3000)
        return
      }
      try {
        const email = await exchangeCode(code, clientId)
        setStep('done')
        setMsg(`Connected as ${email}`)
        setOk(true)
        setTimeout(() => navigate(BACK), 1500)
      } catch (err) {
        setMsg(`Connection failed: ${(err as Error).message}`)
        setOk(false)
        setTimeout(() => navigate(BACK), 4000)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stepClass = (s: Step) => {
    const order: Step[] = ['google', 'exchange', 'done']
    const i = order.indexOf(s), cur = order.indexOf(step)
    if (ok === false && i === cur) return 'set-step set-step--fail'
    if (i < cur || (ok === true && i <= cur)) return 'set-step set-step--done'
    if (i === cur && ok === null) return 'set-step set-step--now'
    return 'set-step'
  }
  const dot = (s: Step) => {
    const c = stepClass(s)
    return <span className="set-step__dot">{c.includes('done') ? <Ic d={P.check} size={12} stroke={3} /> : c.includes('fail') ? <Ic d={P.x} size={12} stroke={3} /> : null}</span>
  }

  return (
    <AuthLayout
      center
      title={ok === true ? 'Gmail connected' : ok === false ? 'Gmail not connected' : 'Connecting Gmail…'}
      sub="Redirecting to Settings…"
      icon={ok === null
        ? <span className="set-spinner" role="status" aria-label="Connecting" />
        : <span className={`set-auth__icon set-auth__icon--${ok ? 'ok' : 'bad'}`}><Ic d={ok ? P.check : P.x} size={24} stroke={2.4} /></span>}
    >
      <div className="set-steps">
        <div className={stepClass('google')}>{dot('google')} Google sign-in</div>
        <div className={stepClass('exchange')}>{dot('exchange')} Saving the connection to your account</div>
        <div className={stepClass('done')}>{dot('done')} Ready to send email</div>
      </div>
      <div className={`banner banner--${ok === false ? 'danger' : ok === true ? 'success' : 'info'}`} role={ok === false ? 'alert' : 'status'}>
        <div className="banner__body">{msg}</div>
      </div>
      <button className="btn btn--block" onClick={() => navigate(BACK)}>Back to Settings</button>
    </AuthLayout>
  )
}
