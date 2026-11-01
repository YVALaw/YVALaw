// My workspace screens (designs/My Workspace.dc.html): Home, My time, My pay, Requests, My client, More
// (+ My screenshots, Company, Documents, Profile). Data loading stays as in Step 7; only the look changed.
import { useEffect, useState } from 'react'
import { signOutAndForgetDevice } from '../../services/notifications'
import { Banner, Field, Segmented, Skel } from '../../components/ui'
import { Ic, P } from '../../components/Icon'
import NotificationSettings from '../../components/NotificationSettings'
import ScreenshotDay from '../time/ScreenshotDay'
import { EMPLOYEE_KINDS } from '../../lib/notifications'
import { cancelManualRequest, loadManualRequests, loadTrackerBlocks, type ManualRequest, type TrackerBlock } from '../../services/trackerStorage'
import {
  cancelTimeOff, loadAnnouncements, loadEmployeeDocuments, loadHolidays, loadTimeOff, openEmployeeDocument, requestTimeOff,
  type Announcement, type EmployeeDocument, type Holiday, type TimeOffRequest,
} from '../../services/workspace'
import { localParts } from '../../utils/moneyRules'
import { DICT, dateLabel, hm, locale, type Lang } from './i18n'
import { money, nextPayday, type Earnings } from './MyPay'
import MyPay from './MyPay'
import MyPayslips from './MyPayslips'
import MyHours, { addDays, mondayOf } from './MyHours'
import MyAdjustments from './MyAdjustments'
import ManualTime, { manualTargets } from './ManualTime'

export type MyEmployee = { id: string; name: string; employeeNumber: string | null; email: string | null; phone: string | null; role: string | null; timezone: string | null
  defaultShiftStart: string | null; defaultShiftEnd: string | null; photoUrl: string | null; worksFor: 'client' | 'yva'; manualTimeAllowed: boolean }
export type MyProject = { id: string; name: string; clientName: string | null; status: string | null; supervisor?: { name: string | null; email: string | null; phone: string | null } | null; instructions?: string | null }
export type Go = (s: string) => void

const DOWNLOAD_URL = import.meta.env.VITE_YVA_TIME_DOWNLOAD_URL as string | undefined

function clockMinutes(v: string | null): number | null {
  const m = String(v || '').trim().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i)
  if (!m) return null
  let h = Number(m[1]); const s = (m[3] || '').toLowerCase()
  if (s === 'pm' && h < 12) h += 12
  if (s === 'am' && h === 12) h = 0
  return h * 60 + Number(m[2] || 0)
}
/** Weekly target from the shift (Mon–Fri), else 40 h */
export function weeklyTargetSeconds(e: MyEmployee): number {
  const a = clockMinutes(e.defaultShiftStart), b = clockMinutes(e.defaultShiftEnd)
  if (a === null || b === null) return 40 * 3600
  const mins = (b - a + 1440) % 1440 || 480
  return Math.min(60, (mins / 60) * 5) * 3600
}
const shiftText = (e: MyEmployee, lang: Lang) => (e.defaultShiftStart && e.defaultShiftEnd
  ? `${DICT[lang].client.weekdays} · ${e.defaultShiftStart} – ${e.defaultShiftEnd}${e.timezone ? ` (${e.timezone})` : ''}` : null)
function greeting(lang: Lang): string {
  const h = new Date().getHours(), g = DICT[lang].greeting
  return h < 12 ? g.morning : h < 18 ? g.afternoon : g.evening
}
const range = (a: string, b: string, lang: Lang) => (a === b ? dateLabel(a, lang, { month: 'short', day: 'numeric' })
  : `${dateLabel(a, lang, { month: 'short', day: 'numeric' })} – ${dateLabel(b, lang, { month: 'short', day: 'numeric' })}`)

