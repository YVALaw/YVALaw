import { ReactNode, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { loadSnapshot, loadCandidates } from '../services/storage'
import { useRole } from '../context/RoleContext'
import { can, ROLE_LABELS } from '../lib/roles'
import { useActiveTimer, formatElapsed, elapsedSeconds } from '../hooks/useActiveTimer'

type Props = { children: ReactNode }

type SearchResult = {
  type: 'Client' | 'Employee' | 'Project' | 'Candidate' | 'Invoice'
  label: string
  sub: string
  route: string
}

function GlobalSearch() {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen]       = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) { setResults([]); setOpen(false); return }
    void (async () => {
      const snap = await loadSnapshot()
      const candidates = await loadCandidates()
      const found: SearchResult[] = []

      for (const c of snap.clients)
        if (`${c.name} ${c.email || ''} ${c.company || ''}`.toLowerCase().includes(q))
          found.push({ type: 'Client', label: c.name, sub: c.email || c.company || '', route: '/clients/' + c.id })

      for (const e of snap.employees)
        if (`${e.name} ${e.email || ''} ${e.role || ''}`.toLowerCase().includes(q))
          found.push({ type: 'Employee', label: e.name, sub: e.role || e.email || '', route: '/employees/' + e.id })

      for (const p of snap.projects)
        if (`${p.name}`.toLowerCase().includes(q))
          found.push({ type: 'Project', label: p.name, sub: p.status || '', route: '/projects/' + p.id })

      for (const cand of candidates)
        if (`${cand.name} ${cand.role || ''} ${cand.email || ''}`.toLowerCase().includes(q))
          found.push({ type: 'Candidate', label: cand.name, sub: cand.role || cand.stage, route: '/candidates/' + cand.id })

      for (const inv of snap.invoices)
        if (`${inv.number} ${inv.clientName || ''} ${inv.projectName || ''}`.toLowerCase().includes(q))
          found.push({ type: 'Invoice', label: inv.number, sub: `${inv.clientName || ''} · ${inv.status || 'draft'}`, route: '/invoice' })

      setResults(found.slice(0, 8))
      setOpen(found.length > 0)
    })()
  }, [query])

  function pick(r: SearchResult) {
    navigate(r.route)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const TYPE_COLORS: Record<string, string> = {
    Client: '#1d4ed8', Employee: '#15803d', Project: '#7e22ce', Invoice: '#a16207', Candidate: '#0f766e',
  }
  const TYPE_BG: Record<string, string> = {
    Client: 'rgba(59,130,246,.1)', Employee: 'rgba(34,197,94,.1)', Project: 'rgba(168,85,247,.1)',
    Invoice: 'rgba(250,204,21,.15)', Candidate: 'rgba(20,184,166,.1)',
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="form-input"
        style={{ width: 220, fontSize: 13, height: 34, padding: '0 12px' }}
        placeholder="Search…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setOpen(false) } }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
          background: '#ffffff', border: '1px solid #e2e8f0',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 1000, overflow: 'hidden',
        }}>
          {results.map((r, i) => (
            <div
              key={i}
              onMouseDown={() => pick(r)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid #f0f2f7' : 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f4f6fa')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em',
                color: TYPE_COLORS[r.type] || '#666',
                background: TYPE_BG[r.type] || '#f4f6fa',
                padding: '2px 7px', borderRadius: 999, minWidth: 60, textAlign: 'center',
              }}>{r.type}</span>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2330', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                {r.sub && <div style={{ fontSize: 11, color: '#7c8db5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Nav sections (Flowlu-style grouped sidebar) ──
const navSections = [
  {
    label: null,
    items: [
      {
        to: '/', label: 'Dashboard', end: true,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
      },
    ],
  },
  {
    label: 'CRM',
    items: [
      {
        to: '/clients', label: 'Clients', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
      },
      {
        to: '/estimates', label: 'Estimates', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        to: '/invoice', label: 'Invoices', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
      },
      {
        to: '/expenses', label: 'Expenses', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        to: '/projects', label: 'Projects', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
      },
      {
        to: '/time', label: 'Time Tracking', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      },
      {
        to: '/calendar', label: 'Calendar', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
      },
    ],
  },
  {
    label: 'HR',
    items: [
      {
        to: '/employees', label: 'Team', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>,
      },
      {
        to: '/candidates', label: 'Candidates', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>,
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        to: '/settings', label: 'Settings', end: false,
        icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
      },
    ],
  },
]

function PageTitle({ pathname }: { pathname: string }) {
  const profileMatch = pathname.match(/^\/(employees|clients|projects|candidates)\/[^/]+/)
  if (profileMatch) {
    const section = profileMatch[1]
    const label = section === 'employees' ? 'Team' : section.charAt(0).toUpperCase() + section.slice(1)
    return <span>{label} — Profile</span>
  }
  for (const section of navSections) {
    for (const item of section.items) {
      const match = item.end ? pathname === item.to : pathname.startsWith(item.to) && item.to !== '/'
      if (match || (item.to === '/' && pathname === '/')) return <span>{item.label}</span>
    }
  }
  return <span>YVA LawOS</span>
}

export default function Shell({ children }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const { role, email } = useRole()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { timer, elapsed, stop } = useActiveTimer()
  const linkedEmployeeId = sessionStorage.getItem('linkedEmployeeId')

  const prevPath = useRef(location.pathname)
  if (prevPath.current !== location.pathname) {
    prevPath.current = location.pathname
    if (sidebarOpen) setSidebarOpen(false)
  }

  // Routes that are not yet built show a "coming soon" placeholder
  const builtRoutes = ['/', '/invoice', '/clients', '/employees', '/candidates', '/projects', '/expenses', '/settings', '/estimates', '/time', '/calendar']

  function isVisible(to: string) {
    if (to === '/invoice')    return can.viewInvoices(role)
    if (to === '/clients')    return can.viewClients(role)
    if (to === '/employees')  return can.viewEmployees(role)
    if (to === '/candidates') return can.viewAllCandidates(role) || can.viewHiredOnly(role)
    if (to === '/expenses')   return can.viewExpenses(role)
    return true
  }

  return (
    <div className="shell">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">Y</div>
          <div>
            <div className="sidebar-brand-name">YVA LawOS</div>
            <div className="sidebar-brand-sub">Law Operations</div>
          </div>
        </div>

        {/* Grouped nav */}
        <nav className="sidebar-nav">
          {navSections.map((section, si) => (
            <div key={si}>
              {section.label && (
                <div className="sidebar-section-label">{section.label}</div>
              )}
              {section.items.filter(item => isVisible(item.to)).map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  {!builtRoutes.includes(item.to) && (
                    <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(250,204,21,.2)', color: '#facc15', padding: '1px 6px', borderRadius: 999, marginLeft: 'auto' }}>
                      SOON
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* My Profile link (only when linked to an employee) */}
        {linkedEmployeeId && (
          <NavLink
            to={`/employees/${linkedEmployeeId}`}
            className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
            style={{ marginTop: 4 }}
            onClick={() => setSidebarOpen(false)}
          >
            <span className="sidebar-nav-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
            </span>
            <span>My Profile</span>
            <span style={{ fontSize: 9, fontWeight: 700, background: 'rgba(250,204,21,.2)', color: '#facc15', padding: '1px 6px', borderRadius: 999, marginLeft: 'auto' }}>ME</span>
          </NavLink>
        )}

        {/* Footer */}
        <div className="sidebar-footer">
          {email && (
            <div className="sidebar-footer-label" style={{ marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email}
            </div>
          )}
          <div className="sidebar-footer-label" style={{ color: '#facc15', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {ROLE_LABELS[role]}
          </div>
        </div>
      </aside>

      {/* Topbar */}
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="hamburger btn-icon btn-ghost" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6"  x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="topbar-title">
            <PageTitle pathname={location.pathname} />
          </div>
        </div>
        <div className="topbar-actions">
          {/* Running timer pill */}
          {timer && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(250,204,21,.12)', border: '1px solid rgba(250,204,21,.3)',
              borderRadius: 20, padding: '4px 12px 4px 10px', cursor: 'default',
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#facc15', boxShadow: '0 0 0 3px rgba(250,204,21,.25)', animation: 'pulse 1.4s infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                {formatElapsed(elapsed)}
              </span>
              {timer.projectName && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {timer.projectName}</span>
              )}
              <button
                onClick={() => {
                  const finished = stop()
                  if (finished) {
                    const hours = Math.round((elapsedSeconds(finished.startedAt) / 3600) * 100) / 100
                    if (hours > 0) navigate('/time')
                  }
                }}
                style={{
                  marginLeft: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                  background: '#ef4444', color: '#fff', border: 'none',
                  borderRadius: 999, cursor: 'pointer',
                }}
              >
                Stop
              </button>
            </div>
          )}
          <GlobalSearch />
          <div className="topbar-badge">Live</div>
        </div>
      </header>

      <main className="main-content">
        {children}
      </main>
    </div>
  )
}
