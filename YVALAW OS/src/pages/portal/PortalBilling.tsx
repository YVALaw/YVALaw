import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import { IconReceipt, IconCreditCard, IconDownload, IconAlert, IconCheck, IconCalendar, IconTrash, IconLock, IconUnlock } from '../../components/Icon'
import {
  loadPortalClient,
  loadPortalInvoices,
  loadPortalBillingSettings,
  loadPortalPaymentAttempts,
  computeOutstanding,
  fmtUSD,
  markPortalInvoicePaid,
  savePortalAutoPaySettings,
  removePortalSavedCard,
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
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Loading billing…</div>
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
        <button className="btn-ghost btn-sm" onClick={() => navigate(portalNav('/portal/dashboard'))}>
          ← Dashboard
        </button>
      </div>

      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: outstanding > 0 ? '#ef4444' : 'var(--success)', borderColor: outstanding > 0 ? '#ef444425' : 'rgba(5,150,105,.15)' }}>
            {outstanding > 0 ? <IconAlert size={20} /> : <IconCheck size={20} />}
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Outstanding Balance</div>
            <div className={`kpi-value${outstanding > 0 ? ' kpi-value-warn' : ''}`} style={{ fontSize: outstanding > 999 ? 22 : undefined }}>
              {fmtUSD(outstanding)}
            </div>
            <div className="kpi-sub">{outstanding > 0 ? `${unpaidCount} invoice${unpaidCount !== 1 ? 's' : ''} pending` : 'All paid up'}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,.15)' }}>
            <IconCheck size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Total Paid</div>
            <div className="kpi-value" style={{ fontSize: totalPaid > 9999 ? 22 : undefined }}>{fmtUSD(totalPaid)}</div>
            <div className="kpi-sub">Lifetime payments</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: 'var(--gold)', borderColor: 'rgba(212,168,67,.15)' }}>
            <IconReceipt size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Total Invoices</div>
            <div className="kpi-value">{invoices.length}</div>
            <div className="kpi-sub">All time</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-wrap" style={{ color: nextDue ? '#f97316' : 'var(--muted)', borderColor: nextDue ? 'rgba(249,115,22,.15)' : 'var(--border)' }}>
            <IconCalendar size={20} />
          </div>
          <div className="kpi-body">
            <div className="kpi-label">Next Due Date</div>
            <div className="kpi-value" style={{ fontSize: 20 }}>{nextDue ? fmtDate(nextDue) : '—'}</div>
            <div className="kpi-sub">{nextDue ? 'Earliest unpaid invoice' : 'No pending invoices'}</div>
          </div>
        </div>
      </div>

      {latestPaymentAttempt?.status === 'failed' && (
        <div className="portal-message portal-message-error" style={{ padding: '14px 18px', fontSize: 13, lineHeight: 1.45 }}>
          AutoPay could not process your latest invoice. Please update your card by paying manually, or contact YVA if you need help.
          {latestPaymentAttempt.failureReason && (
            <div className="mt-4" style={{ fontWeight: 500, color: '#dc2626' }}>
              {latestPaymentAttempt.failureReason}
            </div>
          )}
        </div>
      )}

      {/* Payment Methods & AutoPay */}
      <div className="portal-section-card">
        <div className="portal-section-header">
          <div>
            <div className="portal-section-title">Payment Methods</div>
            <div className="portal-section-sub">Manage your saved cards and AutoPay preferences</div>
          </div>
        </div>
        <div className="portal-section-body">
          {/* Saved card row */}
          {savedCardLabel ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 10,
                background: 'linear-gradient(135deg, var(--surf2), var(--surf3))',
                border: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text)',
              }}>
                <IconCreditCard size={14} />
                {savedCardLabel}
              </div>
              {billingSettings.autoPayEnabled && (
                <span className="badge badge-green" style={{ fontSize: 11 }}>
                  <IconLock size={10} /> AutoPay On
                </span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, padding: '12px 16px', background: 'var(--surf2)', borderRadius: 10, border: '1px dashed var(--border)' }}>
              No saved card on file. Pay an invoice to add a payment method.
            </div>
          )}

          {/* Actions */}
          {!previewId && savedCardLabel && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {billingSettings.autoPayEnabled ? (
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => void disableAutoPay()}
                  disabled={autoPaySaving}
                >
                  <IconUnlock size={12} /> Turn Off AutoPay
                </button>
              ) : (
                <button
                  className="btn-primary btn-sm"
                  onClick={async () => {
                    if (!clientId) return
                    setAutoPaySaving(true)
                    setAutoPayMsg(null)
                    try {
                      await savePortalAutoPaySettings({ clientId, enabled: true })
                      setBillingSettings(prev => ({ ...prev, autoPayEnabled: true }))
                      setAutoPayMsg({ ok: true, text: 'AutoPay is now enabled.' })
                    } catch (err) {
                      setAutoPayMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not enable AutoPay.' })
                    } finally {
                      setAutoPaySaving(false)
                    }
                  }}
                  disabled={autoPaySaving}
                >
                  <IconLock size={12} /> Turn On AutoPay
                </button>
              )}
              <button
                className="btn-danger btn-xs"
                onClick={async () => {
                  if (!clientId || !confirm('Remove this saved card? This will also disable AutoPay.')) return
                  setAutoPaySaving(true)
                  try {
                    await removePortalSavedCard(clientId)
                    setBillingSettings({ autoPayEnabled: false })
                    setAutoPayMsg({ ok: true, text: 'Card removed successfully.' })
                  } catch (err) {
                    setAutoPayMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not remove card.' })
                  } finally {
                    setAutoPaySaving(false)
                  }
                }}
                disabled={autoPaySaving}
              >
                <IconTrash size={12} /> Remove Card
              </button>
            </div>
          )}
          {previewId && savedCardLabel && (
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
              Card management is disabled in preview mode.
            </div>
          )}
          {autoPayMsg && (
            <div className={`mt-12 portal-message${autoPayMsg.ok ? ' portal-message-success' : ' portal-message-error'}`} style={{ marginTop: 12 }}>
              {autoPayMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="filter-tabs">
        {(['all', 'unpaid', 'paid'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`filter-tab${filter === f ? ' filter-tab-active' : ''}`}
          >
            {f === 'all' ? `All (${invoices.length})` : f === 'unpaid' ? `Unpaid (${invoices.filter(isUnpaid).length})` : `Paid (${invoices.filter(i => i.status?.toLowerCase() === 'paid').length})`}
          </button>
        ))}
      </div>

      {/* Invoice list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconReceipt size={28} /></div>
          <div className="empty-state-title">
            {filter === 'unpaid' ? 'No unpaid invoices' : filter === 'paid' ? 'No paid invoices yet' : 'No invoices yet'}
          </div>
        </div>
      ) : (
        <div className="portal-card-list">
          {filtered.map(inv => {
            const unpaid   = isUnpaid(inv)
            const bal      = balance(inv)
            const statusLbl = (inv.status ?? 'Draft').charAt(0).toUpperCase() + (inv.status ?? 'draft').slice(1)

            return (
              <div key={inv.id} className="portal-invoice-list-card" style={{ borderLeft: `3px solid ${statusColor(inv.status)}` }}>
                {/* Top row */}
                <div className="portal-invoice-header">
                  <div>
                    <div className="flex items-center" style={{ gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', overflowWrap: 'anywhere' }}>{inv.number}</span>
                      <span className="badge" style={{ color: statusColor(inv.status), background: statusBg(inv.status), borderColor: statusColor(inv.status) + '33' }}>
                        {statusLbl}
                      </span>
                    </div>
                    {inv.projectName && (
                      <div className="mt-2" style={{ fontSize: 12, color: 'var(--muted)' }}>{inv.projectName}</div>
                    )}
                  </div>

                  {/* Amount block */}
                  <div className="text-right" style={{ flexShrink: 0 }}>
                    <div className="stat-value" style={{ fontSize: 18 }}>{fmtUSD(Number(inv.subtotal) || 0)}</div>
                    {inv.amountPaid && Number(inv.amountPaid) > 0 && (
                      <div className="mt-2 text-green" style={{ fontSize: 11 }}>{fmtUSD(Number(inv.amountPaid))} paid</div>
                    )}
                    {unpaid && bal > 0 && Number(inv.amountPaid) > 0 && (
                      <div className="mt-2 text-warn" style={{ fontSize: 11 }}>{fmtUSD(bal)} remaining</div>
                    )}
                  </div>
                </div>

                {/* Date row */}
                <div className="portal-invoice-meta-row" style={{ marginTop: 10 }}>
                  <div className="card-detail">
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>Issued:</span> {fmtDate(inv.date)}
                  </div>
                  {inv.dueDate && (
                    <div className="card-detail">
                      <span style={{ fontWeight: 600, color: inv.status?.toLowerCase() === 'overdue' ? '#ef4444' : 'var(--text)' }}>Due:</span>{' '}
                      <span style={{ color: inv.status?.toLowerCase() === 'overdue' ? '#ef4444' : 'var(--muted)' }}>{fmtDate(inv.dueDate)}</span>
                    </div>
                  )}
                  {(inv.billingStart || inv.billingEnd) && (
                    <div className="card-detail">
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>Period:</span>{' '}
                      {fmtDate(inv.billingStart)} – {fmtDate(inv.billingEnd)}
                    </div>
                  )}
                </div>

                {/* Action row — pay + PDF download */}
                <div className="portal-invoice-actions">
                  {unpaid && !previewId && (
                    <button className="btn-primary" onClick={() => setPayingInvoice(inv)}>
                      <IconCreditCard size={14} />
                      Pay {fmtUSD(bal)}
                    </button>
                  )}
                  {unpaid && previewId && (
                    <button className="btn-primary" disabled title="Payment disabled in preview mode" style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                      <IconCreditCard size={14} />
                      Pay {fmtUSD(bal)}
                      <span className="badge badge-gray" style={{ fontSize: 10, marginLeft: 6 }}>Preview</span>
                    </button>
                  )}
                  <button
                    className="btn-ghost btn-sm"
                    onClick={() => printInvoice(inv, { rate: 0 })}
                    title="Download PDF"
                    style={{ marginLeft: unpaid ? 'auto' : undefined }}
                  >
                    <IconDownload size={13} />
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