/** White card with the mockup's 15px title (and an optional muted line under it) */
export function Section({ title, sub, id, children, className }: { title?: string; sub?: string; id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`} id={id}>
      {title && <h2 className="mw-card-title">{title}</h2>}
      {sub && <p className="mw-card-sub">{sub}</p>}
      {children}
    </section>
  )
}

// ── Home ─────────────────────────────────────────────────────────────────────
export function MeHome({ e, lang, go, earnings, earningsError }: { e: MyEmployee; lang: Lang; go: Go; earnings: Earnings | null; earningsError: string | null }) {
  const t = DICT[lang]
  const [week, setWeek] = useState<TrackerBlock[] | null>(null)
  const [notices, setNotices] = useState<Announcement[]>([])
  const [holiday, setHoliday] = useState<Holiday | null | undefined>(undefined)
  const [pending, setPending] = useState<{ count: number; first: string | null } | null>(null)
  useEffect(() => {
    const today = localParts(Date.now()).date
    const mon = mondayOf(Date.now())
    void loadTrackerBlocks(mon, addDays(mon, 7), e.id).then(b => setWeek(b.filter(x => x.status === 'tracked' || x.status === 'approved')))
    void loadAnnouncements().then(r => setNotices(r.rows.slice(0, 3)))
    void loadHolidays(today).then(h => setHoliday(h[0] ?? null))
    void Promise.all([loadTimeOff({ status: 'pending' }), loadManualRequests('pending')]).then(([a, b]) => {
      const first = a.rows[0] ? `${t.requests.timeOff} ${range(a.rows[0].start_date, a.rows[0].end_date, lang)}` : b[0] ? `${t.requests.missingTime} ${new Date(b[0].startsAt).toLocaleDateString(locale(lang), { month: 'short', day: 'numeric' })}` : null
      setPending({ count: a.rows.length + b.length, first })
    })
  }, [e.id])   // eslint-disable-line react-hooks/exhaustive-deps
  const weekSec = week?.reduce((s, b) => s + b.seconds, 0) ?? null
  const waitSec = week?.filter(b => b.status === 'tracked').reduce((s, b) => s + b.seconds, 0) ?? 0
  const target = weeklyTargetSeconds(e)
  const pay = nextPayday(earnings)
  const first = e.name.split(' ')[0]
  const tracking = !!earnings?.trackingNow

  return (
    <div className="mw-stack">
      <h1 className="mw-h1">{greeting(lang)}, {first}</h1>
      <section className="mw-status" aria-live="polite">
        <span className={`mw-status__dot${tracking ? ' mw-status__dot--on' : ''}`} aria-hidden />
        <div className="mw-status__text">
          <span className="mw-status__title">{tracking ? t.home.trackingNow : t.home.notTracking}</span>
          <span className="mw-status__sub">
            {earningsError && !earnings ? t.home.earningsError : <>
              {!tracking && earnings?.lastActivityAt && <>{t.home.lastActive} {new Date(earnings.lastActivityAt).toLocaleString(locale(lang), { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · </>}
              {earnings ? <>{t.home.today} {hm(earnings.today.seconds)} · {money(earnings.today.amount, null)}</> : '…'}
            </>}
          </span>
        </div>
        {pay && (
          <button type="button" className="mw-status__pay" onClick={() => go('pay')}>
            <span className="mw-status__pay-label">{t.home.payday} · {dateLabel(pay.payday, lang)}</span>
            <span className="mw-status__pay-amount num">{money(pay.amount, earnings?.dopRate ?? null)}</span>
          </button>
        )}
      </section>

      <div className="mw-stats">
        <button type="button" className="mw-stat" onClick={() => go('time')}>
          <span className="mw-stat__label">{t.home.hoursWeek}</span>
          <span className="mw-stat__value num">{weekSec === null ? <Skel w={90} h={22} /> : hm(weekSec)}</span>
          <span className={`mw-stat__note${waitSec > 0 ? ' t-warning' : ''}`}>{waitSec > 0 ? `${hm(waitSec)} ${t.status.waiting}` : t.home.ofTarget(hm(target))}</span>
        </button>
        <button type="button" className="mw-stat" onClick={() => go('company')}>
          <span className="mw-stat__label">{t.home.nextHoliday}</span>
          <span className="mw-stat__value">{holiday === undefined ? <Skel w={90} h={22} /> : holiday ? dateLabel(holiday.day, lang) : '—'}</span>
          <span className="mw-stat__note">{holiday ? holiday.name : holiday === null ? t.home.noHoliday : ''}</span>
        </button>
        <button type="button" className="mw-stat" onClick={() => go('requests')}>
          <span className="mw-stat__label">{t.home.requestsWaiting}</span>
          <span className="mw-stat__value num">{pending === null ? <Skel w={30} h={22} /> : pending.count}</span>
          <span className="mw-stat__note">{pending ? pending.first ?? t.home.noneWaiting : ''}</span>
        </button>
      </div>

      {notices.length > 0 && (
        <Section title={t.home.notices}>
          {notices.map(n => (
            <button type="button" key={n.id} className="mw-row mw-notice" onClick={() => go('company')}>
              <span className="mw-row__title">{n.pinned && <Ic d={P.pin} size={14} title={t.company.pinned} />} {n.title}</span>
              {n.body && <span className="mw-notice__body">{n.body}</span>}
            </button>
          ))}
        </Section>
      )}

      {DOWNLOAD_URL ? <a className="mw-getapp" href={DOWNLOAD_URL}><Ic d={P.download} size={17} />{t.home.getApp}</a> : <div className="mw-getapp mw-getapp--off">{t.home.noApp}</div>}
      <p className="mw-foot">{DOWNLOAD_URL ? `${t.home.appHint} ` : ''}{e.worksFor === 'yva' ? t.home.screenshotsOff : t.home.screenshotsOn}</p>
    </div>
  )
}

// ── My time ──────────────────────────────────────────────────────────────────
export function MeTime({ e, projects, lang, go, scrollToManual, onScrolled }: { e: MyEmployee; projects: MyProject[]; lang: Lang; go: Go; scrollToManual?: boolean; onScrolled?: () => void }) {
  const t = DICT[lang]
  const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]))
  // /me#manual (desktop app's "Add missing time"): the day rows above have a fixed height, so scroll once rendered
  useEffect(() => {
    if (!scrollToManual) return
    const id = window.setTimeout(() => { document.getElementById('manual')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); onScrolled?.() }, 120)
    return () => window.clearTimeout(id)
  }, [scrollToManual])   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mw-stack">
      <MyHours employeeId={e.id} lang={lang} />
      <Section title={t.manual.title} sub={t.manual.sub} id="manual" className="mw-anchor">
        <div className="mw-pad">
          {e.manualTimeAllowed
            ? <ManualTime employeeId={e.id} isYva={e.worksFor === 'yva'} projects={projects} lang={lang} onSeeRequests={() => go('requests')} />
            : <p className="mw-muted">{t.manual.off}</p>}
        </div>
      </Section>
      <MyAdjustments projectNames={projectNames} lang={lang} />
    </div>
  )
}

// ── My pay ───────────────────────────────────────────────────────────────────
export function MePay({ e, lang, earnings, earningsError }: { e: MyEmployee; lang: Lang; earnings: Earnings | null; earningsError: string | null }) {
  return (
    <div className="mw-stack">
      <MyPay data={earnings} error={earningsError} lang={lang} />
      <MyPayslips employeeName={e.name} employeeNumber={e.employeeNumber} lang={lang} />
    </div>
  )
}

// ── Requests ─────────────────────────────────────────────────────────────────
/** Whole days from date a to date b (YYYY-MM-DD) */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const shiftDate = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
type Row = { key: string; sort: number; title: string; note: string; status: string; tone: 'warning' | 'success' | 'danger' | 'neutral'; cancel?: () => Promise<void> }
const TONE: Record<string, Row['tone']> = { pending: 'warning', approved: 'success', declined: 'danger', rejected: 'danger', cancelled: 'neutral' }

export function MeRequests({ e, projects, lang }: { e: MyEmployee; projects: MyProject[]; lang: Lang }) {
  const t = DICT[lang].requests
  const tm = DICT[lang].manual
  const today = localParts(Date.now()).date
  // Same rules as the database (migrate-step7-workspace.sql): end − start ≤ 60 days, start ≥ current_date − 30
  // (the database's date is UTC, which is ahead of the DR in the evening — use it so the check is never looser)
  const oldestStart = shiftDate(new Date().toISOString().slice(0, 10), -30)
  const [list, setList] = useState<TimeOffRequest[] | null>(null)
  const [manual, setManual] = useState<ManualRequest[]>([])
  const [form, setForm] = useState({ kind: 'vacation', start: today, end: today, halfDay: false, note: '' })
  // kind = a dictionary key (follows the language switch); text = a server message
  const [msg, setMsg] = useState<{ ok: boolean; key?: 'sent' | 'badDates' | 'tooLong' | 'tooOld'; text?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    void loadTimeOff().then(r => { setList(r.rows); if (r.error) setMsg({ ok: false, text: r.error }) })
    void loadManualRequests().then(setManual)
  }
  useEffect(load, [])
  async function send() {
    if (form.end < form.start) { setMsg({ ok: false, key: 'badDates' }); return }
    if (daysBetween(form.start, form.end) > 60) { setMsg({ ok: false, key: 'tooLong' }); return }
    if (form.start < oldestStart) { setMsg({ ok: false, key: 'tooOld' }); return }
    setBusy(true); setMsg(null)
    try { await requestTimeOff(form); setMsg({ ok: true, key: 'sent' }); setForm(f => ({ ...f, note: '' })); load() } catch (err) { setMsg({ ok: false, text: (err as Error).message }) }
    setBusy(false)
  }
  const fail = (err: unknown) => setMsg({ ok: false, text: (err as Error).message })
  const targets = manualTargets(projects, e.worksFor === 'yva')
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' })
  const rows: Row[] = [
    ...(list || []).map(r => ({
      key: `t:${r.id}`, sort: Date.parse(`${r.start_date}T12:00:00`),
      title: `${t.timeOff} · ${t.kinds[r.kind]} · ${range(r.start_date, r.end_date, lang)}${r.half_day ? ` (${t.halfDay.toLowerCase()})` : ''}`,
      note: [r.note, r.decision_note ? `YVA: ${r.decision_note}` : null].filter(Boolean).join(' · '),
      status: t.status[r.status], tone: TONE[r.status],
      cancel: r.status === 'pending' ? () => cancelTimeOff(r.id) : undefined,
    })),
    ...manual.map(r => ({
      key: `m:${r.id}`, sort: r.startsAt,
      title: `${t.missingTime} · ${clock(r.startsAt)}–${clock(r.endsAt)}, ${new Date(r.startsAt).toLocaleDateString(locale(lang), { weekday: 'short', month: 'short', day: 'numeric' })} · ${r.projectId ? targets.find(x => x.projectId === r.projectId)?.label ?? tm.project : r.workType ?? ''}`,
      note: [r.reason, r.status === 'approved' && r.approvedSeconds !== null ? `${Math.round(r.approvedSeconds / 60)} ${tm.added}` : null, r.decisionNote ? `${tm.yva}: ${r.decisionNote}` : null].filter(Boolean).join(' · '),
      status: t.status[r.status], tone: TONE[r.status],
      cancel: r.status === 'pending' ? () => cancelManualRequest(r.id) : undefined,
    })),
  ].sort((a, b) => b.sort - a.sort)

  return (
    <div className="mw-stack">
      {msg && <Banner tone={msg.ok ? 'success' : 'danger'} onClose={() => setMsg(null)}>{msg.key ? t[msg.key] : msg.text}</Banner>}
      <Section title={t.askOff} sub={t.askOffSub}>
        <div className="mw-pad mw-form-wrap">
          <div className="mw-form mw-form--two">
            <Field label={t.kind} full>
              <select className="select" value={form.kind} onChange={ev => setForm(f => ({ ...f, kind: ev.target.value }))}>
                {(['vacation', 'sick', 'personal', 'other'] as const).map(k => <option key={k} value={k}>{t.kinds[k]}</option>)}
              </select>
            </Field>
            <Field label={t.from}><input className="input" type="date" value={form.start} min={oldestStart} onChange={ev => setForm(f => ({ ...f, start: ev.target.value, end: f.end < ev.target.value ? ev.target.value : f.end }))} /></Field>
            <Field label={t.to}><input className="input" type="date" value={form.end} min={form.start} max={shiftDate(form.start, 60)} onChange={ev => setForm(f => ({ ...f, end: ev.target.value }))} /></Field>
            <Field label={t.note} full><input className="input" value={form.note} maxLength={500} onChange={ev => setForm(f => ({ ...f, note: ev.target.value }))} /></Field>
          </div>
          <label className="check mw-check">
            <input type="checkbox" checked={form.halfDay} onChange={ev => setForm(f => ({ ...f, halfDay: ev.target.checked }))} />
            <span className="check__box">{form.halfDay && <Ic d={P.check} size={12} stroke={3} />}</span>{t.halfDay}
          </label>
          <button type="button" className="btn btn--primary mw-submit" disabled={busy} onClick={() => void send()}>{busy ? t.sending : t.send}</button>
        </div>
      </Section>
      <Section title={t.mine}>
        {list === null && <div className="mw-row"><Skel h={36} /></div>}
        {list !== null && rows.length === 0 && <p className="mw-empty">{t.none}</p>}
        {rows.map(r => (
          <div key={r.key} className="mw-row mw-req">
            <div className="mw-row__main mw-req__main">
              <span className="mw-row__title">{r.title}</span>
              {r.note && <span className="mw-row__meta">{r.note}</span>}
            </div>
            <span className={`pill pill--${r.tone} mw-pill`}>{r.status}</span>
            {r.cancel && <button type="button" className="btn mw-row__btn" onClick={() => void r.cancel!().then(load).catch(fail)}>{t.cancel}</button>}
          </div>
        ))}
      </Section>
    </div>
  )
}

// ── My client ────────────────────────────────────────────────────────────────
export function MeClient({ e, projects, lang }: { e: MyEmployee; projects: MyProject[]; lang: Lang }) {
  const t = DICT[lang].client
  const shift = shiftText(e, lang)
  return (
    <div className="mw-stack">
      {projects.length === 0 && <div className="card card-empty">{e.worksFor === 'yva' ? t.yvaTeam : t.none}</div>}
      {projects.map(p => (
        <div key={p.id} className="mw-stack">
          <section className="card mw-info">
            <span className="mw-info__meta">{[p.clientName, p.name].filter(Boolean).join(' · ')}</span>
            {p.supervisor ? <>
              <span className="mw-info__lead">{t.supervisor}: {p.supervisor.name || '—'}</span>
              {(p.supervisor.email || p.supervisor.phone) && <span className="mw-info__text">{[p.supervisor.email, p.supervisor.phone].filter(Boolean).join(' · ')}</span>}
              <div className="mw-contact">
                {p.supervisor.phone && <a className="btn" href={`https://wa.me/${p.supervisor.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><Ic d={P.whatsapp} />{t.whatsapp}</a>}
                {p.supervisor.email && <a className="btn" href={`mailto:${p.supervisor.email}`}><Ic d={P.mail} />{t.email}</a>}
                {p.supervisor.phone && <a className="btn" href={`tel:${p.supervisor.phone}`}><Ic d={P.call} />{t.call}</a>}
              </div>
            </> : <span className="mw-info__text mw-muted">{t.noSupervisor}</span>}
          </section>
          <section className="card mw-info">
            <h2 className="mw-info__title">{t.instructions}</h2>
            {p.instructions ? <p className="mw-info__text mw-pre">{p.instructions}</p> : <p className="mw-info__text mw-muted">{t.noInstructions}</p>}
          </section>
        </div>
      ))}
      <section className="card mw-info">
        <h2 className="mw-info__title">{t.shift}</h2>
        <p className="mw-info__text">{shift ?? <span className="mw-muted">{t.noShift}</span>}</p>
      </section>
    </div>
  )
}

