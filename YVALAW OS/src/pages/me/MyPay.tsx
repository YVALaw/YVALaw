import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type Earnings = {
  currency: string; dopRate: number | null
  today: { date: string; seconds: number; amount: number }
  trackingNow?: boolean
  lastActivityAt?: string | null
  periods: { key: string; label: string; schedule: string; start: string; end: string; payday: string; seconds: number; premiumSeconds: number
             amount: number; approvedAmount: number; pendingAmount: number; payRate: number; missingRate: boolean }[]
  totals: { seconds: number; amount: number; approvedAmount: number }
  paid: { payday: string; netUsd: number; netDop: number | null; paidAt: string | null }[]
  updatedAt: string
}

const T = {
  en: { today: 'Today', period: 'This pay period', paidOn: 'paid', estimated: 'Estimated', approved: 'Approved', paidLabel: 'Paid', night: 'night premium',
        missing: 'Your pay rate is not set yet — YVA will add it.', none: 'No tracked time in this pay period yet.', history: 'Payments', updated: 'Updated',
        explain: 'Estimated = tracked, not approved yet. Approved = YVA approved the hours. Paid = sent to your account.', perHour: '/hr', error: 'Could not load your pay.' },
  es: { today: 'Hoy', period: 'Este período de pago', paidOn: 'pago', estimated: 'Estimado', approved: 'Aprobado', paidLabel: 'Pagado', night: 'prima nocturna',
        missing: 'Tu tarifa aún no está configurada — YVA la agregará.', none: 'Aún no hay tiempo registrado en este período.', history: 'Pagos', updated: 'Actualizado',
        explain: 'Estimado = registrado, aún sin aprobar. Aprobado = YVA aprobó las horas. Pagado = enviado a tu cuenta.', perHour: '/h', error: 'No se pudo cargar tu pago.' },
}

export const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
export const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const dop = (n: number) => `RD$${Math.round(n).toLocaleString('en-US')}`
function range(a: string, b: string, lang: 'en' | 'es') {
  const f = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { month: 'short', day: 'numeric' })
  return `${f(a)} – ${f(b)}`
}
const weekday = (d: string, lang: 'en' | 'es') => new Date(`${d}T12:00:00`).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })

export async function fetchEarnings(): Promise<Earnings> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/employee-earnings', { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as Earnings
}

/** My workspace → My pay: live earnings (refreshes every minute), Estimated / Approved / Paid */
export default function MyPay({ lang = 'en', onData }: { lang?: 'en' | 'es'; onData?: (e: Earnings) => void }) {
  const t = T[lang]
  const [data, setData] = useState<Earnings | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => fetchEarnings().then(d => { if (alive) { setData(d); setError(null); onData?.(d) } }).catch(e => { if (alive) setError(e.message) })
    void load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <div className="portal-message portal-message-error">{t.error} {error}</div>
  if (!data) return <div className="loading-text">…</div>
  const rate = data.dopRate
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="mypay-grid">
        <div className="mypay-tile">
          <div className="mypay-label">{t.today}</div>
          <div className="mypay-big">{usd(data.today.amount)}</div>
          <div className="mypay-sub">{hm(data.today.seconds)}</div>
        </div>
        <div className="mypay-tile">
          <div className="mypay-label">{t.period}</div>
          <div className="mypay-big">{usd(data.totals.amount)}</div>
          <div className="mypay-sub">{hm(data.totals.seconds)}{rate ? ` · ≈ ${dop(data.totals.amount * rate)}` : ''}</div>
        </div>
      </div>

      {data.periods.length === 0 && <div style={{ fontSize: 14, color: 'var(--muted)' }}>{t.none}</div>}
      {data.periods.map(p => (
        <div key={p.key} className="mypay-period">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{p.label}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{range(p.start, p.end, lang)} · {t.paidOn} {weekday(p.payday, lang)}{p.payRate ? ` · ${usd(p.payRate)}${t.perHour}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{usd(p.amount)}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{hm(p.seconds)}{p.premiumSeconds > 0 ? ` · ${hm(p.premiumSeconds)} ${t.night}` : ''}</div>
            </div>
          </div>
          {p.missingRate ? <div style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>{t.missing}</div> : (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {p.approvedAmount > 0 && <span className="badge badge-green">{t.approved} {usd(p.approvedAmount)}</span>}
              {p.pendingAmount > 0 && <span className="badge badge-gray">{t.estimated} {usd(p.pendingAmount)}</span>}
            </div>
          )}
        </div>
      ))}

      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t.explain} {t.updated} {new Date(data.updatedAt).toLocaleTimeString(lang === 'es' ? 'es-DO' : 'en-US', { hour: 'numeric', minute: '2-digit' })}.</div>
    </div>
  )
}
