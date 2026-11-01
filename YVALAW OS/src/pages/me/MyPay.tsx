import { supabase } from '../../lib/supabase'
import { Banner, Skel } from '../../components/ui'
import { dop, usd } from '../../utils/format'
import { DICT, dateLabel, hm, locale, type Lang } from './i18n'

export type Earnings = {
  currency: string; dopRate: number | null
  today: { date: string; seconds: number; amount: number }
  trackingNow?: boolean
  lastActivityAt?: string | null
  lastActivityOn?: string | null
  periods: { key: string; label: string; schedule: string; start: string; end: string; payday: string; seconds: number; premiumSeconds: number
             amount: number; approvedAmount: number; pendingAmount: number; payRate: number; missingRate: boolean }[]
  totals: { seconds: number; amount: number; approvedAmount: number }
  paid: { payday: string; netUsd: number; netDop: number | null; paidAt: string | null }[]
  /** Own bonuses / deductions waiting for a payday (absent from an older function version) */
  pendingAdjustments?: PendingAdjustment[]
  updatedAt: string
}

/** payday = the payroll it is attached to (null = next payday); later = a later row of a repeat */
export type PendingAdjustment = { id: string; type: 'bonus' | 'deduction'; amount: number; reason: string; sequence: number; total: number; payday: string | null; later: boolean }

/** "+ $25.00" / "− $10.00" */
export const adjAmount = (a: PendingAdjustment) => `${a.type === 'bonus' ? '+' : '−'} ${usd(Math.abs(a.amount))}`
/** "next payday" / "payday Fri, Nov 6" / "a later payday" */
export function adjWhen(a: PendingAdjustment, lang: Lang): string {
  const t = DICT[lang].pay
  return a.later ? t.laterPayday : a.payday ? `${t.payday} ${dateLabel(a.payday, lang)}` : t.nextPayday
}

/** "+ $25.00 bonus · next payday" line under a pay period */
function PendingLine({ a, lang }: { a: PendingAdjustment; lang: Lang }) {
  const t = DICT[lang].pay
  return (
    <span className="mw-period__adj">
      <span className={`num ${a.type === 'bonus' ? 't-success' : 't-danger'}`}>{adjAmount(a)}</span> {a.type === 'bonus' ? t.bonusLower : t.deductionLower} · {adjWhen(a, lang)}
      {a.total > 1 ? ` (${t.of(a.sequence, a.total)})` : ''}{a.reason ? <span className="mw-period__adj-reason"> · {a.reason}</span> : null}
    </span>
  )
}

export async function fetchEarnings(): Promise<Earnings> {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/employee-earnings', { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as Earnings
}

/** USD amount shown in DOP when YVA has saved an exchange rate (employees are paid in DOP), else USD */
export const money = (usdAmount: number, rate: number | null) => (rate ? dop(usdAmount * rate) : usd(usdAmount))

/** The soonest payday across the current pay periods, and what it will pay so far */
export function nextPayday(e: Earnings | null): { payday: string; amount: number } | null {
  if (!e || e.periods.length === 0) return null
  const payday = [...e.periods].map(p => p.payday).sort()[0]
  return { payday, amount: e.periods.filter(p => p.payday === payday).reduce((s, p) => s + p.amount, 0) }
}

/** My workspace → My pay: current pay period(s) in DOP with approved / not approved yet (live, refreshed every
 *  minute by EmployeeWorkspace), today's earnings, and how the numbers work. */
export default function MyPay({ data, error, lang = 'en' }: { data: Earnings | null; error: string | null; lang?: Lang }) {
  const t = DICT[lang]
  if (error && !data) return <Banner tone="danger">{t.pay.error} {error}</Banner>
  if (!data) return <section className="card mw-period"><Skel w={180} h={13} /><Skel w={220} h={34} /><Skel w={260} h={13} /></section>
  const rate = data.dopRate
  // Waiting bonuses / deductions for the coming payday go under the period paid that day (attached ones),
  // or under the soonest-paid period (not attached to a payroll yet = next payday)
  const upcoming = (data.pendingAdjustments || []).filter(a => !a.later)
  const soonest = data.periods.length ? [...data.periods].sort((a, b) => a.payday.localeCompare(b.payday))[0].key : null
  const homeOf = (a: PendingAdjustment) => data.periods.find(p => a.payday && p.payday === a.payday)?.key ?? soonest
  return (
    <>
      {data.periods.length === 0 && <div className="card card-empty">{t.pay.none}</div>}
      {data.periods.length === 0 && upcoming.length > 0 && (
        <section className="card mw-period mw-period--adj">{upcoming.map(a => <PendingLine key={a.id} a={a} lang={lang} />)}</section>
      )}
      {data.periods.map(p => (
        <section key={p.key} className="card mw-period">
          <span className="mw-period__label">{t.pay.thisPeriod} · {dateLabel(p.start, lang, { month: 'short', day: 'numeric' })} – {dateLabel(p.end, lang, { month: 'short', day: 'numeric' })}{data.periods.length > 1 || p.key !== 'yva' ? ` · ${p.label}` : ''}</span>
          <span className="mw-period__amount num">{money(p.amount, rate)}</span>
          <span className="mw-period__sub">
            {rate ? `${usd(p.amount)} · ` : ''}{hm(p.seconds)}{p.premiumSeconds > 0 ? ` (${hm(p.premiumSeconds)} ${t.pay.night})` : ''}
            {p.payRate ? ` · ${usd(p.payRate)}${t.pay.perHour}` : ''} · {t.pay.paidOn} {dateLabel(p.payday, lang)}
          </span>
          {p.missingRate ? <span className="mw-period__warn">{t.pay.missing}</span> : (
            <div className="mw-pills">
              {p.approvedAmount > 0 && <span className="pill pill--success mw-pill">{money(p.approvedAmount, rate)} {t.status.approved}</span>}
              {p.pendingAmount > 0 && <span className="pill pill--warning mw-pill">{money(p.pendingAmount, rate)} {t.status.waiting}</span>}
            </div>
          )}
          {upcoming.some(a => homeOf(a) === p.key) && (
            <div className="mw-period__adjs">{upcoming.filter(a => homeOf(a) === p.key).map(a => <PendingLine key={a.id} a={a} lang={lang} />)}</div>
          )}
        </section>
      ))}
      <p className="mw-foot">
        {t.pay.today}: <strong className="num">{money(data.today.amount, rate)}</strong> · {hm(data.today.seconds)}.{' '}
        {t.pay.explain} {t.pay.updated} {new Date(data.updatedAt).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' })}.
      </p>
    </>
  )
}