// ── More ─────────────────────────────────────────────────────────────────────
export function MeMore({ e, lang, go }: { e: MyEmployee; lang: Lang; go: Go }) {
  const t = DICT[lang]
  const items: { key: string; label: string; sub: string; icon: string; onClick: () => void; danger?: boolean }[] = [
    ...(e.worksFor === 'yva' ? [] : [{ key: 'screenshots', label: t.nav.screenshots, sub: t.more.screenshotsSub, icon: P.image, onClick: () => go('screenshots') }]),
    { key: 'company', label: t.nav.company, sub: t.more.companySub, icon: P.announce, onClick: () => go('company') },
    { key: 'profile', label: t.nav.profile, sub: t.more.profileSub, icon: P.user, onClick: () => go('profile') },
    { key: 'signout', label: t.signOut, sub: '', icon: P.out, onClick: () => void signOutAndForgetDevice(), danger: true },
  ]
  return (
    <div className="mw-stack">
      <nav className="card mw-menu" aria-label={t.nav.more}>
        {items.map(m => (
          <button type="button" key={m.key} className={`mw-menu__item${m.danger ? ' mw-menu__item--danger' : ''}`} onClick={m.onClick}>
            <Ic d={m.icon} size={18} />
            <span className="mw-menu__label">{m.label}</span>
            {m.sub && <span className="mw-menu__sub">{m.sub}</span>}
            {!m.danger && <Ic d={P.chevR} size={16} className="mw-menu__chev" />}
          </button>
        ))}
      </nav>
      <MeDocuments lang={lang} />
    </div>
  )
}

