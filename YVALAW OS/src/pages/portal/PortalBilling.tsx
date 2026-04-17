import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import {
  loadPortalClient,
  loadPortalInvoices,
  loadPortalBillingSettings,
  loadPortalPaymentAttempts,
  computeOutstanding,
  fmtUSD,
  markPortalInvoicePaid,
  savePortalAutoPaySettings,
  type PortalBillingSettings,
} from '../../services/portalStorage'
import { printInvoice } from '../../utils/invoiceHtml'
import PaymentModal from '../../components/PaymentModal'
import type { Client, Invoice, PaymentAttempt } from '../../data/types'

type Filter = 'all' | 'unpaid' | 'paid'

function statusColor(s?: string): string {
  switch ((s ?? '').toLowerCase()) {
    case 'paid':            return '#22c55e'
    case 'overdue':         return '#ef4444'
    case 'partial':         return '#f97316'
    case 'sent':
    case 'viewed':          return '#3b82f6'
    default:                return 'var(--muted)'
  }
}
function statusBg(s?: string): string {
  switch ((s ?? '').toLowerCase()) {
    case 'paid':            return 'rgba(34,197,94,.1)'
    case 'overdue':         return 'rgba(239,68,68,.1)'
    case 'partial':         return 'rgba(249,115,22,.1)'
    case 'sent':
    case 'viewed':          return 'rgba(59,130,246,.1)'
    default:                return 'var(--surf2)'
  }
}
function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function isUnpaid(inv: Invoice) {
  const s = (inv.status ?? '').toLowerCase()
  return s === 'sent' || s === 'viewed' || s === 'overdue' || s === 'partial'
}
function balance(inv: Invoice): number {
  return (Number(inv.subtotal) || 0) - (Number(inv.amountPaid) || 0)
}
function nextDueDate(invoices: Invoice[]): string | null {
  const unpaid = invoices
    .filter(isUnpaid)
    .map(inv => inv.dueDate ?? inv.date)
    .filter(Boolean)
    .sort()
  return unpaid[0] ?? null
}
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
  return `${brand} ending ${settings.defaultCardLast4}${exp}`
}

