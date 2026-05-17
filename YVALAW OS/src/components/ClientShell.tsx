import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRole } from '../context/RoleContext'
import { IconEye } from './Icon'

type Props = { children: ReactNode; previewClientId?: string }

// ── Nav items ────────────────────────────────────────────────────────────────

type NavItem = { label: string; path: string; icon: ReactNode; shortLabel: string }

function HomeIcon()      { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }
function BillingIcon()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg> }
function TeamIcon()      { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> }
function ProjectsIcon()  { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg> }
function DocsIcon()      { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg> }
function MessagesIcon()  { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> }
function SettingsIcon()  { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg> }

const NAV_ITEMS: NavItem[] = [
  { label: 'Home',        path: '/portal/dashboard', icon: <HomeIcon />,     shortLabel: 'Home'     },
  { label: 'My Billing',  path: '/portal/billing',   icon: <BillingIcon />,  shortLabel: 'Billing'  },
  { label: 'My Team',     path: '/portal/team',      icon: <TeamIcon />,     shortLabel: 'Team'     },
  { label: 'My Projects', path: '/portal/projects',  icon: <ProjectsIcon />, shortLabel: 'Projects' },
  { label: 'Documents',   path: '/portal/documents', icon: <DocsIcon />,     shortLabel: 'Docs'     },
  { label: 'Messages',    path: '/portal/messages',  icon: <MessagesIcon />, shortLabel: 'Chat'     },
  { label: 'Settings',    path: '/portal/settings',  icon: <SettingsIcon />, shortLabel: 'Settings' },
]

// ── Main shell ────────────────────────────────────────────────────────────────

export default function ClientShell({ children, previewClientId }: Props) {
  const { email } = useRole()
  const navigate  = useNavigate()
  const isPreview = Boolean(previewClientId)

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  function handleExitPreview() {
    navigate(`/clients/${previewClientId}`)
  }

  // In preview mode, nav links carry the ?preview= param so tabs keep working
  function navPath(base: string) {
    return isPreview ? `${base}?preview=${previewClientId}` : base
  }

  // Initials from email for avatar fallback
  const initials = email ? email.substring(0, 2).toUpperCase() : 'CL'

  return (
    <div className="portal-shell">

      {/* Preview mode banner */}
      {isPreview && (
        <div className="preview-banner">
          <span className="flex items-center gap-8">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
            Preview Mode — you are viewing as this client
          </span>
          <button className="preview-banner-btn" onClick={handleExitPreview}>
            ← Exit Preview
          </button>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className={`portal-sidebar${isPreview ? ' preview-offset' : ''}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <img src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA" className="sidebar-brand-logo" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <div>
            <div className="sidebar-brand-name">YVA Staffing</div>
            <div className="sidebar-brand-sub">{isPreview ? 'Preview Mode' : 'Client Portal'}</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav portal-nav">
          <div className="sidebar-section-label">Navigation</div>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={navPath(item.path)}
              className={({ isActive }) =>
                `sidebar-nav-item${isActive ? ' active' : ''}`
              }
              aria-current={undefined}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          {isPreview ? (
            <button
              onClick={handleExitPreview}
              className="sidebar-nav-item portal-exit-preview-btn"
            >
              <span className="sidebar-nav-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 7 21 12 16 17"/>
                  <line x1="21" x2="9" y1="12" y2="12"/>
                </svg>
              </span>
              Exit Preview
            </button>
          ) : (
            <>
              <div className="portal-user-row">
                <div className="portal-user-avatar">{initials}</div>
                <div className="portal-user-info">
                  <div className="portal-user-email">{email}</div>
                  <div className="portal-user-role">Client</div>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="sidebar-nav-item portal-signout-btn"
              >
                <span className="sidebar-nav-icon">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" x2="9" y1="12" y2="12"/>
                  </svg>
                </span>
                Sign out
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main area */}
      <div className={`portal-main${isPreview ? ' preview-offset' : ''}`}>

        {/* Topbar */}
        <header className="portal-topbar">
          {/* Desktop title */}
          <div className="portal-topbar-title-desktop">
            {isPreview ? 'Portal Preview' : 'Client Portal'}
          </div>
          {/* Mobile brand */}
          <div className="portal-topbar-brand-mobile">
            <img src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA" className="portal-topbar-brand-logo" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            <span className="portal-topbar-brand-text">
              {isPreview ? 'Portal Preview' : 'YVA Portal'}
            </span>
          </div>
          <div className="flex items-center gap-10">
            {isPreview && (
              <button
                onClick={handleExitPreview}
                className="btn-ghost btn-sm portal-topbar-exit"
              >
                ← Exit Preview
              </button>
            )}
            <div className={`topbar-avatar ${isPreview ? 'topbar-avatar-preview' : 'topbar-avatar-gold'}`}>
              {isPreview ? <IconEye size={14} /> : initials}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="portal-content">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className={`portal-bottom-nav${isPreview ? ' preview-offset' : ''}`}>
        <div className="portal-bottom-nav-items">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={navPath(item.path)}
              className={({ isActive }) =>
                `portal-bottom-nav-item${isActive ? ' active' : ''}`
              }
            >
              <span className="portal-bottom-nav-icon">{item.icon}</span>
              {item.shortLabel}
            </NavLink>
          ))}
        </div>
      </nav>

    </div>
  )
}