export function BackToMore({ lang, go }: { lang: Lang; go: Go }) {
  return <button type="button" className="back-link mw-back" onClick={() => go('more')}><Ic d={P.chevL} size={16} />{DICT[lang].backToMore}</button>
}

// ── My screenshots (client team) ─────────────────────────────────────────────
export function MeScreenshots({ e, projects, lang }: { e: MyEmployee; projects: MyProject[]; lang: Lang }) {
  const t = DICT[lang]
  const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]))
  return (
    <div className="mw-stack mw-shots">
      <p className="mw-shots__sub">{t.shots.sub}</p>
      <ScreenshotDay self={{ employeeId: e.id, projectNames }} lang={lang} />
    </div>
  )
}

// ── Documents ────────────────────────────────────────────────────────────────
const fileTag = (d: EmployeeDocument) => {
  const m = (d.mime_type || '').toLowerCase()
  return m.includes('pdf') ? 'PDF' : m.startsWith('image/') ? 'IMG' : m.includes('word') || m.includes('document') ? 'DOC' : 'FILE'
}
export function MeDocuments({ lang }: { lang: Lang }) {
  const t = DICT[lang].docs
  const [docs, setDocs] = useState<EmployeeDocument[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { void loadEmployeeDocuments().then(r => { setDocs(r.rows); if (r.error) setErr(r.error) }) }, [])
  return (
    <Section title={DICT[lang].nav.documents} id="documents">
      {err && <div className="mw-pad"><Banner tone="danger" onClose={() => setErr(null)}>{err}</Banner></div>}
      {docs === null && <div className="mw-row"><Skel h={36} /></div>}
      {docs?.length === 0 && <p className="mw-empty">{t.none}</p>}
      {docs?.map(d => (
        <div key={d.id} className="mw-row mw-doc">
          <span className="mw-doc__tag mono">{fileTag(d)}</span>
          <div className="mw-row__main">
            <span className="mw-row__title">{d.title}</span>
            <span className="mw-row__meta">{t.categories[d.category]} · {new Date(d.created_at).toLocaleDateString(locale(lang))}</span>
          </div>
          <button type="button" className="btn mw-row__btn" onClick={() => void openEmployeeDocument(d).catch(x => setErr(x.message))}>{t.download}</button>
        </div>
      ))}
    </Section>
  )
}

