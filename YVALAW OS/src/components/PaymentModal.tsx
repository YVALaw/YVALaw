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
import { loadStripe } from '@stripe/stripe-js'
import type { Stripe, StripeCardElement, StripeElements } from '@stripe/stripe-js'
import { supabase } from '../lib/supabase'
import type { Invoice } from '../data/types'

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

type Step = 'loading' | 'form' | 'processing' | 'success' | 'error'

interface Props {
  invoice: Invoice
  clientId: string
  onClose: () => void
  onSuccess: (paidAmount: number) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function brandIcon(brand: string) {
  switch (brand.toLowerCase()) {
    case 'visa':       return '💳 Visa'
    case 'mastercard': return '💳 Mastercard'
    case 'amex':       return '💳 Amex'
    case 'discover':   return '💳 Discover'
    default:           return '💳 Card'
  }
}

// ── Card Element style ────────────────────────────────────────────────────────

const CARD_STYLE = {
  base: {
    color: '#0f172a',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    fontWeight: '500',
    '::placeholder': { color: '#64748b' },
    iconColor: '#64748b',
  },
  invalid: {
    color: '#ef4444',
    iconColor: '#ef4444',
  },
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PaymentModal({ invoice, clientId, onClose, onSuccess }: Props) {
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
    if (!stripeObj || !clientSecret || step !== 'form') return
    setStep('processing')
    setErrorMsg('')

    try {
      let result

      if (selectedMethod === 'new') {
        if (!cardElemRef.current || !cardReady) throw new Error('Card form is still loading. Please try again in a moment.')
        result = await stripeObj.confirmCardPayment(clientSecret, {
          payment_method: { card: cardElemRef.current },
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
        setPaidAmount(paid)
        setStep('success')
        onSuccess(paid)
      } else {
        throw new Error(`Unexpected payment status: ${result.paymentIntent?.status}`)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed. Please try again.')
      setStep('form')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="modal-overlay"
      onClick={step === 'processing' ? undefined : onClose}
      style={{ zIndex: 300 }}
    >
      <div
        className="modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 460, width: '100%', padding: 0, overflow: 'hidden' }}
      >

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--surf2)',
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>Pay Invoice</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{invoice.number}</div>
          </div>
          {step !== 'processing' && (
            <button
              onClick={onClose}
              className="modal-close btn-icon"
              style={{ flexShrink: 0 }}
            >✕</button>
          )}
        </div>

        {/* ── Amount banner ─────────────────────────────────────────────── */}
        <div style={{
          padding: '16px 24px',
          background: 'linear-gradient(135deg, #0f172a, #1e293b)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Amount Due
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#f5b533', marginTop: 2 }}>
              {fmtUSD(amountToPay)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {invoice.projectName && (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{invoice.projectName}</div>
            )}
            {invoice.dueDate && (
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 3 }}>
                Due {new Date(invoice.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div style={{ padding: '20px 24px' }}>

          {/* Loading */}
          {step === 'loading' && (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)', fontSize: 14 }}>
              <div style={{ marginBottom: 10, opacity: 0.5 }}>🔄</div>
              Preparing secure checkout…
            </div>
          )}

          {/* Error (init failed) */}
          {step === 'error' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>
                Could not load payment form
              </div>
              <div style={{ fontSize: 13, color: '#ef4444', marginBottom: 20 }}>{errorMsg}</div>
              <button
                className="btn-ghost btn-sm"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          )}

          {/* Success */}
          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: 'rgba(34,197,94,.15)', border: '2px solid rgba(34,197,94,.3)',
                display: 'grid', placeItems: 'center', margin: '0 auto 16px',
                fontSize: 28,
              }}>
                ✓
              </div>
              <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)', marginBottom: 6 }}>
                Payment Successful
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                {fmtUSD(paidAmount)} received. Invoice #{invoice.number} has been marked paid.
              </div>
              <button
                className="btn-primary"
                onClick={onClose}
                style={{ fontSize: 13 }}
              >
                Done
              </button>
            </div>
          )}

          {/* Payment form */}
          {(step === 'form' || step === 'processing') && (
            <div style={{ opacity: step === 'processing' ? 0.6 : 1, pointerEvents: step === 'processing' ? 'none' : 'auto' }}>

              {/* Saved cards */}
              {savedMethods.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>
                    PAYMENT METHOD
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {savedMethods.map(card => (
                      <label key={card.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                        border: `1px solid ${selectedMethod === card.id ? 'var(--gold)' : 'var(--border)'}`,
                        background: selectedMethod === card.id ? 'rgba(245,181,51,.06)' : 'var(--surf2)',
                        transition: 'all 0.15s',
                      }}>
                        <input
                          type="radio"
                          name="payment-method"
                          value={card.id}
                          checked={selectedMethod === card.id}
                          onChange={() => setSelectedMethod(card.id)}
                          style={{ accentColor: 'var(--gold)' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                            {brandIcon(card.brand)} •••• {card.last4}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            Expires {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
                          </div>
                        </div>
                      </label>
                    ))}

                    {/* New card option */}
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${selectedMethod === 'new' ? 'var(--gold)' : 'var(--border)'}`,
                      background: selectedMethod === 'new' ? 'rgba(245,181,51,.06)' : 'var(--surf2)',
                      transition: 'all 0.15s',
                    }}>
                      <input
                        type="radio"
                        name="payment-method"
                        value="new"
                        checked={selectedMethod === 'new'}
                        onChange={() => setSelectedMethod('new')}
                        style={{ accentColor: 'var(--gold)' }}
                      />
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        + Use a different card
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Card Element (shown when "new card" selected) */}
              {selectedMethod === 'new' && (
                <div style={{ marginBottom: 20 }}>
                  {savedMethods.length === 0 && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 10 }}>
                      CARD DETAILS
                    </div>
                  )}
                  <div
                    ref={cardMountRef}
                    style={{
                      padding: '13px 14px', borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                    }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="11" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Card saved for future invoices · Secured by Stripe
                  </div>
                </div>
              )}

              {/* Payment error */}
              {errorMsg && (
                <div style={{
                  marginBottom: 16, padding: '10px 14px',
                  background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
                  borderRadius: 8, fontSize: 13, color: '#ef4444',
                }}>
                  {errorMsg}
                </div>
              )}

              {/* Processing spinner */}
              {step === 'processing' && (
                <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 13, color: 'var(--muted)' }}>
                  Processing payment…
                </div>
              )}

              {/* Pay button */}
              <button
                className="btn-primary"
                onClick={() => void handlePay()}
                disabled={step === 'processing' || !cardReady}
                style={{ width: '100%', fontSize: 15, fontWeight: 800, padding: '13px', justifyContent: 'center' }}
              >
                {step === 'processing'
                  ? 'Processing…'
                  : !cardReady
                    ? 'Loading card form…'
                  : `Pay ${fmtUSD(amountToPay)}`
                }
              </button>

              {/* Stripe branding */}
              <div style={{ textAlign: 'center', marginTop: 14, fontSize: 11, color: 'rgba(148,163,184,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="11" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Payments processed securely by Stripe
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