export default function PortalBilling() {
  const { clientId: roleClientId } = useRole()
  const [searchParams] = useSearchParams()
  const previewId = searchParams.get('preview')
  const clientId  = roleClientId ?? previewId
  const navigate  = useNavigate()

  function portalNav(path: string) {
    return previewId ? `${path}?preview=${previewId}` : path
  }

  const [client,       setClient]       = useState<Client | null>(null)
  const [invoices,     setInvoices]     = useState<Invoice[]>([])
  const [loading,      setLoading]      = useState(true)
  const [filter,       setFilter]       = useState<Filter>('all')
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null)
  const [billingSettings, setBillingSettings] = useState<PortalBillingSettings>({ autoPayEnabled: false })
  const [paymentAttempts, setPaymentAttempts] = useState<PaymentAttempt[]>([])
  const [autoPaySaving, setAutoPaySaving] = useState(false)
  const [autoPayMsg,    setAutoPayMsg]    = useState<{ ok: boolean; text: string } | null>(null)

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

  async function disableAutoPay() {
    if (!clientId) return
    setAutoPaySaving(true)
    setAutoPayMsg(null)
    try {
      await savePortalAutoPaySettings({ clientId, enabled: false })
      setBillingSettings(prev => ({ ...prev, autoPayEnabled: false, autoPayDisabledAt: new Date().toISOString() }))
      setAutoPayMsg({ ok: true, text: 'AutoPay is off.' })
    } catch (err) {
      setAutoPayMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not turn off AutoPay.' })
    } finally {
      setAutoPaySaving(false)
    }
  }

  const filtered = invoices.filter(inv => {
    if (filter === 'unpaid') return isUnpaid(inv)
    if (filter === 'paid')   return (inv.status ?? '').toLowerCase() === 'paid'
    return true
  })

  const outstanding  = computeOutstanding(invoices)
  const totalPaid    = invoices
    .filter(inv => (inv.status ?? '').toLowerCase() === 'paid')
    .reduce((s, inv) => s + (Number(inv.subtotal) || 0), 0)
  const unpaidCount  = invoices.filter(isUnpaid).length
  const nextDue      = nextDueDate(invoices)
  const latestPaymentAttempt = paymentAttempts.find(isMeaningfulAttempt)
  const savedCardLabel = cardLabel(billingSettings)

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading billing…</div>
      </div>
    )
  }

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title">My Billing</div>
          <div className="page-sub">
            {client?.company ? client.company + ' · ' : ''}
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            {unpaidCount > 0 ? ` · ${unpaidCount} unpaid` : ' · all paid'}
          </div>
        </div>
        <button
          className="btn-ghost btn-sm"
          onClick={() => navigate(portalNav('/portal/dashboard'))}
          style={{ fontSize: 12 }}
        >
          ← Dashboard
        </button>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card" style={{ borderTop: `3px solid ${outstanding > 0 ? '#ef4444' : 'var(--gold)'}` }}>
          <div className="kpi-label">Outstanding Balance</div>
          <div className={`kpi-value${outstanding > 0 ? ' kpi-value-warn' : ''}`} style={{ fontSize: outstanding > 999 ? 22 : 28 }}>
            {fmtUSD(outstanding)}
          </div>
          <div className="kpi-sub">{outstanding > 0 ? `${unpaidCount} invoice${unpaidCount !== 1 ? 's' : ''} pending` : 'All paid up'}</div>
        </div>

        <div className="kpi-card" style={{ borderTop: '3px solid #22c55e' }}>
          <div className="kpi-label">Total Paid</div>
          <div className="kpi-value" style={{ fontSize: totalPaid > 9999 ? 22 : 28 }}>{fmtUSD(totalPaid)}</div>
          <div className="kpi-sub">Lifetime payments</div>
        </div>

        <div className="kpi-card" style={{ borderTop: '3px solid var(--gold)' }}>
          <div className="kpi-label">Total Invoices</div>
          <div className="kpi-value">{invoices.length}</div>
          <div className="kpi-sub">All time</div>
        </div>

        <div className="kpi-card" style={{ borderTop: `3px solid ${nextDue ? '#f97316' : 'var(--gold)'}` }}>
          <div className="kpi-label">Next Due Date</div>
          <div className="kpi-value" style={{ fontSize: 20 }}>{nextDue ? fmtDate(nextDue) : '—'}</div>
          <div className="kpi-sub">{nextDue ? 'Earliest unpaid invoice' : 'No pending invoices'}</div>
        </div>
      </div>

      {latestPaymentAttempt?.status === 'failed' && (
        <div style={{
          background: 'rgba(239,68,68,.08)',
          border: '1px solid rgba(239,68,68,.24)',
          borderRadius: 14,
          padding: '14px 18px',
          color: '#b91c1c',
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.45,
        }}>
          AutoPay could not process your latest invoice. Please update your card by paying manually, or contact YVA if you need help.
          {latestPaymentAttempt.failureReason && (
            <div style={{ marginTop: 4, fontWeight: 500, color: '#dc2626' }}>
              {latestPaymentAttempt.failureReason}
            </div>
          )}
        </div>
      )}

      {/* AutoPay settings */}
      <div style={{
        background: billingSettings.autoPayEnabled ? 'rgba(34,197,94,.06)' : 'var(--surface)',
        border: `1px solid ${billingSettings.autoPayEnabled ? 'rgba(34,197,94,.22)' : 'var(--border)'}`,
        borderRadius: 16,
        padding: '18px 22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            AutoPay {billingSettings.autoPayEnabled ? 'is on' : 'is off'}
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 999,
              background: billingSettings.autoPayEnabled ? 'rgba(34,197,94,.12)' : 'var(--surf2)',
              color: billingSettings.autoPayEnabled ? '#15803d' : 'var(--muted)',
            }}>
              {billingSettings.autoPayEnabled ? 'ACTIVE' : 'OPTIONAL'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, maxWidth: 560 }}>
            {billingSettings.autoPayEnabled
              ? 'Future due invoices will be charged automatically to the saved card you authorized.'
              : 'To enable automatic deductions, pay an invoice and check the AutoPay authorization box before submitting payment.'}
          </div>
          {savedCardLabel && (
            <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, fontWeight: 700 }}>
              Saved card: {savedCardLabel}
            </div>
          )}
          {autoPayMsg && (
            <div style={{ fontSize: 12, color: autoPayMsg.ok ? '#15803d' : '#ef4444', marginTop: 8, fontWeight: 700 }}>
              {autoPayMsg.text}
            </div>
          )}
        </div>
        {billingSettings.autoPayEnabled && (
          <button
            className="btn-ghost btn-sm"
            onClick={() => void disableAutoPay()}
            disabled={autoPaySaving}
            style={{ fontSize: 12, color: '#ef4444', borderColor: 'rgba(239,68,68,.24)' }}
          >
            {autoPaySaving ? 'Saving…' : 'Turn Off AutoPay'}
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['all', 'unpaid', 'paid'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              border: '1px solid',
              borderColor: filter === f ? 'var(--gold)' : 'var(--border)',
              background:  filter === f ? 'rgba(245,181,51,.12)' : 'transparent',
              color:       filter === f ? 'var(--gold)' : 'var(--muted)',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {f === 'all' ? `All (${invoices.length})` : f === 'unpaid' ? `Unpaid (${invoices.filter(isUnpaid).length})` : `Paid (${invoices.filter(i => i.status?.toLowerCase() === 'paid').length})`}
          </button>
        ))}
      </div>

      {/* Invoice list */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 20px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, color: 'var(--muted)',
        }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>🧾</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {filter === 'unpaid' ? 'No unpaid invoices' : filter === 'paid' ? 'No paid invoices yet' : 'No invoices yet'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(inv => {
            const unpaid   = isUnpaid(inv)
            const bal      = balance(inv)
            const statusLbl = (inv.status ?? 'Draft').charAt(0).toUpperCase() + (inv.status ?? 'draft').slice(1)

            return (
              <div key={inv.id} style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 14, padding: '18px 20px',
                borderLeft: `3px solid ${statusColor(inv.status)}`,
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{inv.number}</span>
                      <span style={{
                        padding: '2px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                        color: statusColor(inv.status), background: statusBg(inv.status),
                      }}>
                        {statusLbl}
                      </span>
                    </div>
                    {inv.projectName && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{inv.projectName}</div>
                    )}
                  </div>

                  {/* Amount block */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 18, color: 'var(--text)' }}>
                      {fmtUSD(Number(inv.subtotal) || 0)}
                    </div>
                    {inv.amountPaid && Number(inv.amountPaid) > 0 && (
                      <div style={{ fontSize: 11, color: '#22c55e', marginTop: 1 }}>
                        {fmtUSD(Number(inv.amountPaid))} paid
                      </div>
                    )}
                    {unpaid && bal > 0 && Number(inv.amountPaid) > 0 && (
                      <div style={{ fontSize: 11, color: '#ef4444', marginTop: 1 }}>
                        {fmtUSD(bal)} remaining
                      </div>
                    )}
                  </div>
                </div>

                {/* Date row */}
                <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>Issued:</span> {fmtDate(inv.date)}
                  </div>
                  {inv.dueDate && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      <span style={{ fontWeight: 600, color: inv.status?.toLowerCase() === 'overdue' ? '#ef4444' : 'var(--text)' }}>Due:</span>{' '}
                      <span style={{ color: inv.status?.toLowerCase() === 'overdue' ? '#ef4444' : 'var(--muted)' }}>
                        {fmtDate(inv.dueDate)}
                      </span>
                    </div>
                  )}
                  {(inv.billingStart || inv.billingEnd) && (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>Period:</span>{' '}
                      {fmtDate(inv.billingStart)} – {fmtDate(inv.billingEnd)}
                    </div>
                  )}
                </div>

                {/* Action row — pay + PDF download */}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {unpaid && !previewId && (
                    <button
                      className="btn-primary"
                      onClick={() => setPayingInvoice(inv)}
                      style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
                      </svg>
                      Pay {fmtUSD(bal)}
                    </button>
                  )}
                  {unpaid && previewId && (
                    <button
                      className="btn-primary"
                      disabled
                      title="Payment disabled in preview mode"
                      style={{ opacity: 0.4, cursor: 'not-allowed', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
                      </svg>
                      Pay {fmtUSD(bal)}
                      <span style={{ fontSize: 10, fontWeight: 600, background: 'rgba(255,255,255,.2)', padding: '2px 7px', borderRadius: 999 }}>Preview</span>
                    </button>
                  )}
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => printInvoice(inv, { rate: 0 })}
                    title="Download PDF"
                    style={{ fontSize: 12, marginLeft: unpaid ? 'auto' : 0, display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>
                    </svg>
                    Download PDF
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Payment modal ───────────────────────────────────────────────── */}
      {payingInvoice && clientId && (
        <PaymentModal
          invoice={payingInvoice}
          clientId={clientId}
          onClose={() => setPayingInvoice(null)}
          onSuccess={async (paidAmount, options) => {
            const previousPaid = Number(payingInvoice.amountPaid) || 0
            const totalDue     = Number(payingInvoice.subtotal) || 0
            const paidTotal    = Math.min(totalDue, previousPaid + paidAmount)

            // Optimistic update — mark as paid in local state immediately
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
            // Best-effort DB update (webhook also does this, this is the safety net)
            await markPortalInvoicePaid(payingInvoice.id, paidTotal).catch(console.error)
          }}
        />
      )}

    </div>
  )
}
