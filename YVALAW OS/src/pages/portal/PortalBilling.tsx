// Portal → Billing: balance card, AutoPay card, failed-payment banner, All/Unpaid/Paid tabs, invoice rows (PDF / Pay).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  loadPortalClient,
  loadPortalInvoices,
  loadPortalBillingSettings,
  loadPortalPaymentAttempts,
  computeOutstanding,
  fmtUSD,
  savePortalAutoPaySettings,
  removePortalSavedCard,
  type PortalBillingSettings,
} from '../../services/portalStorage'
import { printInvoice } from '../../utils/invoiceHtml'
import PaymentModal from '../../components/PaymentModal'
import type { Client, Invoice, PaymentAttempt } from '../../data/types'
import { Banner, Menu, Pill, Tabs } from '../../components/ui'
import { Ic, P } from '../../components/Icon'
import { usePortal, InvoicePill, PortalSkeleton, isUnpaid, invoiceBalance, oldestUnpaid } from '../../components/PortalSection'
import { dateMed, dateShort } from '../../utils/format'

type Filter = 'all' | 'unpaid' | 'paid'

function isMeaningfulAttempt(attempt: PaymentAttempt) {
  return attempt.status !== 'created' && attempt.status !== 'requires_payment_method'
}
function cardLabel(settings: PortalBillingSettings): string | null {
  if (!settings.defaultCardLast4) return null
  const brand = settings.defaultCardBrand
    ? settings.defaultCardBrand.charAt(0).toUpperCase() + settings.defaultCardBrand.slice(1)
    : 'Card'
  const exp = settings.defaultCardExpMonth && settings.defaultCardExpYear
    ? ` · expires ${String(settings.defaultCardExpMonth).padStart(2, '0')}/${String(settings.defaultCardExpYear).slice(-2)}`
    : ''
  return `${brand} •• ${settings.defaultCardLast4}${exp}`
}
function periodText(inv: Invoice) {
  if (inv.billingStart || inv.billingEnd) return `${dateShort(inv.billingStart)} – ${dateShort(inv.billingEnd)}`
  return `Issued ${dateMed(inv.date)}`
}

