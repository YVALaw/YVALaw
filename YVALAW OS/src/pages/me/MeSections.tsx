// My workspace sections (Step 7): Home, Requests, My client, Documents, Company, Profile.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DICT, locale, type Lang } from './i18n'
import { fetchEarnings, hm, usd, type Earnings } from './MyPay'
import ManualTime from './ManualTime'
import NotificationSettings from '../../components/NotificationSettings'
import { EMPLOYEE_KINDS } from '../../lib/notifications'
import {
  cancelTimeOff, loadAnnouncements, loadEmployeeDocuments, loadHolidays, loadTimeOff, openEmployeeDocument, requestTimeOff,
  type Announcement, type EmployeeDocument, type Holiday, type TimeOffRequest,
} from '../../services/workspace'
import { localParts } from '../../utils/moneyRules'

export type MyEmployee = { id: string; name: string; employeeNumber: string | null; email: string | null; phone: string | null; role: string | null; timezone: string | null
  defaultShiftStart: string | null; defaultShiftEnd: string | null; photoUrl: string | null; worksFor: 'client' | 'yva'; manualTimeAllowed: boolean }
export type MyProject = { id: string; name: string; clientName: string | null; status: string | null; supervisor?: { name: string | null; email: string | null; phone: string | null } | null; instructions?: string | null }

const DOWNLOAD_URL = import.meta.env.VITE_YVA_TIME_DOWNLOAD_URL as string | undefined
const dateLabel = (d: string, lang: Lang, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(lang), o)

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

export function Card({ title, sub, children, id }: { title: string; sub?: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="me-card" id={id}>
      <div className="me-card-head"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
      <div className="me-card-body">{children}</div>
    </section>
  )
}

