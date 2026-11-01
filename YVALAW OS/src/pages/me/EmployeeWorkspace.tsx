import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Ic, P } from '../../components/Icon'
import NotificationBell from '../../components/NotificationBell'
import { Banner, Segmented, Skel, useIsMobile } from '../../components/ui'
import { DICT, useMeLang } from './i18n'
import { fetchEarnings, type Earnings } from './MyPay'
import {
  BackToMore, MeClient, MeCompany, MeHome, MeMore, MePay, MeProfile, MeRequests, MeScreenshots, MeTime,
  type MyEmployee, type MyProject,
} from './MeSections'

type Dock = 'home' | 'time' | 'pay' | 'requests' | 'client' | 'more'
type Section = Dock | 'screenshots' | 'company' | 'documents' | 'profile'
const DOCK: Dock[] = ['home', 'time', 'pay', 'requests', 'client', 'more']
const DOCK_ICON: Record<Dock, string> = {
  home: P.home, time: P.time, pay: P.payroll, requests: P.approvals, client: P.building, more: P.more,
}
/** Pages reached from More keep "More" lit in the dock */
const dockOf = (s: Section): Dock => (DOCK.includes(s as Dock) ? s as Dock : 'more')

/** My workspace — the only area an invited employee can open (designs/My Workspace.dc.html: Spanish / English,
 *  phone first). Sections live in ?s= (notification links use it: ?s=requests, ?s=company, ?s=pay, ?s=time).
 *  staffView: a staff member opened their own workspace from the OS account menu (gold banner + back link). */
export default function EmployeeWorkspace({ staffView = false }: { staffView?: boolean } = {}) {
  const [lang, setLang] = useMeLang()
  const t = DICT[lang]
  const mobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const [employee, setEmployee] = useState<MyEmployee | null>(null)
  const [projects, setProjects] = useState<MyProject[]>([])
  // Stored as a kind (not text) so it follows the language switch; detail = the server's own message
  const [error, setError] = useState<{ kind: 'load' | 'network'; detail?: string } | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [earningsError, setEarningsError] = useState<string | null>(null)
  // The desktop app's "Add missing time" opens /me#manual. Switching to ?s=time drops the hash and the section
  // mounts only after the profile loads, so remember the request here and let My time scroll when it's rendered.
  const [scrollToManual, setScrollToManual] = useState(() => window.location.hash === '#manual')

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      try {
        const res = await fetch('/.netlify/functions/employee-me', { headers: { Authorization: `Bearer ${session.access_token}` } })
        const data = await res.json()
        if (!res.ok) { setError({ kind: 'load', detail: data.error }); return }
        setEmployee(data.employee); setProjects(data.projects || [])
      } catch { setError({ kind: 'network' }) }
    })()
  }, [])
  // Live earnings (Home status card + My pay): refreshed every minute while the page is visible
  useEffect(() => {
    let alive = true
    const load = () => fetchEarnings().then(d => { if (alive) { setEarnings(d); setEarningsError(null) } }).catch(e => { if (alive) setEarningsError((e as Error).message) })
    void load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  useEffect(() => { if (scrollToManual) setParams({ s: 'time' }, { replace: true }) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const isYva = employee?.worksFor === 'yva'
  const sections: Section[] = ['home', 'time', 'pay', 'requests', 'client', 'more', ...(isYva ? [] : ['screenshots' as Section]), 'company', 'documents', 'profile']
  const raw = params.get('s') as Section | null
  const section: Section = raw && sections.includes(raw) ? raw : 'home'
  const dock = dockOf(section)
  const go = (s: string) => { setParams(s === 'home' ? {} : { s }); window.scrollTo({ top: 0 }) }
  const title = section === 'documents' ? t.nav.more : t.nav[section]

  return (
    <div className="mw-app">
      {staffView && (
        <div className="mw-staffbar" role="status">
          <span>{employee ? t.staff.viewing(employee.name) : t.workspace}</span>
          <a className="mw-staffbar__btn" href={import.meta.env.BASE_URL}>{t.staff.back}</a>
        </div>
      )}
      <header className="mw-head">
        <img className="mw-head__logo" src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA" />
        <span className="mw-head__title">{title}</span>
        <div className="mw-lang">
          <Segmented label={t.language} value={lang} onChange={setLang} options={[{ value: 'en', label: 'EN' }, { value: 'es', label: 'ES' }]} />
        </div>
        <NotificationBell lang={lang} />
      </header>

      <main className="mw-main">
        {error && <Banner tone="danger">{error.kind === 'network' ? t.networkError : `${t.loadError}${error.detail ? ` (${error.detail})` : ''}`}</Banner>}
        {!employee && !error && (
          <div className="mw-stack" aria-label={t.loading} aria-busy="true">
            <Skel w={240} h={32} />
            <Skel h={78} r={16} />
            <div className="mw-stats"><Skel h={88} r={14} /><Skel h={88} r={14} /><Skel h={88} r={14} /></div>
            <Skel h={140} r={14} />
          </div>
        )}
        {employee && (
          <>
            {section === 'home' && <MeHome e={employee} lang={lang} go={go} earnings={earnings} earningsError={earningsError} />}
            {section === 'time' && <MeTime e={employee} projects={projects} lang={lang} go={go} scrollToManual={scrollToManual} onScrolled={() => setScrollToManual(false)} />}
            {section === 'pay' && <MePay e={employee} lang={lang} earnings={earnings} earningsError={earningsError} />}
            {section === 'requests' && <MeRequests e={employee} projects={projects} lang={lang} />}
            {section === 'client' && <MeClient e={employee} projects={projects} lang={lang} />}
            {(section === 'more' || section === 'documents') && <MeMore e={employee} lang={lang} go={go} />}
            {section === 'screenshots' && !isYva && <><BackToMore lang={lang} go={go} /><MeScreenshots e={employee} projects={projects} lang={lang} /></>}
            {section === 'company' && <><BackToMore lang={lang} go={go} /><MeCompany lang={lang} /></>}
            {section === 'profile' && <><BackToMore lang={lang} go={go} /><MeProfile e={employee} lang={lang} setLang={setLang} /></>}
          </>
        )}
      </main>

      <nav className={mobile ? 'dock dock--phone mw-dock mw-dock--phone' : 'dock mw-dock'} aria-label={t.dockLabel}>
        {DOCK.map(k => (
          <button type="button" key={k} aria-current={dock === k ? 'page' : undefined}
            className={mobile ? `dock__m mw-dock__m${dock === k ? ' dock__m--on' : ''}` : `dock__item${dock === k ? ' dock__item--on' : ''}`}
            onClick={() => go(k)}>
            <Ic d={DOCK_ICON[k]} size={18} />
            <span className="mw-dock__label">{t.nav[k]}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
