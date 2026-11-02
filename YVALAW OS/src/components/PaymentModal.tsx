/**
 * PaymentModal — client portal "Pay" (2026-11): card or US bank account (ACH) through Stripe's Payment Element.
 *
 *  1. Opens → create-payment-intent (server works out the balance; reuses this login's open payment)
 *  2. Saved methods (card / bank) as options, or the Payment Element for a new one (Stripe shows the bank
 *     authorization text for ACH and handles card security checks)
 *  3. "Save and turn on AutoPay" is off by default; ticking it updates the same payment so Stripe saves the
 *     method, then AutoPay is switched on with that method (server checks it belongs to this login)
 *  4. Card → paid now; bank → "on its way" (about 4 business days). The invoice is marked paid by the webhook.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadStripe } from '@stripe/stripe-js/pure'   // 'pure' = no script until loadStripe() is called
import type { PaymentIntent, Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js'
import { supabase } from '../lib/supabase'
import type { Invoice } from '../data/types'
import { savePortalAutoPaySettings, type SavedMethod } from '../services/portalStorage'
import { Ic, P } from './Icon'

// Stripe's script is loaded the first time a payment window opens — staff never need it
let stripePromise: ReturnType<typeof loadStripe> | null = null
export const getStripe = () => (stripePromise ??= loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string))

export const STRIPE_APPEARANCE = {
  theme: 'stripe' as const,
  variables: { colorPrimary: '#1b1e2b', colorText: '#111827', colorDanger: '#b91c1c', fontFamily: 'Geist, system-ui, -apple-system, sans-serif', borderRadius: '8px' },
}

type Step = 'loading' | 'form' | 'success' | 'processing' | 'error'

interface Props {
  invoice: Invoice
  clientId: string
  clientName?: string
  onClose: () => void
  onSuccess: (paidAmount: number, options?: { processing?: boolean; autoPayEnabled?: boolean; method?: SavedMethod | null }) => void
}

const fmtUSD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
export function methodLabel(m: Pick<SavedMethod, 'type' | 'brand' | 'last4' | 'bankName'>) {
  if (m.type === 'us_bank_account') return `${m.bankName || 'Bank account'} •• ${m.last4}`
  const b = (m.brand || 'card').toLowerCase()
  const name = ({ visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover' } as Record<string, string>)[b] ?? 'Card'
  return `${name} •• ${m.last4}`
}

async function startPayment(invoiceId: string, clientId: string, amountCents: number, savePaymentMethod: boolean) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Please sign in again.')
  const res = await fetch('/.netlify/functions/create-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ invoiceId, clientId, amountCents, savePaymentMethod }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.clientSecret) throw new Error(data.error || 'Could not start the payment.')
  return data as { clientSecret: string; paymentIntentId: string; amountCents: number; savedMethods: SavedMethod[] }
}

export default function PaymentModal({ invoice, clientId, clientName, onClose, onSuccess }: Props) {
  const amountToPay = Math.max(0, (Number(invoice.subtotal) || 0) - (Number(invoice.amountPaid) || 0))
  const amountCents = Math.round(amountToPay * 100)

  const [step, setStep] = useState<Step>('loading')
  const [stripeObj, setStripeObj] = useState<Stripe | null>(null)
  const [clientSecret, setClientSecret] = useState('')
  const [savedMethods, setSavedMethods] = useState<SavedMethod[]>([])
  const [selected, setSelected] = useState<'new' | string>('new')
  const [errorMsg, setErrorMsg] = useState('')
  const [paidAmount, setPaidAmount] = useState(amountToPay)
  const [elementReady, setElementReady] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [autoPayConsent, setAutoPayConsent] = useState(false)
  const [successNote, setSuccessNote] = useState('')

  const mountRef = useRef<HTMLDivElement>(null)
  const elementsRef = useRef<StripeElements | null>(null)
  const paymentElRef = useRef<StripePaymentElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await startPayment(invoice.id, clientId, amountCents, false)
        const stripe = await getStripe()
        if (!stripe) throw new Error('Stripe failed to load. Please refresh and try again.')
        if (cancelled) return
        setClientSecret(data.clientSecret)
        setSavedMethods(data.savedMethods || [])
        setStripeObj(stripe)
        setSelected(data.savedMethods?.[0]?.id ?? 'new')
        setStep('form')
      } catch (err) {
        if (!cancelled) { setErrorMsg(err instanceof Error ? err.message : 'Could not load the payment form.'); setStep('error') }
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The Payment Element (new card or bank account)
  useEffect(() => {
    if (step !== 'form' || selected !== 'new' || !stripeObj || !clientSecret || !mountRef.current) { setElementReady(selected !== 'new'); return }
    const elements = stripeObj.elements({ clientSecret, appearance: STRIPE_APPEARANCE })
    const el = elements.create('payment', { layout: 'tabs', defaultValues: { billingDetails: { name: clientName || invoice.clientName || '' } } })
    el.on('ready', () => setElementReady(true))
    el.mount(mountRef.current)
    elementsRef.current = elements
    paymentElRef.current = el
    return () => { setElementReady(false); el.destroy(); elementsRef.current = null; paymentElRef.current = null }
  }, [step, selected, stripeObj, clientSecret, clientName, invoice.clientName])

  // Ticking "save" updates the same payment so Stripe saves the method when it's confirmed
  async function toggleConsent(on: boolean) {
    setAutoPayConsent(on)
    if (selected !== 'new') return   // a saved method is already saved
    setUpdating(true); setErrorMsg('')
    try {
      await startPayment(invoice.id, clientId, amountCents, on)
      await elementsRef.current?.fetchUpdates()
    } catch (err) {
      setAutoPayConsent(!on)
      setErrorMsg(err instanceof Error ? err.message : 'Could not update the payment.')
    } finally { setUpdating(false) }
  }

  async function handlePay() {
    if (!stripeObj || !clientSecret || isProcessing || updating) return
    setIsProcessing(true); setErrorMsg('')
    try {
      let pi: PaymentIntent | undefined
      const saved = savedMethods.find(m => m.id === selected)
      if (selected === 'new') {
        if (!elementsRef.current || !elementReady) throw new Error('The payment form is still loading.')
        const r = await stripeObj.confirmPayment({ elements: elementsRef.current, redirect: 'if_required', confirmParams: { return_url: window.location.href } })
        if (r.error) throw new Error(r.error.message || 'Payment failed')
        pi = r.paymentIntent
      } else if (saved?.type === 'us_bank_account') {
        const r = await stripeObj.confirmUsBankAccountPayment(clientSecret, { payment_method: saved.id })
        if (r.error) throw new Error(r.error.message || 'Payment failed')
        pi = r.paymentIntent
      } else {
        const r = await stripeObj.confirmCardPayment(clientSecret, { payment_method: selected })
        if (r.error) throw new Error(r.error.message || 'Payment failed')
        pi = r.paymentIntent
      }
      if (!pi || (pi.status !== 'succeeded' && pi.status !== 'processing')) throw new Error(`The payment was not completed (${pi?.status ?? 'unknown'}).`)

      const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id
      let autoPayEnabled = false
      let method: SavedMethod | null = saved ?? null
      if (autoPayConsent && pmId) {
        try {
          const r = await savePortalAutoPaySettings({ clientId, enabled: true, paymentMethodId: pmId })
          autoPayEnabled = true
          method = r.method ?? method
          setSuccessNote('AutoPay is on: future invoices are charged to this payment method on their due date. You can turn it off in Billing.')
        } catch (e) {
          setSuccessNote(`Your payment went through, but AutoPay could not be turned on: ${(e as Error).message}`)
        }
      }
      const paid = (pi.amount ?? amountCents) / 100
      setPaidAmount(paid)
      setStep(pi.status === 'processing' ? 'processing' : 'success')
      setIsProcessing(false)
      onSuccess(paid, { processing: pi.status === 'processing', autoPayEnabled, method })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed. Please try again.')
      setIsProcessing(false)
    }
  }

  const processingRef = useRef(isProcessing)
  processingRef.current = isProcessing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !processingRef.current) onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const sub = [fmtUSD(amountToPay), clientName || invoice.clientName].filter(Boolean).join(' · ')
  const savedSel = savedMethods.find(m => m.id === selected)
  const ready = selected === 'new' ? elementReady : true

  return createPortal(
    <>
      <div className="scrim por-scrim" onClick={isProcessing ? undefined : onClose} />
      <div className="modal-x por-pay" role="dialog" aria-modal="true" aria-label={`Pay ${invoice.number}`}>
        <div className="modal-x__head">
          <div className="por-pay__titles">
            <h2 className="modal-x__title por-pay__title">Pay <span className="mono">{invoice.number}</span></h2>
            <div className="modal-x__sub por-pay__sub">{sub}</div>
          </div>
          {!isProcessing && <button type="button" className="x-close" onClick={onClose} aria-label="Close"><Ic d={P.x} /></button>}
        </div>

        {step === 'loading' && (
          <div className="por-pay__state">
            <span className="por-pay__spin"><Ic d={P.refresh} size={20} /></span>
            <span className="muted">Preparing secure checkout…</span>
          </div>
        )}

        {step === 'error' && (
          <div className="por-pay__state">
            <span className="por-pay__icon por-pay__icon--err"><Ic d={P.alert} size={24} /></span>
            <span className="por-pay__state-title">Could not load the payment form</span>
            <span className="t-danger">{errorMsg}</span>
            <button type="button" className="btn btn--block por-btn-lg" onClick={onClose}>Close</button>
          </div>
        )}

        {(step === 'success' || step === 'processing') && (
          <div className="por-pay__state">
            <span className="por-pay__icon por-pay__icon--ok"><Ic d={P.check} size={24} stroke={2.4} /></span>
            <span className="por-pay__state-title">{step === 'success' ? 'Payment received' : 'Bank payment started'}</span>
            <span className="muted">
              {step === 'success'
                ? <>{fmtUSD(paidAmount)} received for invoice {invoice.number}. Thank you!</>
                : <>{fmtUSD(paidAmount)} is on its way from your bank account. Bank payments take about 4 business days; the invoice shows as paid once it clears.</>}
            </span>
            {successNote && <div className={`banner ${successNote.startsWith('AutoPay is on') ? 'banner--success' : 'banner--warning'} por-pay__note`}>{successNote}</div>}
            <button type="button" className="btn btn--primary btn--block por-btn-lg" onClick={onClose}>Done</button>
          </div>
        )}

        {step === 'form' && (
          <>
            <div className={`modal-x__body por-pay__body${isProcessing ? ' por-pay__body--busy' : ''}`}>
              {savedMethods.length > 0 && (
                <div className="por-pay__methods" role="radiogroup" aria-label="Payment method">
                  <span className="field__label">Payment method</span>
                  {savedMethods.map(m => (
                    <label key={m.id} className={`por-pay__method${selected === m.id ? ' por-pay__method--on' : ''}`}>
                      <input type="radio" name="payment-method" value={m.id} checked={selected === m.id} onChange={() => setSelected(m.id)} />
                      <span className="por-pay__method-text">
                        <span className="por-pay__method-name">{methodLabel(m)}</span>
                        {m.type === 'card' && m.expMonth && m.expYear
                          ? <span className="por-pay__method-exp">Expires {String(m.expMonth).padStart(2, '0')}/{String(m.expYear).slice(-2)}</span>
                          : m.type === 'us_bank_account' ? <span className="por-pay__method-exp">Bank account (ACH)</span> : null}
                      </span>
                    </label>
                  ))}
                  <label className={`por-pay__method${selected === 'new' ? ' por-pay__method--on' : ''}`}>
                    <input type="radio" name="payment-method" value="new" checked={selected === 'new'} onChange={() => setSelected('new')} />
                    <span className="por-pay__method-name">+ Use a different card or bank account</span>
                  </label>
                </div>
              )}

              {selected === 'new' && <div ref={mountRef} className="por-pay__element" data-testid="stripe-payment-element" />}
              {savedSel?.type === 'us_bank_account' && (
                <p className="por-pay__fine">By paying, you authorize YVA Staffing to debit {fmtUSD(amountToPay)} from this bank account for invoice {invoice.number}. Bank payments take about 4 business days.</p>
              )}

              <label className="por-pay__consent">
                <input type="checkbox" checked={autoPayConsent} disabled={updating} onChange={e => void toggleConsent(e.target.checked)} />
                <span className="check__box por-pay__box" aria-hidden>{autoPayConsent && <Ic d={P.check} size={12} stroke={3} />}</span>
                <span>{selected === 'new' ? 'Save this payment method and turn on AutoPay. ' : 'Turn on AutoPay with this payment method. '}I authorize YVA Staffing to charge future invoices on their due date. I can turn AutoPay off any time in Billing.</span>
              </label>

              {errorMsg && <div className="banner banner--danger" role="alert">{errorMsg}</div>}
              <span className="por-pay__secure"><Ic d={P.lock} size={12} />Payments processed securely by Stripe — YVA never sees your card or bank details</span>
            </div>
            <div className="por-pay__foot">
              <button type="button" className="btn por-btn-lg" onClick={onClose} disabled={isProcessing}>Cancel</button>
              <button type="button" className="btn btn--primary por-btn-lg por-pay__go" onClick={() => void handlePay()} disabled={isProcessing || updating || !ready}>
                {isProcessing ? 'Processing…' : !ready ? 'Loading…' : `Pay ${fmtUSD(amountToPay)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