// ── Home ─────────────────────────────────────────────────────────────────────
export function MeHome({ e, lang, go }: { e: MyEmployee; lang: Lang; go: (s: string) => void }) {
  const t = DICT[lang]
  const [earn, setEarn] = useState<Earnings | null>(null)
  const [weekSec, setWeekSec] = useState<number | null>(null)
  const [notices, setNotices] = useState<Announcement[]>([])
  const [holiday, setHoliday] = useState<Holiday | null>(null)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const load = () => fetchEarnings().then(setEarn).catch(() => {})
    void load(); const id = setInterval(load, 60_000)
    const today = localParts(Date.now()).date
    void (async () => {
      const d = new Date(`${today}T12:00:00Z`); const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
      const { data } = await supabase.from('tracker_blocks').select('seconds,status').eq('employee_id', e.id).gte('block_start', new Date(`${mon.toISOString().slice(0, 10)}T04:00:00Z`).toISOString()).in('status', ['tracked', 'approved'])
      setWeekSec((data || []).reduce((s, b) => s + (b.seconds as number), 0))
    })()
    void loadAnnouncements().then(r => setNotices(r.rows.slice(0, 3)))
    void loadHolidays(today).then(h => setHoliday(h[0] ?? null))
    void Promise.all([loadTimeOff({ status: 'pending' }), supabase.from('manual_time_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')])
      .then(([a, b]) => setPending(a.rows.length + (b.count || 0)))
    return () => clearInterval(id)
  }, [e.id])
  const target = weeklyTargetSeconds(e)
  const pct = weekSec === null ? 0 : Math.min(100, Math.round((weekSec / target) * 100))
  return (
    <div className="me-stack">
      <div className={`me-status ${earn?.trackingNow ? 'on' : ''}`}>
        <span className="me-dot" />
        <div style={{ flex: 1 }}>
          <strong>{earn?.trackingNow ? t.home.trackingNow : t.home.notTracking}</strong>
          {earn?.lastActivityAt && !earn.trackingNow && <div className="me-muted">{t.home.lastActive}: {new Date(earn.lastActivityAt).toLocaleString(locale(lang), { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>}
        </div>
      </div>
      <div className="mypay-grid">
        <button className="mypay-tile me-tile-btn" onClick={() => go('pay')}>
          <div className="mypay-label">{t.home.today}</div>
          <div className="mypay-big">{earn ? usd(earn.today.amount) : '—'}</div>
          <div className="mypay-sub">{earn ? hm(earn.today.seconds) : ''}</div>
        </button>
        <button className="mypay-tile me-tile-btn" onClick={() => go('time')}>
          <div className="mypay-label">{t.home.week}</div>
          <div className="mypay-big">{weekSec === null ? '—' : hm(weekSec)}</div>
          <div className="mypay-sub">{t.home.target} {hm(target)} {t.home.targetSuffix}</div>
          <div className="me-progress"><span style={{ width: `${pct}%` }} /></div>
        </button>
      </div>
      {pending > 0 && <button className="me-banner" onClick={() => go('requests')}>{pending} {t.home.pendingRequests}</button>}
      {notices.length > 0 && (
        <Card title={t.home.notices}>
          {notices.map(n => (
            <button key={n.id} className="me-list-row" onClick={() => go('company')}>
              <strong>{n.pinned ? '📌 ' : ''}{n.title}</strong>
              <span className="me-muted me-clamp">{n.body}</span>
            </button>
          ))}
        </Card>
      )}
      {holiday && <div className="me-banner neutral">{t.home.nextHoliday}: <strong>{holiday.name}</strong> · {dateLabel(holiday.day, lang)}</div>}
      <Card title={t.profile.app}>
        {DOWNLOAD_URL ? <><a className="btn-primary" href={DOWNLOAD_URL}>{t.home.getApp}</a><p className="me-muted" style={{ marginTop: 8 }}>{t.home.appHint}</p></> : <p className="me-muted">{t.home.noApp}</p>}
        <p className="me-muted" style={{ marginTop: 8 }}>{e.worksFor === 'yva' ? t.home.screenshotsOff : t.home.screenshotsOn}</p>
      </Card>
    </div>
  )
}

// ── Requests ─────────────────────────────────────────────────────────────────
export function MeRequests({ e, projects, lang }: { e: MyEmployee; projects: MyProject[]; lang: Lang }) {
  const t = DICT[lang].requests
  const today = localParts(Date.now()).date
  const [list, setList] = useState<TimeOffRequest[]>([])
  const [form, setForm] = useState({ kind: 'vacation', start: today, end: today, halfDay: false, note: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => void loadTimeOff().then(r => { setList(r.rows); if (r.error) setMsg({ ok: false, text: r.error }) })
  useEffect(load, [])
  async function send() {
    if (form.end < form.start) { setMsg({ ok: false, text: t.badDates }); return }
    setBusy(true); setMsg(null)
    try { await requestTimeOff(form); setMsg({ ok: true, text: t.sent }); setForm(f => ({ ...f, note: '' })); load() } catch (err) { setMsg({ ok: false, text: (err as Error).message }) }
    setBusy(false)
  }
  const badge = (s: TimeOffRequest['status']) => ({ pending: 'badge-yellow', approved: 'badge-green', declined: 'badge-red', cancelled: 'badge-gray' })[s]
  return (
    <div className="me-stack">
      <Card title={t.timeOff} sub={t.timeOffSub}>
        <div className="me-form">
          <label>{t.kind}<select className="form-select" value={form.kind} onChange={ev => setForm(f => ({ ...f, kind: ev.target.value }))}>
            {(['vacation', 'sick', 'personal', 'other'] as const).map(k => <option key={k} value={k}>{t.kinds[k]}</option>)}</select></label>
          <label>{t.from}<input className="form-input" type="date" value={form.start} onChange={ev => setForm(f => ({ ...f, start: ev.target.value, end: f.end < ev.target.value ? ev.target.value : f.end }))} /></label>
          <label>{t.to}<input className="form-input" type="date" value={form.end} min={form.start} onChange={ev => setForm(f => ({ ...f, end: ev.target.value }))} /></label>
          <label className="me-check"><input type="checkbox" checked={form.halfDay} onChange={ev => setForm(f => ({ ...f, halfDay: ev.target.checked }))} /> {t.halfDay}</label>
          <label className="me-wide">{t.note}<input className="form-input" value={form.note} maxLength={500} onChange={ev => setForm(f => ({ ...f, note: ev.target.value }))} /></label>
          <div className="me-wide"><button className="btn-primary" disabled={busy} onClick={() => void send()}>{busy ? t.sending : t.send}</button></div>
        </div>
        {msg && <div className={`portal-message ${msg.ok ? 'portal-message-success' : 'portal-message-error'}`} style={{ marginTop: 10 }}>{msg.text}</div>}
        <div style={{ marginTop: 14 }}>
          <div className="mypay-label" style={{ marginBottom: 6 }}>{t.mine}</div>
          {list.length === 0 && <div className="me-muted">{t.none}</div>}
          {list.map(r => (
            <div key={r.id} className="me-list-row static">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{t.kinds[r.kind]} · {dateLabel(r.start_date, lang)}{r.end_date !== r.start_date ? ` – ${dateLabel(r.end_date, lang)}` : ''}{r.half_day ? ` (${t.halfDay.toLowerCase()})` : ''}</strong>
                {(r.note || r.decision_note) && <span className="me-muted">{r.note}{r.decision_note ? ` · YVA: ${r.decision_note}` : ''}</span>}
              </div>
              <span className={`badge ${badge(r.status)}`}>{t.status[r.status]}</span>
              {r.status === 'pending' && <button className="btn-ghost btn-sm" onClick={() => void cancelTimeOff(r.id).then(load)}>{t.cancel}</button>}
            </div>
          ))}
        </div>
      </Card>
      <Card title={t.missing} sub={t.missingSub} id="manual">
        {e.manualTimeAllowed ? <ManualTime employeeId={e.id} isYva={e.worksFor === 'yva'} projects={projects} lang={lang} /> : <p className="me-muted">{t.missingOff}</p>}
      </Card>
    </div>
  )
}

// ── My client ────────────────────────────────────────────────────────────────
export function MeClient({ e, projects, lang }: { e: MyEmployee; projects: MyProject[]; lang: Lang }) {
  const t = DICT[lang].client
  if (projects.length === 0) return <Card title={t.title}><p className="me-muted">{e.worksFor === 'yva' ? t.yvaTeam : t.none}</p></Card>
  return (
    <div className="me-stack">
      {projects.map(p => (
        <Card key={p.id} title={p.clientName || p.name} sub={p.clientName ? p.name : undefined}>
          <div className="mypay-label">{t.supervisor}</div>
          {p.supervisor ? (
            <div style={{ fontSize: 14, margin: '4px 0 12px' }}>
              <strong>{p.supervisor.name}</strong>
              {p.supervisor.email && <div><a href={`mailto:${p.supervisor.email}`}>{p.supervisor.email}</a></div>}
              {p.supervisor.phone && <div><a href={`tel:${p.supervisor.phone}`}>{p.supervisor.phone}</a> · <a href={`https://wa.me/${p.supervisor.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></div>}
            </div>
          ) : <p className="me-muted" style={{ margin: '4px 0 12px' }}>—</p>}
          <div className="mypay-label">{t.instructions}</div>
          <p style={{ whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.6, margin: '4px 0 0' }}>{p.instructions || <span className="me-muted">{t.noInstructions}</span>}</p>
        </Card>
      ))}
    </div>
  )
}

// ── Documents ────────────────────────────────────────────────────────────────
export function MeDocuments({ lang }: { lang: Lang }) {
  const t = DICT[lang].docs
  const [docs, setDocs] = useState<EmployeeDocument[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { void loadEmployeeDocuments().then(r => setDocs(r.rows)) }, [])
  return (
    <Card title={t.title} sub={t.sub}>
      {err && <div className="portal-message portal-message-error">{err}</div>}
      {docs?.length === 0 && <p className="me-muted">{t.none}</p>}
      {docs?.map(d => (
        <div key={d.id} className="me-list-row static">
          <div style={{ flex: 1, minWidth: 0 }}><strong>{d.title}</strong><span className="me-muted">{t.categories[d.category]} · {new Date(d.created_at).toLocaleDateString(locale(lang))}</span></div>
          <button className="btn-ghost btn-sm" onClick={() => void openEmployeeDocument(d).catch(x => setErr(x.message))}>{t.open}</button>
        </div>
      ))}
    </Card>
  )
}

// ── Company ──────────────────────────────────────────────────────────────────
export function MeCompany({ lang }: { lang: Lang }) {
  const t = DICT[lang].company
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  useEffect(() => { void loadAnnouncements().then(r => setItems(r.rows)); void loadHolidays(localParts(Date.now()).date).then(setHolidays) }, [])
  return (
    <div className="me-stack">
      <Card title={t.announcements}>
        {items?.length === 0 && <p className="me-muted">{t.none}</p>}
        {items?.map(a => (
          <article key={a.id} className="me-announcement">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{a.title}</strong>{a.pinned && <span className="badge badge-yellow">{t.pinned}</span>}
              <span className="me-muted" style={{ marginLeft: 'auto' }}>{a.published_at ? new Date(a.published_at).toLocaleDateString(locale(lang), { month: 'short', day: 'numeric' }) : ''}</span>
            </div>
            {a.body && <p>{a.body}</p>}
          </article>
        ))}
      </Card>
      <Card title={t.holidays}>
        {holidays.length === 0 && <p className="me-muted">{t.noHolidays}</p>}
        {holidays.map(h => <div key={h.id} className="me-list-row static"><strong style={{ minWidth: 110 }}>{dateLabel(h.day, lang)}</strong><span style={{ flex: 1 }}>{h.name}</span>{h.paid && <span className="badge badge-green">{t.paid}</span>}</div>)}
      </Card>
    </div>
  )
}

// ── Profile ──────────────────────────────────────────────────────────────────
export function MeProfile({ e, lang, setLang }: { e: MyEmployee; lang: Lang; setLang: (l: Lang) => void }) {
  const t = DICT[lang].profile
  const shift = e.defaultShiftStart && e.defaultShiftEnd ? `${e.defaultShiftStart} – ${e.defaultShiftEnd}` : '—'
  const rows: [string, string][] = [[t.name, e.name], [t.number, e.employeeNumber || '—'], [t.position, e.role || '—'], [t.email, e.email || '—'], [t.phone, e.phone || '—'], [t.timezone, e.timezone || '—'], [t.shift, shift]]
  return (
    <div className="me-stack">
      <Card title={t.language}>
        <div className="me-lang">
          <button className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')}>Español</button>
          <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
        </div>
      </Card>
      <Card title={t.details} sub={t.detailsSub}>
        <div className="me-details">{rows.map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div>
      </Card>
      <Card title={t.notifications} sub={t.notificationsSub}><NotificationSettings kinds={EMPLOYEE_KINDS} lang={lang} /></Card>
      <button className="btn-ghost" onClick={() => void supabase.auth.signOut()}>{DICT[lang].signOut}</button>
    </div>
  )
}
