import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { IconBriefcase, IconClock, IconDollar, IconFileText, IconHome, IconImage, IconInbox, IconMegaphone, IconMoreHorizontal, IconUser } from '../../components/Icon'
import NotificationBell from '../../components/NotificationBell'
import ScreenshotDay from '../time/ScreenshotDay'
import MyHours from './MyHours'
import MyPay from './MyPay'
import MyPayslips from './MyPayslips'
import MyAdjustments from './MyAdjustments'
import { DICT, useMeLang } from './i18n'
import { Card, MeClient, MeCompany, MeDocuments, MeHome, MeProfile, MeRequests, type MyEmployee, type MyProject } from './MeSections'

type Section = 'home' | 'time' | 'pay' | 'screenshots' | 'requests' | 'client' | 'documents' | 'company' | 'profile'
const ICON: Record<Section, (p: { size?: number }) => JSX.Element> = {
  home: IconHome, time: IconClock, pay: IconDollar, screenshots: IconImage, requests: IconInbox, client: IconBriefcase, documents: IconFileText, company: IconMegaphone, profile: IconUser,
}
const PHONE_TABS: Section[] = ['home', 'time', 'pay', 'requests']

/** My workspace — the only area an invited employee can open (PLAN.md Step 7: Spanish / English, phone-first) */
export default function EmployeeWorkspace() {
  const [lang, setLang] = useMeLang()
  const t = DICT[lang]
  const [params, setParams] = useSearchParams()
  const [employee, setEmployee] = useState<MyEmployee | null>(null)
  const [projects, setProjects] = useState<MyProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      try {
        const res = await fetch('/.netlify/functions/employee-me', { headers: { Authorization: `Bearer ${session.access_token}` } })
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Could not load your profile.'); return }
        setEmployee(data.employee); setProjects(data.projects || [])
      } catch { setError('Network error — could not load your profile.') }
    })()
  }, [])
  // The desktop app's "Add missing time" opens /me#manual
  useEffect(() => { if (window.location.hash === '#manual') setParams({ s: 'requests' }, { replace: true }) }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const isYva = employee?.worksFor === 'yva'
  const sections: Section[] = ['home', 'time', 'pay', ...(isYva ? [] : ['screenshots' as Section]), 'requests', 'client', 'documents', 'company', 'profile']
  const raw = params.get('s') as Section | null
  const section: Section = raw && sections.includes(raw) ? raw : 'home'
  const go = (s: string) => { setParams(s === 'home' ? {} : { s }); setMoreOpen(false); window.scrollTo({ top: 0 }) }
  const projectNames = Object.fromEntries(projects.map(p => [p.id, p.name]))

  return (
    <div className="me-shell">
      <aside className="me-side">
        <div className="me-brand"><img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" /><div><strong>YVA OS</strong><span>{t.workspace}</span></div></div>
        <nav>{sections.map(s => { const I = ICON[s]; return <button key={s} className={section === s ? 'active' : ''} onClick={() => go(s)}><I size={17} />{t.nav[s]}</button> })}</nav>
      </aside>
      <div className="me-main">
        <header className="me-top">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="me-hello">{employee ? `${t.hi}, ${employee.name.split(' ')[0]}` : t.workspace}</div>
            <div className="me-muted">{t.nav[section]}</div>
          </div>
          <button className="me-lang-pill" onClick={() => setLang(lang === 'es' ? 'en' : 'es')} aria-label="Language">{lang === 'es' ? 'EN' : 'ES'}</button>
          <NotificationBell lang={lang} />
        </header>
        <main className="me-content">
          {error && <div className="portal-message portal-message-error">{error}</div>}
          {!employee && !error && <div className="loading-text">{t.loading}</div>}
          {employee && (
            <>
              {section === 'home' && <MeHome e={employee} lang={lang} go={go} />}
              {section === 'time' && (
                <div className="me-stack">
                  <Card title={t.time.title} sub={t.time.sub}><MyHours employeeId={employee.id} lang={lang} /></Card>
                  <Card title={t.time.changes} sub={t.time.changesSub}><MyAdjustments projectNames={projectNames} lang={lang} /></Card>
                </div>
              )}
              {section === 'pay' && (
                <div className="me-stack">
                  <Card title={t.pay.title} sub={t.pay.sub}><MyPay lang={lang} /></Card>
                  <Card title={t.pay.payslips}><MyPayslips employeeName={employee.name} employeeNumber={employee.employeeNumber} lang={lang} /></Card>
                </div>
              )}
              {section === 'screenshots' && !isYva && <Card title={t.shots.title} sub={t.shots.sub}><ScreenshotDay self={{ employeeId: employee.id, projectNames }} lang={lang} /></Card>}
              {section === 'requests' && <MeRequests e={employee} projects={projects} lang={lang} />}
              {section === 'client' && <MeClient e={employee} projects={projects} lang={lang} />}
              {section === 'documents' && <MeDocuments lang={lang} />}
              {section === 'company' && <MeCompany lang={lang} />}
              {section === 'profile' && <MeProfile e={employee} lang={lang} setLang={setLang} />}
            </>
          )}
        </main>
      </div>

      <nav className="me-tabs">
        {PHONE_TABS.map(s => { const I = ICON[s]; return <button key={s} className={section === s ? 'active' : ''} onClick={() => go(s)}><I size={20} /><span>{t.nav[s]}</span></button> })}
        <button className={!PHONE_TABS.includes(section) ? 'active' : ''} onClick={() => setMoreOpen(o => !o)}><IconMoreHorizontal size={20} /><span>{t.more}</span></button>
      </nav>
      {moreOpen && (
        <div className="me-sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="me-sheet" onClick={ev => ev.stopPropagation()}>
            {sections.filter(s => !PHONE_TABS.includes(s)).map(s => { const I = ICON[s]; return <button key={s} className={section === s ? 'active' : ''} onClick={() => go(s)}><I size={18} />{t.nav[s]}</button> })}
          </div>
        </div>
      )}
    </div>
  )
}