// ── Company ──────────────────────────────────────────────────────────────────
export function MeCompany({ lang }: { lang: Lang }) {
  const t = DICT[lang].company
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [holidays, setHolidays] = useState<Holiday[] | null>(null)
  useEffect(() => { void loadAnnouncements().then(r => setItems(r.rows)); void loadHolidays(localParts(Date.now()).date).then(setHolidays) }, [])
  return (
    <div className="mw-stack">
      <Section title={t.announcements}>
        {items === null && <div className="mw-row"><Skel h={40} /></div>}
        {items?.length === 0 && <p className="mw-empty">{t.none}</p>}
        {items?.map(a => (
          <article key={a.id} className="mw-row mw-announce">
            <div className="mw-announce__head">
              <span className="mw-row__title">{a.title}</span>
              {a.pinned && <span className="pill pill--gold">{t.pinned}</span>}
              <span className="mw-row__meta mw-announce__date">{a.published_at ? new Date(a.published_at).toLocaleDateString(locale(lang), { month: 'short', day: 'numeric' }) : ''}</span>
            </div>
            {a.body && <p className="mw-announce__body">{a.body}</p>}
          </article>
        ))}
      </Section>
      <Section title={t.holidays}>
        {holidays === null && <div className="mw-row"><Skel h={32} /></div>}
        {holidays?.length === 0 && <p className="mw-empty">{t.noHolidays}</p>}
        {holidays?.map(h => (
          <div key={h.id} className="mw-row">
            <span className="mw-holiday__day">{dateLabel(h.day, lang)}</span>
            <span className="mw-row__main mw-row__title">{h.name}</span>
            {h.paid && <span className="pill pill--success">{t.paid}</span>}
          </div>
        ))}
      </Section>
    </div>
  )
}

