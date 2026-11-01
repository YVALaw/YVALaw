// Client portal shell (redesign 2026-11, designs/Client Portal.dc.html): header with the page name and the
// client's name, avatar menu (Settings, Sign out), floating navy dock with six items (bottom dock on phones),
// and the gold staff-preview banner. Preview keeps ?preview=<clientId> on every link (portalNav).
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { signOutAndForgetDevice } from '../services/notifications'
import { loadPortalClient } from '../services/portalStorage'
import { useRole } from '../context/RoleContext'
import { Ic, P } from './Icon'
import { PageLoading, useIsMobile } from './ui'
import { initials } from '../utils/format'

type Props = { children: ReactNode; previewClientId?: string }

const DOCK = [
  { key: 'dashboard', label: 'Home',      short: 'Home',     title: 'Home',      icon: P.home },
  { key: 'billing',   label: 'Billing',   short: 'Billing',  title: 'Billing',   icon: P.invoices },
  { key: 'team',      label: 'Team',      short: 'Team',     title: 'My team',   icon: P.clients },
  { key: 'projects',  label: 'Projects',  short: 'Projects', title: 'Projects',  icon: P.projects },
  { key: 'documents', label: 'Documents', short: 'Docs',     title: 'Documents', icon: P.file },
  { key: 'messages',  label: 'Messages',  short: 'Messages', title: 'Messages',  icon: P.message },
] as const

export default function ClientShell({ children, previewClientId }: Props) {
  const { email, clientId: roleClientId } = useRole()
  const navigate = useNavigate()
  const location = useLocation()
  const mobile = useIsMobile()
  const isPreview = Boolean(previewClientId)
  const clientId = roleClientId ?? previewClientId ?? null
  const [clientName, setClientName] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    void loadPortalClient(clientId).then(c => { if (alive) setClientName(c?.company || c?.name || '') })
    return () => { alive = false }
  }, [clientId])

  // Navigating closes the menu and scrolls to the top
  useEffect(() => { setMenuOpen(false); window.scrollTo(0, 0) }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', key) }
  }, [menuOpen])

  async function handleSignOut() {
    await signOutAndForgetDevice()
    navigate('/login')
  }
  function handleExitPreview() {
    navigate(`/clients/${previewClientId}`)
  }
  // In preview mode, links carry the ?preview= param so every page keeps working
  function navPath(base: string) {
    return isPreview ? `${base}?preview=${encodeURIComponent(previewClientId!)}` : base
  }

  const current = location.pathname.split('/')[2] ?? 'dashboard'
  const pageTitle = current === 'settings' ? 'Settings' : DOCK.find(d => d.key === current)?.title ?? 'Client portal'
  const myInitials = email ? initials(email.split('@')[0].replace(/[._-]+/g, ' ')) : 'CL'

  return (
    <div className={`por-app${isPreview ? ' por-app--preview' : ''}`}>
      <a href="#portal-main" className="skip-link">Skip to content</a>

      {isPreview && (
        <div className="por-preview" role="status">
          <span>Previewing {clientName ? `${clientName}'s` : 'this client’s'} portal as staff</span>
          <button type="button" className="por-preview__exit" onClick={handleExitPreview}>Exit preview</button>
        </div>
      )}

      <header className="por-head">
        <img className="por-head__logo" src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <div className="por-head__text">
          <span className="por-head__title">{pageTitle}</span>
          <span className="por-head__sub">{clientName ? `${clientName} · client portal` : 'Client portal'}</span>
        </div>
        <div className="acct" ref={menuRef}>
          <button type="button" className="acct__btn por-head__avatar" aria-label="Account" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
            {isPreview ? <Ic d={P.eye} size={16} /> : myInitials}
          </button>
          {menuOpen && (
            <div className="acct__pop por-acct" role="menu">
              <div className="acct__who">
                <span className="acct__name por-acct__name">{clientName || 'Client portal'}</span>
                {isPreview ? <span className="acct__email">Staff preview</span> : email && <span className="acct__email">{email}</span>}
                <span className="acct__role">CLIENT</span>
              </div>
              <button type="button" role="menuitem" className="menu__item" onClick={() => { setMenuOpen(false); navigate(navPath('/portal/settings')) }}><Ic d={P.gear} />Settings</button>
              {isPreview
                ? <button type="button" role="menuitem" className="menu__item menu__item--danger" onClick={handleExitPreview}><Ic d={P.out} />Exit preview</button>
                : <button type="button" role="menuitem" className="menu__item menu__item--danger" onClick={() => void handleSignOut()}><Ic d={P.out} />Sign out</button>}
            </div>
          )}
        </div>
      </header>

      <main className="por-main" id="portal-main">
        <Suspense fallback={<PageLoading />}>{children}</Suspense>
      </main>

      <nav className={`dock por-dock${mobile ? ' por-dock--phone' : ''}`} aria-label="Portal">
        {DOCK.map(d => {
          const on = current === d.key
          return (
            <button key={d.key} type="button" aria-label={d.label} aria-current={on ? 'page' : undefined}
              className={`por-dock__item${on ? ' por-dock__item--on' : ''}`}
              onClick={() => navigate(navPath(`/portal/${d.key}`))}>
              <Ic d={d.icon} size={18} />
              <span className="por-dock__label">{mobile ? d.short : d.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
