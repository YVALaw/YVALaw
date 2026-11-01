/**
 * PaymentModal
 * Stripe-powered payment modal for the client portal.
 *
 * Flow:
 *  1. Opens → fetches PaymentIntent from Netlify function
 *  2. Loads Stripe.js, mounts Card Element
 *  3. Saved cards shown as radio options (if client has paid before)
 *  4. Client confirms payment → success / error state
 *  5. onSuccess(paidAmount) called → parent updates invoice list
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadStripe } from '@stripe/stripe-js'
import type { Stripe, StripeCardElement, StripeElements } from '@stripe/stripe-js'
import { supabase } from '../lib/supabase'
import type { Invoice } from '../data/types'
import { savePortalAutoPaySettings } from '../services/portalStorage'
import { Ic, P } from './Icon'

// Initialise Stripe once at module level — not inside component
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string)

// ── Types ─────────────────────────────────────────────────────────────────────

type SavedCard = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

type Step = 'loading' | 'form' | 'success' | 'error'

interface Props {
  invoice: Invoice
  clientId: string
  /** Shown under the title ("$3,120.00 · Harbor Dental Group") */
  clientName?: string
  onClose: () => void
  onSuccess: (paidAmount: number, options?: {
    autoPayEnabled?: boolean
    paymentMethodId?: string
    card?: SavedCard
  }) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function brandIcon(brand: string) {
  switch (brand.toLowerCase()) {
    case 'visa':       return 'Visa'
    case 'mastercard': return 'Mastercard'
    case 'amex':       return 'Amex'
    case 'discover':   return 'Discover'
    default:           return 'Card'
  }
}

// ── Card Element style ────────────────────────────────────────────────────────