// ── Profile ──────────────────────────────────────────────────────────────────
export function MeProfile({ e, lang, setLang }: { e: MyEmployee; lang: Lang; setLang: (l: Lang) => void }) {
  const t = DICT[lang].profile
  const rows: [string, string][] = [[t.name, e.name], [t.number, e.employeeNumber || '—'], [t.position, e.role || '—'], [t.team, e.worksFor === 'yva' ? t.yvaTeam : t.clientTeam],
    [t.email, e.email || '—'], [t.phone, e.phone || '—'], [t.timezone, e.timezone || '—'], [t.shift, e.defaultShiftStart && e.defaultShiftEnd ? `${e.defaultShiftStart} – ${e.defaultShiftEnd}` : '—']]
  return (
    <div className="mw-stack">
      <Section title={t.details} sub={t.detailsSub}>
        <div className="info-grid mw-pad">{rows.map(([k, v]) => <div key={k} className="info"><span className="info__label">{k}</span><span className="info__value">{v}</span></div>)}</div>
      </Section>
      <Section title={DICT[lang].language}>
        <div className="mw-pad mw-lang-big">
          <Segmented label={DICT[lang].language} value={lang} onChange={setLang} options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]} />
        </div>
      </Section>
      <Section title={t.notifications} sub={t.notificationsSub}>
        <div className="mw-pad mw-notif"><NotificationSettings kinds={EMPLOYEE_KINDS} lang={lang} /></div>
      </Section>
      <button type="button" className="btn btn--danger mw-signout" onClick={() => void signOutAndForgetDevice()}><Ic d={P.out} />{DICT[lang].signOut}</button>
    </div>
  )
}
