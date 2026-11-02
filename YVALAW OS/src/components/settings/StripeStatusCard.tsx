// Settings → Integrations → Stripe (2026-11): keys present and in the SAME mode (test vs live), account able to take
// card and bank payments, webhook events arriving and processed. Facts come from the stripe-status function —
// no key or secret is ever sent to the browser.
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { Ic, P } from '../Icon'
import { dateMed } from '../../utils/format'

type StripeStatus = {
  secretKey: 'live' | 'test' | null; webhookSecret: boolean; failedEvents: number; eventsTable?: boolean; accountError?: string
  account: { id: string; name: string | null; chargesEnabled: boolean; payoutsEnabled: boolean; achEnabled: boolean } | null
  lastEvent: { type: string; livemode: boolean; received_at: string; processed_at: string | null; error: string | null } | null
}
type Tone = 'ok' | 'warn' | 'bad' | 'off'
const Status = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`set-status set-status--${tone}`}>{children}</span>
const Fact = ({ k, v }: { k: string; v: ReactNode }) => <div className="set-int__fact"><span>{k}</span><span>{v}</span></div>

export default function StripeStatusCard() {
  const pk = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) || ''
  const pkMode = pk.startsWith('pk_live') ? 'live' : pk.startsWith('pk_test') ? 'test' : null
  const [s, setS] = useState<StripeStatus | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [last, setLast] = useState<{ at: string; amount: number } | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch('/.netlify/functions/stripe-status', { headers: { Authorization: `Bearer ${session?.access_token ?? ''}` } })
        const data = await res.json().catch(() => ({}))
        if (!alive) return
        if (res.ok) setS(data as StripeStatus); else setErr((data as { error?: string }).error || `Not available (HTTP ${res.status})`)
      } catch { if (alive) setErr('Could not reach the server.') }
    })()
    void supabase.from('client_payments').select('created_at,amount').eq('source', 'stripe').gt('amount', 0).order('created_at', { ascending: false }).limit(1)
      .then(({ data, error }) => { if (alive) setLast(error ? undefined : (data?.[0] ? { at: data[0].created_at as string, amount: Number(data[0].amount) || 0 } : null)) })
    return () => { alive = false }
  }, [])

  const mismatch = !!(s?.secretKey && pkMode && s.secretKey !== pkMode)
  const problems: string[] = []
  if (!pk) problems.push('VITE_STRIPE_PUBLISHABLE_KEY is missing in Netlify (the portal can\'t show the payment form).')
  if (s && !s.secretKey) problems.push('STRIPE_SECRET_KEY is missing in Netlify.')
  if (s && !s.webhookSecret) problems.push('STRIPE_WEBHOOK_SECRET is missing in Netlify — payments would never be recorded.')
  if (mismatch) problems.push(`The publishable key is ${pkMode} but the secret key is ${s!.secretKey}. Use both test keys or both live keys.`)
  if (s?.accountError) problems.push(`Stripe refused the secret key: ${s.accountError}`)
  if (s?.account && !s.account.chargesEnabled) problems.push('Your Stripe account can\'t take payments yet — finish the account setup in Stripe.')
  if (s?.failedEvents) problems.push(`${s.failedEvents} webhook event${s.failedEvents > 1 ? 's' : ''} in the last 7 days could not be recorded yet (Stripe retries automatically). If this stays, check the Netlify function log for stripe-webhook.`)
  if (s?.eventsTable === false) problems.push('Run supabase/migrate-stripe-secure.sql so each Stripe event is recorded once.')
  const mode = s?.secretKey ?? pkMode
  const tone: Tone = !pk && !s?.secretKey ? 'off' : problems.length ? (mismatch || (s && (!s.secretKey || !s.webhookSecret)) ? 'bad' : 'warn') : 'ok'

  return (
    <section className="set-int" aria-label="Stripe">
      <div className="set-int__head">
        <span className="set-int__name"><Ic d={P.card} /> Stripe</span>
        <Status tone={tone}>{tone === 'off' ? 'Not set up' : tone === 'ok' ? `Connected · ${mode === 'live' ? 'Live' : 'Test mode'}` : tone === 'bad' ? 'Needs attention' : `Connected · ${mode === 'live' ? 'Live' : 'Test mode'}`}</Status>
      </div>
      <span className="set-int__desc">Card and US bank (ACH) payments in the client portal and from the “Pay now” link in invoice emails, saved payment methods and AutoPay. The webhook records every payment, refund and dispute.</span>
      <div className="set-int__facts">
        <Fact k="Keys" v={!s ? (err ? '—' : 'Checking…') : `Publishable ${pkMode ?? 'missing'} · secret ${s.secretKey ?? 'missing'}`} />
        <Fact k="Account" v={s?.account ? `${s.account.name || s.account.id} · ${s.account.chargesEnabled ? 'takes payments' : 'not active yet'}${s.account.achEnabled ? ' · bank (ACH) on' : ' · bank (ACH) off'}` : s ? 'Not reachable' : '—'} />
        <Fact k="Webhook" v={!s ? '—' : !s.webhookSecret ? 'Secret missing' : s.lastEvent ? `Last event ${dateMed(s.lastEvent.received_at)}${s.lastEvent.processed_at ? '' : ' (not recorded yet)'}` : 'No events received yet'} />
        <Fact k="Last online payment" v={last === undefined ? '—' : last ? `$${last.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} · ${dateMed(last.at)}` : 'None yet'} />
      </div>
      {err && <span className="set-hint">{err}</span>}
      {problems.length > 0 && <ul className="set-int__problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
      <span className="set-hint">Keys and the webhook secret live in Netlify and are never shown here. Setup steps: SETUP-AFTER-BUILD.md → Stripe.</span>
    </section>
  )
}