const CARD_STYLE = {
  base: {
    color: '#111827',
    fontFamily: 'Geist, system-ui, -apple-system, sans-serif',
    fontSize: '15px',
    fontWeight: '500',
    '::placeholder': { color: '#9ca3af' },
    iconColor: '#6b7280',
  },
  invalid: {
    color: '#b91c1c',
    iconColor: '#b91c1c',
  },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PaymentModal({ invoice, clientId, clientName, onClose, onSuccess }: Props) {
  const amountToPay = (Number(invoice.subtotal) || 0) - (Number(invoice.amountPaid) || 0)
  const amountCents = Math.round(amountToPay * 100)

  const [step,           setStep]           = useState<Step>('loading')
  const [stripeObj,      setStripeObj]      = useState<Stripe | null>(null)
  const [clientSecret,   setClientSecret]   = useState('')
  const [savedMethods,   setSavedMethods]   = useState<SavedCard[]>([])
  const [selectedMethod, setSelectedMethod] = useState<'new' | string>('new')
  const [errorMsg,       setErrorMsg]       = useState('')
  const [paidAmount,     setPaidAmount]     = useState(amountToPay)
  const [cardReady,      setCardReady]      = useState(false)
  const [isProcessing,   setIsProcessing]   = useState(false)
  const [billingName,    setBillingName]    = useState(invoice.clientName ?? '')
  const [billingPostal,  setBillingPostal]  = useState('')
  const [autoPayConsent, setAutoPayConsent] = useState(false)
  const [successNote,    setSuccessNote]    = useState('')

  const cardMountRef = useRef<HTMLDivElement>(null)
  const cardElemRef  = useRef<StripeCardElement | null>(null)
  const elementsRef  = useRef<StripeElements | null>(null)

  // ── Init: fetch PaymentIntent + load Stripe ─────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('Not authenticated')

        const res = await fetch('/.netlify/functions/create-payment-intent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ invoiceId: invoice.id, clientId, amountCents }),
        })

        const data = await res.json()
        if (!res.ok || !data.clientSecret) {
          throw new Error(data.error || 'Failed to initialise payment')
        }

        const stripe = await stripePromise
        if (!stripe) throw new Error('Stripe failed to load. Check your publishable key.')

        if (cancelled) return

        setClientSecret(data.clientSecret)
        setSavedMethods(data.savedMethods || [])
        setStripeObj(stripe)
        // Default to first saved card if available, otherwise new
        setSelectedMethod(data.savedMethods?.length > 0 ? data.savedMethods[0].id : 'new')
        setStep('form')
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load payment form')
          setStep('error')
        }
      }
    }

    void init()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Mount / unmount Stripe Card Element when "new card" selected ─────────────
  useEffect(() => {
    setCardReady(selectedMethod !== 'new')
    if (step !== 'form' || selectedMethod !== 'new' || !stripeObj) return
    if (!cardMountRef.current) return

    const elements = stripeObj.elements()
    const card = elements.create('card', {
      style:          CARD_STYLE,
      hidePostalCode: true,
    })
    card.on('ready', () => setCardReady(true))
    card.mount(cardMountRef.current)
    elementsRef.current = elements
    cardElemRef.current = card

    return () => {
      setCardReady(false)
      card.destroy()
      cardElemRef.current = null
      elementsRef.current = null
    }
  }, [step, selectedMethod, stripeObj])

  // ── Confirm payment ──────────────────────────────────────────────────────────
  async function handlePay() {
    if (!stripeObj || !clientSecret || step !== 'form' || isProcessing) return
    if (selectedMethod === 'new') {
      if (!billingName.trim()) { setErrorMsg('Enter the cardholder name.'); return }
      if (!billingPostal.trim()) { setErrorMsg('Enter the billing ZIP/postal code.'); return }
    }
    setIsProcessing(true)
    setErrorMsg('')

    try {
      let result

      if (selectedMethod === 'new') {
        if (!cardElemRef.current || !cardReady) throw new Error('Card form is still loading. Please try again in a moment.')
        result = await stripeObj.confirmCardPayment(clientSecret, {
          payment_method: {
            card: cardElemRef.current,
            billing_details: {
              name: billingName.trim(),
              address: {
                postal_code: billingPostal.trim(),
              },
            },
          },
        })
      } else {
        // Pay with saved card
        result = await stripeObj.confirmCardPayment(clientSecret, {
          payment_method: selectedMethod,
        })
      }

      if (result.error) {
        throw new Error(result.error.message || 'Payment failed')
      }

      if (result.paymentIntent?.status === 'succeeded') {
        const paid = (result.paymentIntent.amount ?? amountCents) / 100
        const paymentMethodId = typeof result.paymentIntent.payment_method === 'string'
          ? result.paymentIntent.payment_method
          : selectedMethod !== 'new'
            ? selectedMethod
            : undefined
        let selectedSavedCard = selectedMethod !== 'new'
          ? savedMethods.find(card => card.id === selectedMethod)
          : undefined

        let autoPayEnabled = false
        if (autoPayConsent) {
          if (paymentMethodId) {
            try {
              const saved = await savePortalAutoPaySettings({
                clientId,
                enabled: true,
                paymentMethodId,
                cardBrand: selectedSavedCard?.brand,
                cardLast4: selectedSavedCard?.last4,
                cardExpMonth: selectedSavedCard?.expMonth,
                cardExpYear: selectedSavedCard?.expYear,
              })
              if (!selectedSavedCard && saved.card) {
                selectedSavedCard = {
                  id: paymentMethodId,
                  brand: saved.card.brand,
                  last4: saved.card.last4,
                  expMonth: saved.card.expMonth,
                  expYear: saved.card.expYear,
                }
              }
              autoPayEnabled = true
              setSuccessNote('AutoPay is now enabled for future due invoices. You can turn it off from Billing.')
            } catch (autoPayErr) {
              console.error('AutoPay enable failed:', autoPayErr)
              setSuccessNote('Payment succeeded, but AutoPay could not be enabled. Please try again on your next payment.')
            }
          } else {
            setSuccessNote('Payment succeeded, but Stripe did not return a reusable card for AutoPay.')
          }
        } else {
          setSuccessNote('')
        }

        setPaidAmount(paid)
        setStep('success')
        setIsProcessing(false)
        onSuccess(paid, { autoPayEnabled, paymentMethodId, card: selectedSavedCard })
      } else {
        throw new Error(`Unexpected payment status: ${result.paymentIntent?.status}`)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed. Please try again.')
      setIsProcessing(false)
    }
  }

  // Esc closes (not while a payment is being processed); the page behind doesn't scroll
  const processingRef = useRef(isProcessing)
  processingRef.current = isProcessing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !processingRef.current) onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  // ── Render ───────────────────────────────────────────────────────────────────

  const sub = [fmtUSD(amountToPay), clientName || invoice.clientName].filter(Boolean).join(' · ')

  return createPortal(
    <>
      <div className="scrim por-scrim" onClick={isProcessing ? undefined : onClose} />
      <div className="modal-x por-pay" role="dialog" aria-modal="true" aria-label={`Pay ${invoice.number}`}>
        <div className="modal-x__head">
          <div className="por-pay__titles">
            <h2 className="modal-x__title por-pay__title">Pay <span className="mono">{invoice.number}</span></h2>
            <div className="modal-x__sub por-pay__sub">{sub}</div>
          </div>
          {!isProcessing && (
            <button type="button" className="x-close" onClick={onClose} aria-label="Close"><Ic d={P.x} /></button>
          )}
        </div>

        {/* Loading */}
        {step === 'loading' && (
          <div className="por-pay__state">
            <span className="por-pay__spin"><Ic d={P.refresh} size={20} /></span>
            <span className="muted">Preparing secure checkout…</span>
          </div>
        )}

        {/* Error (init failed) */}
        {step === 'error' && (
          <div className="por-pay__state">
            <span className="por-pay__icon por-pay__icon--err"><Ic d={P.alert} size={24} /></span>
            <span className="por-pay__state-title">Could not load payment form</span>
            <span className="t-danger">{errorMsg}</span>
            <button type="button" className="btn btn--block por-btn-lg" onClick={onClose}>Close</button>
          </div>
        )}

        {/* Success */}
        {step === 'success' && (
          <div className="por-pay__state">
            <span className="por-pay__icon por-pay__icon--ok"><Ic d={P.check} size={24} stroke={2.4} /></span>
            <span className="por-pay__state-title">Payment received</span>
            <span className="muted">{fmtUSD(paidAmount)} received. Invoice #{invoice.number} has been marked paid.</span>
            {successNote && (
              <div className={`banner ${successNote.startsWith('AutoPay') ? 'banner--success' : 'banner--warning'} por-pay__note`}>{successNote}</div>
            )}
            <button type="button" className="btn btn--primary btn--block por-btn-lg" onClick={onClose}>Done</button>
          </div>
        )}

        {/* Payment form — stays mounted while processing so the Card Element keeps its data */}
        {step === 'form' && (
          <>
            <div className={`modal-x__body por-pay__body${isProcessing ? ' por-pay__body--busy' : ''}`}>

              {savedMethods.length > 0 && (
                <div className="por-pay__methods" role="radiogroup" aria-label="Payment method">
                  <span className="field__label">Payment method</span>
                  {savedMethods.map(card => (
                    <label key={card.id} className={`por-pay__method${selectedMethod === card.id ? ' por-pay__method--on' : ''}`}>
                      <input type="radio" name="payment-method" value={card.id} checked={selectedMethod === card.id} onChange={() => setSelectedMethod(card.id)} />
                      <span className="por-pay__method-text">
                        <span className="por-pay__method-name">{brandIcon(card.brand)} •• {card.last4}</span>
                        <span className="por-pay__method-exp">Expires {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}</span>
                      </span>
                    </label>
                  ))}
                  <label className={`por-pay__method${selectedMethod === 'new' ? ' por-pay__method--on' : ''}`}>
                    <input type="radio" name="payment-method" value="new" checked={selectedMethod === 'new'} onChange={() => setSelectedMethod('new')} />
                    <span className="por-pay__method-name">+ Use a different card</span>
                  </label>
                </div>
              )}

              {selectedMethod === 'new' && (
                <>
                  <label className="field">
                    <span className="field__label">Name on card</span>
                    <input className="input por-pay__input" value={billingName} onChange={e => setBillingName(e.target.value)} autoComplete="cc-name" />
                  </label>
                  <label className="field">
                    <span className="field__label">ZIP / postal code</span>
                    <input className="input por-pay__input" value={billingPostal} onChange={e => setBillingPostal(e.target.value)} autoComplete="postal-code" inputMode="text" />
                  </label>
                  <div className="field">
                    <span className="field__label">Card</span>
                    <div ref={cardMountRef} className="por-pay__card" data-testid="stripe-card" />
                  </div>
                </>
              )}

              <label className="por-pay__consent">
                <input type="checkbox" checked={autoPayConsent} onChange={e => setAutoPayConsent(e.target.checked)} />
                <span className="check__box por-pay__box" aria-hidden>{autoPayConsent && <Ic d={P.check} size={12} stroke={3} />}</span>
                <span>Save this card and turn on AutoPay. I authorize YVA Staffing to charge future invoices on their due date. You can turn AutoPay off from Billing.</span>
              </label>

              {errorMsg && <div className="banner banner--danger" role="alert">{errorMsg}</div>}

              <span className="por-pay__secure"><Ic d={P.lock} size={12} />Payments processed securely by Stripe</span>
            </div>
            <div className="por-pay__foot">
              <button type="button" className="btn por-btn-lg" onClick={onClose} disabled={isProcessing}>Cancel</button>
              <button type="button" className="btn btn--primary por-btn-lg por-pay__go" onClick={() => void handlePay()} disabled={isProcessing || !cardReady}>
                {isProcessing ? 'Processing…' : !cardReady ? 'Loading card form…' : `Pay ${fmtUSD(amountToPay)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  )
}