export default function PortalBilling() {
  const { clientId, previewId } = usePortal()
  const [searchParams, setSearchParams] = useSearchParams()

  const [client,          setClient]          = useState<Client | null>(null)
  const [invoices,        setInvoices]        = useState<Invoice[]>([])
  const [loading,         setLoading]         = useState(true)
  const [filter,          setFilter]          = useState<Filter>('all')
  const [payingInvoice,   setPayingInvoice]   = useState<Invoice | null>(null)
  const [billingSettings, setBillingSettings] = useState<PortalBillingSettings>({ autoPayEnabled: false })
  const [paymentAttempts, setPaymentAttempts] = useState<PaymentAttempt[]>([])
  const [autoPaySaving,   setAutoPaySaving]   = useState(false)
  const [autoPayMsg,      setAutoPayMsg]      = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const c = await loadPortalClient(clientId)
      setClient(c)
      if (!c) { setLoading(false); return }
      const [invs, settings, attempts] = await Promise.all([
        loadPortalInvoices(c.name),
        loadPortalBillingSettings(clientId),
        loadPortalPaymentAttempts(clientId),
      ])
      setInvoices(invs)
      setBillingSettings(settings)
      setPaymentAttempts(attempts)
      setLoading(false)
    })()
  }, [clientId])

  // Home → "Pay now" lands here with ?pay=<invoiceId>; open that invoice's payment, then drop the param
  const payParam = searchParams.get('pay')
  useEffect(() => {
    if (!payParam || loading) return
    const inv = invoices.find(i => i.id === payParam)
    if (inv && isUnpaid(inv) && !previewId) setPayingInvoice(inv)
    setSearchParams(previewId ? { preview: previewId } : {}, { replace: true })
  }, [payParam, loading, invoices, previewId, setSearchParams])

  async function setAutoPay(enabled: boolean) {
    if (!clientId) return
    setAutoPaySaving(true)
    setAutoPayMsg(null)
    try {
      await savePortalAutoPaySettings({ clientId, enabled })
      setBillingSettings(prev => enabled
        ? { ...prev, autoPayEnabled: true }
        : { ...prev, autoPayEnabled: false, autoPayDisabledAt: new Date().toISOString() })
      setAutoPayMsg({ ok: true, text: enabled ? 'AutoPay is now enabled.' : 'AutoPay is off.' })
    } catch (err) {
      setAutoPayMsg({ ok: false, text: err instanceof Error ? err.message : enabled ? 'Could not enable AutoPay.' : 'Could not turn off AutoPay.' })
    } finally {
      setAutoPaySaving(false)
    }
  }

  async function removeCard() {
    if (!clientId || !confirm('Remove this saved card? This will also disable AutoPay.')) return
    setAutoPaySaving(true)
    setAutoPayMsg(null)
    try {
      await removePortalSavedCard(clientId)
      setBillingSettings({ autoPayEnabled: false })
      setAutoPayMsg({ ok: true, text: 'Card removed successfully.' })
    } catch (err) {
      setAutoPayMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not remove card.' })
    } finally {
      setAutoPaySaving(false)
    }
  }

  if (loading) return <PortalSkeleton />

  const paidList    = invoices.filter(inv => (inv.status ?? '').toLowerCase() === 'paid')
  const unpaidList  = invoices.filter(isUnpaid)
  const filtered    = filter === 'unpaid' ? unpaidList : filter === 'paid' ? paidList : invoices
  const outstanding = computeOutstanding(invoices)
  const totalPaid   = paidList.reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  const oldest      = oldestUnpaid(invoices)
  const latestPaymentAttempt = paymentAttempts.find(isMeaningfulAttempt)
  const savedCardLabel = cardLabel(billingSettings)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="por-page">
      <p className="por-summary">
        {client?.company ? `${client.company} · ` : ''}{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
        {unpaidList.length > 0 ? ` · ${unpaidList.length} unpaid` : ' · all paid'}
      </p>

      {autoPayMsg && <Banner tone={autoPayMsg.ok ? 'success' : 'danger'} onClose={() => setAutoPayMsg(null)}>{autoPayMsg.text}</Banner>}

      <div className="por-grid por-grid--2">
        <section className="card por-card por-balance">
          <span className="por-card__label">Balance due</span>
          <span className={`por-balance__amount num${outstanding > 0 ? '' : ' t-success'}`}>{fmtUSD(outstanding)}</span>
          <span className="por-card__meta">
            {oldest
              ? <>{unpaidList.length} unpaid · next due {dateMed(oldest.dueDate ?? oldest.date)}</>
              : 'All paid up'}
            {' · '}Paid to date {fmtUSD(totalPaid)}
          </span>
          {oldest && (
            <button type="button" className="btn btn--primary por-btn-lg por-balance__pay" disabled={Boolean(previewId)}
              title={previewId ? 'Payment disabled in preview mode' : undefined}
              onClick={() => setPayingInvoice(oldest)}>
              Pay {fmtUSD(invoiceBalance(oldest))}{unpaidList.length > 1 ? <span className="por-balance__which mono">· {oldest.number}</span> : null}
            </button>
          )}
        </section>

        <section className="card por-card por-autopay">
          <div className="por-card__row">
            <h2 className="por-card__title">AutoPay</h2>
            <span className="row">
              <Pill tone={billingSettings.autoPayEnabled ? 'success' : 'neutral'}>{billingSettings.autoPayEnabled ? 'On' : 'Off'}</Pill>
              {!previewId && savedCardLabel && (
                <Menu label="Card options" buttonClass="btn btn--icon btn--sm btn--ghost" items={[
                  { label: 'Remove card', icon: P.trash, danger: true, onClick: () => void removeCard(), disabled: autoPaySaving },
                ]} />
              )}
            </span>
          </div>
          {savedCardLabel ? (
            <>
              <span className="por-autopay__card"><Ic d={P.card} size={15} />{savedCardLabel}</span>
              <span className="por-card__meta">With AutoPay on, invoices are charged to this card on their due date.</span>
              {previewId
                ? <span className="por-card__meta">Card management is disabled in preview mode.</span>
                : (
                  <button type="button" className="btn por-autopay__toggle" disabled={autoPaySaving} onClick={() => void setAutoPay(!billingSettings.autoPayEnabled)}>
                    {autoPaySaving ? 'Saving…' : billingSettings.autoPayEnabled ? 'Turn off AutoPay' : 'Turn on AutoPay'}
                  </button>
                )}
            </>
          ) : (
            <span className="por-card__meta">No saved card on file. Pay an invoice to add a payment method and turn on AutoPay.</span>
          )}
        </section>
      </div>

      {latestPaymentAttempt?.status === 'failed' && (
        <Banner tone="danger">
          AutoPay could not process your latest invoice. Please update your card by paying manually, or contact YVA if you need help.
          {latestPaymentAttempt.failureReason && <div className="por-banner-detail">{latestPaymentAttempt.failureReason}</div>}
        </Banner>
      )}

      <Tabs value={filter} onChange={setFilter} label="Invoices" tabs={[
        { value: 'all', label: 'All', count: invoices.length },
        { value: 'unpaid', label: 'Unpaid', count: unpaidList.length },
        { value: 'paid', label: 'Paid', count: paidList.length },
      ]} />

      {filtered.length === 0 ? (
        <div className="card card-empty">
          {filter === 'unpaid' ? 'No unpaid invoices.' : filter === 'paid' ? 'No paid invoices yet.' : 'No invoices yet.'}
        </div>
      ) : (
        <div className="por-list">
          {filtered.map(inv => {
            const unpaid = isUnpaid(inv)
            const bal = invoiceBalance(inv)
            const paidPart = Number(inv.amountPaid) || 0
            const late = unpaid && ((inv.status ?? '').toLowerCase() === 'overdue' || Boolean(inv.dueDate && inv.dueDate < today))
            return (
              <div key={inv.id} className="card por-inv">
                <div className="por-inv__main">
                  <span className="por-inv__num mono">{inv.number}</span>
                  <span className="por-inv__meta">
                    {periodText(inv)}
                    {inv.dueDate && <> · <span className={late ? 't-danger' : undefined}>due {dateShort(inv.dueDate)}</span></>}
                    {inv.projectName && <> · {inv.projectName}</>}
                  </span>
                </div>
                <InvoicePill status={inv.status} />
                <span className="por-inv__amount num">
                  {fmtUSD(Number(inv.subtotal) || 0)}
                  {paidPart > 0 && unpaid && bal > 0 && <span className="por-inv__sub t-warning">{fmtUSD(bal)} remaining</span>}
                  {paidPart > 0 && !unpaid && paidPart < (Number(inv.subtotal) || 0) && <span className="por-inv__sub t-success">{fmtUSD(paidPart)} paid</span>}
                </span>
                <div className="por-inv__actions">
                  <button type="button" className="btn" onClick={() => printInvoice(inv, { rate: 0 })} aria-label={`Download PDF of ${inv.number}`}>PDF</button>
                  {unpaid && (
                    <button type="button" className="btn btn--primary" disabled={Boolean(previewId)}
                      title={previewId ? 'Payment disabled in preview mode' : `Pay ${fmtUSD(bal)}`}
                      onClick={() => setPayingInvoice(inv)}>
                      Pay{previewId && <span className="tag-preview">PREVIEW</span>}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {payingInvoice && clientId && (
        <PaymentModal
          invoice={payingInvoice}
          clientId={clientId}
          clientName={client?.company || client?.name}
          onClose={() => setPayingInvoice(null)}
          onSuccess={(paidAmount, options) => {
            const previousPaid = Number(payingInvoice.amountPaid) || 0
            const totalDue     = Number(payingInvoice.subtotal) || 0
            const paidTotal    = Math.min(totalDue, previousPaid + paidAmount)

            // Optimistic local update — the Stripe webhook handles the real DB write.
            // A direct supabase.update() here was blocked by RLS and failed silently,
            // so we rely purely on the webhook + a UI refresh message.
            setInvoices(prev => prev.map(inv =>
              inv.id === payingInvoice.id
                ? { ...inv, status: 'paid', amountPaid: paidTotal }
                : inv
            ))
            if (options?.autoPayEnabled) {
              setBillingSettings(prev => ({
                ...prev,
                autoPayEnabled: true,
                defaultPaymentMethodId: options.paymentMethodId ?? prev.defaultPaymentMethodId,
                defaultCardBrand: options.card?.brand ?? prev.defaultCardBrand,
                defaultCardLast4: options.card?.last4 ?? prev.defaultCardLast4,
                defaultCardExpMonth: options.card?.expMonth ?? prev.defaultCardExpMonth,
                defaultCardExpYear: options.card?.expYear ?? prev.defaultCardExpYear,
                autoPayAuthorizedAt: new Date().toISOString(),
              }))
            }
            // No redundant DB call here — the stripe-webhook function marks the invoice
            // paid when payment_intent.succeeded fires.
          }}
        />
      )}
    </div>
  )
}
