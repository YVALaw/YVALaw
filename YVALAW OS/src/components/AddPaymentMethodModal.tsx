/**
 * Portal → Billing → "Add card or bank account" (2026-11). A Stripe SetupIntent: nothing is charged.
 * With the AutoPay box ticked the client authorizes future charges; the method is stored by
 * update-autopay-settings (checks it belongs to this login) and by the webhook as a backup.
 */
import { useEffect, useRef, useState } from 'react'
import type { Stripe, StripeElements } from '@stripe/stripe-js'
import { savePortalAutoPaySettings, startPortalSetup, type SavedMethod } from '../services/portalStorage'
import { getStripe, STRIPE_APPEARANCE } from './PaymentModal'
import { Banner, Modal } from './ui'
import { Ic, P } from './Icon'

export default function AddPaymentMethodModal({ clientId, autopayDefault, onClose, onSaved }: {
  clientId: string; autopayDefault: boolean; onClose: () => void; onSaved: (r: { method: SavedMethod | null; autoPayEnabled: boolean }) => void
}) {
  const [autopay, setAutopay] = useState(autopayDefault)
  const [phase, setPhase] = useState<'loading' | 'form' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const stripeRef = useRef<Stripe | null>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const [secret, setSecret] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [cs, stripe] = await Promise.all([startPortalSetup(clientId, autopayDefault), getStripe()])
        if (!stripe) throw new Error('Stripe failed to load. Please refresh and try again.')
        if (cancelled) return
        stripeRef.current = stripe
        setSecret(cs)
        setPhase('form')
      } catch (e) { if (!cancelled) { setError((e as Error).message); setPhase('error') } }
    })()
    return () => { cancelled = true }
  }, [clientId, autopayDefault])

  useEffect(() => {
    if (!secret || !stripeRef.current || !mountRef.current) return
    const elements = stripeRef.current.elements({ clientSecret: secret, appearance: STRIPE_APPEARANCE })
    const el = elements.create('payment', { layout: 'tabs' })
    el.on('ready', () => setReady(true))
    el.mount(mountRef.current)
    elementsRef.current = elements
    return () => { el.destroy(); elementsRef.current = null }
  }, [secret])

  async function save() {
    if (!stripeRef.current || !elementsRef.current) return
    setPhase('saving'); setError('')
    try {
      const r = await stripeRef.current.confirmSetup({ elements: elementsRef.current, redirect: 'if_required', confirmParams: { return_url: window.location.href } })
      if (r.error) throw new Error(r.error.message || 'Could not save the payment method.')
      const pm = r.setupIntent?.payment_method
      const pmId = typeof pm === 'string' ? pm : pm?.id
      if (!pmId) throw new Error('Stripe did not return the saved payment method.')
      const saved = await savePortalAutoPaySettings(autopay ? { clientId, enabled: true, paymentMethodId: pmId } : { clientId, saveOnly: true, paymentMethodId: pmId })
      onSaved({ method: saved.method ?? null, autoPayEnabled: saved.autoPayEnabled })
    } catch (e) { setError((e as Error).message); setPhase('form') }
  }

  return (
    <Modal open onClose={phase === 'saving' ? () => {} : onClose} title="Add card or bank account" sub="Nothing is charged now"
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={phase === 'saving'}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={phase !== 'form' || !ready}>{phase === 'saving' ? 'Saving…' : 'Save'}</button>
      </>}>
      {phase === 'loading' && <div className="muted">Preparing secure form…</div>}
      {error && <Banner tone="danger">{error}</Banner>}
      {(phase === 'form' || phase === 'saving') && <div ref={mountRef} className="por-pay__element" data-testid="stripe-setup-element" />}
      {phase !== 'error' && (
        <label className="por-pay__consent">
          <input type="checkbox" checked={autopay} onChange={e => setAutopay(e.target.checked)} disabled={phase === 'saving'} />
          <span className="check__box por-pay__box" aria-hidden>{autopay && <Ic d={P.check} size={12} stroke={3} />}</span>
          <span>Turn on AutoPay. I authorize YVA Staffing to charge future invoices to this payment method on their due date. I can turn AutoPay off any time in Billing.</span>
        </label>
      )}
      <span className="por-pay__secure"><Ic d={P.lock} size={12} />Saved securely by Stripe — YVA never sees your card or bank details</span>
    </Modal>
  )
}
