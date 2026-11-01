import { useEffect, useState } from 'react'
import type { Invoice } from '../data/types'
import { Ic, P } from '../components/Icon'
import { Pill, useIsMobile } from '../components/ui'
import { dateMed } from '../utils/format'
import { isItemLine, lineAmount, qtyText } from '../utils/invoiceLines'

// The share link may still carry dopRate (older links); it is ignored — DOP is never shown to clients.
type Payload = { inv: Invoice; dopRate?: number }

function decodePayload(hash: string): Payload | null {
  try {
    const b64 = hash.startsWith('#') ? hash.slice(1) : hash
    return JSON.parse(decodeURIComponent(atob(b64))) as Payload
  } catch { return null }
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Same as the invoice PDF: "7h 20m" (exact minutes), never a long decimal */
function fmtHours(h: unknown): string {
  const m = Math.round((Number(h) || 0) * 60)
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const fmtDate = (d?: string) => (d ? dateMed(d) : '—')

/** /invoice-view — read-only invoice someone shared with a client (no login) */
export default function PortalPage() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error,   setError]   = useState(false)
  const mobile = useIsMobile()

  useEffect(() => {
    const p = decodePayload(window.location.hash)
    if (p?.inv) setPayload(p)
    else setError(true)
  }, [])

  if (error || !payload) {
    return (
      <main className="set-iv__empty">
        <div className="set-auth__card set-auth__center">
          <span className="set-auth__icon set-auth__icon--gold"><Ic d={P.alert} size={24} /></span>
          <div className="set-auth__head">
            <h1 className="set-auth__title">Invalid invoice link</h1>
            <p className="set-auth__sub">This link may be expired or malformed.</p>
          </div>
        </div>
      </main>
    )
  }

  const { inv } = payload
  const total = Number(inv.subtotal) || 0
  const items = inv.items ?? []

  return (
    <main className="set-iv">
      <article className="set-iv__doc">
        <header className="set-iv__top">
          <div className="set-iv__brand">
            <img className="set-iv__logo" src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA Staffing"
              onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }} />
            <div>
              <div className="set-iv__company">YVA Staffing</div>
              <div className="set-iv__tagline">Bilingual Virtual Professionals</div>
            </div>
          </div>
          <div className="set-iv__id">
            <span className="set-iv__kicker">Invoice</span>
            <span className="set-iv__number">{inv.number}</span>
            {inv.status && <Pill status={inv.status} />}
          </div>
        </header>

        <section className="set-iv__meta">
          <div className="set-iv__block">
            <span className="set-iv__label">Bill to</span>
            <span className="set-iv__strong">{inv.clientName || '—'}</span>
            {inv.clientEmail   && <span className="set-iv__line">{inv.clientEmail}</span>}
            {inv.clientAddress && <span className="set-iv__line">{inv.clientAddress}</span>}
          </div>
          <div className="set-iv__block">
            <span className="set-iv__label">Invoice details</span>
            <span className="set-iv__line"><b>Date</b> {fmtDate(inv.date)}</span>
            {inv.dueDate && <span className="set-iv__line"><b>Due</b> {fmtDate(inv.dueDate)}</span>}
            {inv.billingStart && <span className="set-iv__line"><b>Period</b> {fmtDate(inv.billingStart)} – {inv.billingEnd ? fmtDate(inv.billingEnd) : ''}</span>}
            {inv.projectName && <span className="set-iv__line"><b>Project</b> {inv.projectName}</span>}
          </div>
        </section>

        {items.length > 0 && (mobile ? (
          <section className="set-iv__items" aria-label="Line items">
            {items.map((it, i) => (
              <div key={i} className="set-iv__item">
                {isItemLine(it) ? (
                  <div>
                    <strong>{it.description || 'Item'}</strong>
                    <div className="set-iv__item-meta">{qtyText(it.qty)} × {fmtMoney(Number(it.rate) || 0)}</div>
                  </div>
                ) : (
                  <div>
                    <strong>{it.employeeName}</strong>
                    {it.position && <div className="set-iv__item-meta">{it.position}</div>}
                    <div className="set-iv__item-meta">{fmtHours(it.hoursTotal)} × ${it.rate}/hr</div>
                  </div>
                )}
                <strong className="num">{fmtMoney(lineAmount(it))}</strong>
              </div>
            ))}
          </section>
        ) : (
          <table className="set-iv__table">
            <thead>
              <tr><th>Description</th><th className="t-num">{items.every(isItemLine) ? 'Qty' : items.some(isItemLine) ? 'Hours / qty' : 'Hours'}</th><th className="t-num">Rate</th><th className="t-num">Amount</th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                isItemLine(it) ? (
                  <tr key={i}>
                    <td><strong>{it.description || 'Item'}</strong></td>
                    <td className="t-num">{qtyText(it.qty)}</td>
                    <td className="t-num">{fmtMoney(Number(it.rate) || 0)}</td>
                    <td className="t-num"><strong>{fmtMoney(lineAmount(it))}</strong></td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td><strong>{it.employeeName}</strong>{it.position && <span className="set-iv__pos">{it.position}</span>}</td>
                    <td className="t-num">{fmtHours(it.hoursTotal)}</td>
                    <td className="t-num">${it.rate}/hr</td>
                    <td className="t-num"><strong>{fmtMoney(lineAmount(it))}</strong></td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        ))}

        <section className="set-iv__total">
          <span className="set-iv__total-label">{items.length > 0 ? 'Total due' : 'Amount due'}</span>
          <span className="set-iv__total-value">{fmtMoney(total)}</span>
        </section>

        {inv.notes && <p className="set-iv__notes">{inv.notes}</p>}

        <footer className="set-iv__foot">
          <span>YVA Staffing · Bilingual Virtual Professionals · yvastaffing.net</span>
          <button type="button" className="btn btn--primary set-iv__print" onClick={() => window.print()}>
            <Ic d={P.printer} size={15} /> Print / Save PDF
          </button>
        </footer>
      </article>
    </main>
  )
}
