// Staff OS shell (redesign 2026-11, designs/YVA OS.dc.html): header with breadcrumb, bell and account
// menu; floating navy dock with five hubs, "Jump to…" search and the gold + Create button; hub pop-ups
// (desktop) / bottom sheets (phone); sibling chips above every hub page. Visibility rules: lib/nav.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { loadSnapshot, loadCandidates } from '../services/storage'
import { loadLeads } from '../services/crm'
import { usePermission, useRole } from '../context/RoleContext'
import { ROLE_LABELS, can, type UserRole } from '../lib/roles'
import { visibleHubs, visibleCreateItems, locate, canSeePage, SETTINGS_PAGE, type Hub, type HubKey } from '../lib/nav'
import { loadHubStatus, type HubStatus } from '../services/hubStatus'
import { signOutAndForgetDevice } from '../services/notifications'
import { canPromptInstall, isIos, isStandalone, promptInstall } from '../lib/install'
import NotificationBell from './NotificationBell'
import { Ic, P } from './Icon'
import { Modal, SearchInput, useIsMobile } from './ui'
import { initials } from '../utils/format'

type Overlay = null | { kind: 'hub'; hub: HubKey; left: number } | { kind: 'search' } | { kind: 'create' } | { kind: 'account' }
type Result = { type: 'Page' | 'Client' | 'Employee' | 'Project' | 'Invoice' | 'Candidate' | 'Lead'; label: string; sub: string; to: string }

const TYPE_CLASS: Record<Result['type'], string> = { Page: 'page', Client: 'client', Employee: 'employee', Project: 'project', Invoice: 'invoice', Candidate: 'candidate', Lead: 'lead' }

export default function Shell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const { role, email } = useRole()
  const allowed = usePermission()
  const hubs = useMemo(() => visibleHubs(role, allowed), [role, allowed])
  const createItems = useMemo(() => visibleCreateItems(role, allowed), [role, allowed])
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [status, setStatus] = useState<HubStatus>({})
  const [previewOpen, setPreviewOpen] = useState(false)
  const [installOpen, setInstallOpen] = useState(false)
  const linkedEmployeeId = sessionStorage.getItem('linkedEmployeeId')
  const { hub: curHub, page: curPage, isProfile } = locate(location.pathname)
  const isHome = location.pathname === '/'

  // Navigating closes every overlay and scrolls to the top
  useEffect(() => { setOverlay(null); window.scrollTo(0, 0) }, [location.pathname])
  // Live status lines for the hub pop-ups (refreshed on navigation; cached a minute)
  const pageKeys = useMemo(() => hubs.flatMap(h => h.pages.map(p => p.key)), [hubs])
  useEffect(() => { void loadHubStatus(pageKeys).then(setStatus) }, [pageKeys, location.pathname])

  // "/" opens search when not typing; Esc closes overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement | null)?.tagName
      const typing = t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (e.target as HTMLElement | null)?.isContentEditable
      if (e.key === 'Escape') setOverlay(null)
      else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setOverlay({ kind: 'search' }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hubWarn = (h: Hub) => h.pages.some(p => status[p.key]?.warn)
  function openHub(key: HubKey, el: HTMLElement) {
    if (overlay?.kind === 'hub' && overlay.hub === key) return setOverlay(null)
    const r = el.getBoundingClientRect()
    setOverlay({ kind: 'hub', hub: key, left: Math.max(12, Math.min(window.innerWidth - 332, r.left + r.width / 2 - 160)) })
  }
  const go = (to: string) => { setOverlay(null); navigate(to) }
  const openHubData = overlay?.kind === 'hub' ? hubs.find(h => h.key === overlay.hub) ?? null : null

  const displayName = email ? email.split('@')[0].replace(/[._-]+/g, ' ') : 'You'
  const myInitials = initials(displayName)
  const pageTitle = isHome ? 'Home' : curPage?.label ?? 'YVA OS'
  const crumbs = isHome ? ['Home'] : curPage ? [curHub?.label ?? 'Account', curPage.label, ...(isProfile ? ['Profile'] : [])] : []
  const siblings = curHub ? hubs.find(h => h.key === curHub.key)?.pages ?? [] : []

  const accountItems = [
    linkedEmployeeId && { label: 'My profile', icon: P.user, onClick: () => go(`/employees/${linkedEmployeeId}`) },
    { label: 'Settings', icon: P.gear, onClick: () => go(SETTINGS_PAGE.to) },
    (role === 'ceo' || role === 'admin' || role === 'accounting') && { label: 'Preview client portal', icon: P.eye, onClick: () => { setOverlay(null); setPreviewOpen(true) } },
    linkedEmployeeId && { label: 'Open employee workspace', icon: P.user, onClick: () => go('/me') },
    !isStandalone() && { label: 'Install YVA OS app', icon: P.phone, onClick: () => { setOverlay(null); if (canPromptInstall()) void promptInstall(); else setInstallOpen(true) } },
  ].filter(Boolean) as { label: string; icon: string; onClick: () => void }[]

  const homeOn = isHome && overlay?.kind !== 'hub'
  const hubOn = (h: Hub) => (overlay?.kind === 'hub' ? overlay.hub === h.key : curHub?.key === h.key)

  return (
    <div className="os-app">
      <a href="#main-content" className="skip-link">Skip to content</a>

      <header className="os-head">
        {mobile ? (
          <span className="os-head__title">{pageTitle}</span>
        ) : (
          <>
            <img className="os-head__logo" src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA OS home" onClick={() => go('/')} />
            <nav className="os-crumbs" aria-label="Breadcrumb">
              <button type="button" className="os-crumbs__root" onClick={() => go('/')}>YVA OS</button>
              {crumbs.map((c, i) => (
                <span key={i} className="os-crumbs__part">
                  <span className="os-crumbs__sep">/</span>
                  {i === 1 && isProfile && curPage ? <button type="button" className="os-crumbs__link" onClick={() => go(curPage.to)}>{c}</button>
                    : <span className={i === crumbs.length - 1 ? 'os-crumbs__cur' : undefined}>{c}</span>}
                </span>
              ))}
            </nav>
            <span className="spacer" />
          </>
        )}
        <NotificationBell />
        <div className="acct">
          <button type="button" className="acct__btn" aria-label="Account" aria-expanded={overlay?.kind === 'account'} onClick={() => setOverlay(overlay?.kind === 'account' ? null : { kind: 'account' })}>{myInitials}</button>
          {overlay?.kind === 'account' && (
            <div className="acct__pop" role="menu">
              <div className="acct__who">
                <span className="acct__name">{displayName}</span>
                {email && <span className="acct__email">{email}</span>}
                <span className="acct__role">{(ROLE_LABELS[role as UserRole] ?? role).toUpperCase()}</span>
              </div>
              {accountItems.map(m => (
                <button type="button" key={m.label} role="menuitem" className="menu__item" onClick={m.onClick}><Ic d={m.icon} />{m.label}</button>
              ))}
              <button type="button" role="menuitem" className="menu__item menu__item--danger" onClick={() => void signOutAndForgetDevice()}><Ic d={P.out} />Sign out</button>
            </div>
          )}
        </div>
      </header>

      <main className="os-main" id="main-content">
        {siblings.length > 1 && (
          <div className="chips os-siblings">
            {siblings.map(p => (
              <button type="button" key={p.key} className={`chip${curPage?.key === p.key ? ' chip--on' : ''}`} onClick={() => go(p.to)} aria-current={curPage?.key === p.key ? 'page' : undefined}>{p.label}</button>
            ))}
          </div>
        )}
        {children}
      </main>

      {overlay && <div className={`scrim os-scrim${overlay.kind === 'search' || (mobile && overlay.kind === 'hub') ? '' : ' scrim--clear'}`} onClick={() => setOverlay(null)} />}

      {openHubData && !mobile && overlay?.kind === 'hub' && (
        <div className="popover hub-pop" style={{ left: overlay.left }} role="menu" aria-label={openHubData.label}>
          <span className="hub-pop__label">{openHubData.label}</span>
          {openHubData.pages.map(p => (
            <button type="button" key={p.key} role="menuitem" className={`hub-pop__row${curPage?.key === p.key ? ' hub-pop__row--on' : ''}`} onClick={() => go(p.to)}>
              <span className="hub-pop__tile"><Ic d={p.icon} /></span>
              <span className="hub-pop__text">
                <span className="hub-pop__title">{p.label}</span>
                <span className={`hub-pop__stat${status[p.key]?.warn ? ' t-warning' : ''}`}>{status[p.key]?.stat ?? p.desc}</span>
              </span>
              {status[p.key]?.badge ? <span className="badge-count">{status[p.key]!.badge}</span> : null}
            </button>
          ))}
        </div>
      )}
      {openHubData && mobile && (
        <div className="sheet hub-sheet" role="menu" aria-label={openHubData.label}>
          <span className="sheet__grab" />
          <span className="hub-sheet__label">{openHubData.label}</span>
          {openHubData.pages.map(p => (
            <button type="button" key={p.key} role="menuitem" className="hub-sheet__row" onClick={() => go(p.to)}>
              <span className="hub-pop__tile hub-pop__tile--lg"><Ic d={p.icon} size={18} /></span>
              <span className="hub-pop__text">
                <span className="hub-sheet__title">{p.label}</span>
                <span className={`hub-sheet__stat${status[p.key]?.warn ? ' t-warning' : ''}`}>{status[p.key]?.stat ?? p.desc}</span>
              </span>
              {status[p.key]?.badge ? <span className="badge-count">{status[p.key]!.badge}</span> : null}
            </button>
          ))}
        </div>
      )}

      {overlay?.kind === 'create' && (
        <div className="popover create-pop" role="menu" aria-label="Create">
          <span className="create-pop__label">Create</span>
          {createItems.map(c => (
            <button type="button" key={c.key} role="menuitem" className="create-pop__item" onClick={() => go(c.to)}>
              <span className="create-pop__icon"><Ic d={c.icon} size={14} stroke={2} /></span>{c.label}
            </button>
          ))}
        </div>
      )}

      {overlay?.kind === 'search' && <SearchPalette role={role} allowed={allowed} hubs={hubs} onGo={go} onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'search' && mobile && createItems.length > 0 && (
        <button type="button" className="create-fab" onClick={() => setOverlay({ kind: 'create' })}>+ Create new</button>
      )}

      {mobile ? (
        <nav className="dock dock--phone" aria-label="Main">
          <button type="button" className={`dock__m${homeOn ? ' dock__m--on' : ''}`} onClick={() => go('/')}><Ic d={P.home} size={20} /><span>Home</span></button>
          {hubs.slice(0, 2).map(h => (
            <button type="button" key={h.key} className={`dock__m${hubOn(h) ? ' dock__m--on' : ''}`} onClick={e => openHub(h.key, e.currentTarget)}>
              <Ic d={h.icon} size={20} /><span>{h.short}</span>{hubWarn(h) && <i className="dock__dot" />}
            </button>
          ))}
          <button type="button" className="dock__search-m" aria-label="Search" onClick={() => setOverlay({ kind: 'search' })}><Ic d={P.search} size={21} stroke={2.2} /></button>
          {hubs.slice(2).map(h => (
            <button type="button" key={h.key} className={`dock__m${hubOn(h) ? ' dock__m--on' : ''}`} onClick={e => openHub(h.key, e.currentTarget)}>
              <Ic d={h.icon} size={20} /><span>{h.short}</span>{hubWarn(h) && <i className="dock__dot" />}
            </button>
          ))}
          {Array.from({ length: Math.max(0, 2 - hubs.slice(2).length) }).map((_, i) => <span key={`pad${i}`} />)}
        </nav>
      ) : (
        <nav className="dock" aria-label="Main">
          <button type="button" className={`dock__item${homeOn ? ' dock__item--on' : ''}`} onClick={() => go('/')} aria-label="Home"><Ic d={P.home} /><span className="dock__label">Home</span></button>
          {hubs.map(h => (
            <button type="button" key={h.key} className={`dock__item${hubOn(h) ? ' dock__item--on' : ''}`} onClick={e => openHub(h.key, e.currentTarget)} aria-label={h.label} aria-expanded={overlay?.kind === 'hub' && overlay.hub === h.key}>
              <Ic d={h.icon} /><span className="dock__label">{h.label}</span>{hubWarn(h) && <i className="dock__dot" />}
            </button>
          ))}
          <span className="dock__sep" />
          <button type="button" className="dock__search" onClick={() => setOverlay({ kind: 'search' })}><Ic d={P.search} size={15} stroke={2} /><span className="dock__search-text">Jump to…</span><span className="mono">/</span></button>
          {createItems.length > 0 && <button type="button" className="dock__create" aria-label="Create" aria-expanded={overlay?.kind === 'create'} onClick={() => setOverlay(overlay?.kind === 'create' ? null : { kind: 'create' })}><Ic d={P.plus} size={18} stroke={2.4} /></button>}
        </nav>
      )}

      <PreviewPortalPicker open={previewOpen} onClose={() => setPreviewOpen(false)} />
      <Modal open={installOpen} onClose={() => setInstallOpen(false)} title="Install YVA OS" sub="Open it from your home screen like an app, with notifications."
        footer={<button type="button" className="btn btn--primary" onClick={() => setInstallOpen(false)}>Got it</button>}>
        {isIos()
          ? <p>On iPhone: open this page in <strong>Safari</strong>, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Open YVA OS from the new icon (needs iOS 16.4+ for notifications).</p>
          : <p>Use your browser menu (<strong>⋮</strong>) → <strong>Install app</strong> or <strong>Add to Home screen</strong>. If you don't see it, the app may already be installed.</p>}
      </Modal>
    </div>
  )
}

/* ── Search / jump palette ──────────────────────────────────────────── */

function SearchPalette({ role, allowed, hubs, onGo, onClose }: { role: ReturnType<typeof useRole>['role']; allowed: ReturnType<typeof usePermission>; hubs: Hub[]; onGo: (to: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [records, setRecords] = useState<Result[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { setTimeout(() => input.current?.focus(), 20) }, [])
  useEffect(() => {
    let alive = true
    void (async () => {
      const out: Result[] = []
      const snap = await loadSnapshot().catch(() => null)
      if (snap) {
        if (can.viewClients(role)) for (const c of snap.clients) out.push({ type: 'Client', label: c.name, sub: c.email || c.company || '', to: `/clients/${c.id}` })
        if (can.viewEmployees(role)) for (const e of snap.employees) out.push({ type: 'Employee', label: e.name, sub: [e.role, e.email].filter(Boolean).join(' · '), to: `/employees/${e.id}` })
        for (const p of snap.projects) out.push({ type: 'Project', label: p.name, sub: p.status || '', to: `/projects/${p.id}` })
        if (can.viewInvoices(role)) for (const i of snap.invoices) out.push({ type: 'Invoice', label: i.number, sub: `${i.clientName || ''} · ${i.status || 'draft'}`, to: `/invoice?open=${encodeURIComponent(i.id)}` })
      }
      if (can.viewAllCandidates(role) || can.viewHiredOnly(role)) for (const c of await loadCandidates().catch(() => [])) out.push({ type: 'Candidate', label: c.name, sub: [c.role, c.stage].filter(Boolean).join(' · '), to: `/candidates/${c.id}` })
      if (canSeePage('leads', role, allowed)) {
        const r = await loadLeads().catch(() => ({ rows: [] }))
        for (const l of r.rows) out.push({ type: 'Lead', label: l.name, sub: [l.company, l.stage].filter(Boolean).join(' · '), to: `/leads?open=${encodeURIComponent(l.id)}` })
      }
      if (alive) setRecords(out)
    })()
    return () => { alive = false }
  }, [role, allowed])
  const pages: Result[] = useMemo(() => [
    ...hubs.flatMap(h => h.pages.map(p => ({ type: 'Page' as const, label: p.label, sub: `${h.label} · ${p.desc}`, to: p.to }))),
    { type: 'Page', label: SETTINGS_PAGE.label, sub: `Account · ${SETTINGS_PAGE.desc}`, to: SETTINGS_PAGE.to },
  ], [hubs])
  const ql = q.trim().toLowerCase()
  const results = (ql ? [...pages, ...records].filter(r => `${r.label} ${r.sub}`.toLowerCase().includes(ql)) : pages.slice(0, 7)).slice(0, 9)
  useEffect(() => { setSel(0) }, [ql])
  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
      <div className="palette__input">
        <Ic d={P.search} size={18} stroke={2} />
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients, invoices, people, or jump to a page" aria-label="Search"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
            else if (e.key === 'Enter' && results[sel]) onGo(results[sel].to)
            else if (e.key === 'Escape') onClose()
          }} />
        <span className="kbd">ESC</span>
      </div>
      <div className="palette__list" role="listbox">
        {results.map((r, i) => (
          <button type="button" key={`${r.type}${r.to}${i}`} role="option" aria-selected={i === sel} className={`palette__row${i === sel ? ' palette__row--on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => onGo(r.to)}>
            <span className={`palette__type palette__type--${TYPE_CLASS[r.type]}`}>{r.type}</span>
            <span className="palette__text"><span className="palette__label">{r.label}</span>{r.sub && <span className="palette__sub">{r.sub}</span>}</span>
          </button>
        ))}
        {results.length === 0 && <div className="palette__empty">No matches for “{q}”.</div>}
      </div>
    </div>
  )
}

/* ── Account → Preview client portal: pick a client ─────────────────── */

function PreviewPortalPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [clients, setClients] = useState<{ id: string; name: string; sub: string }[]>([])
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open) return
    void loadSnapshot().then(s => setClients(s.clients.map(c => ({ id: c.id, name: c.name, sub: c.company || c.email || '' })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => setClients([]))
  }, [open])
  const shown = clients.filter(c => `${c.name} ${c.sub}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50)
  return (
    <Modal open={open} onClose={onClose} title="Preview client portal" sub="See the portal exactly as this client sees it.">
      <SearchInput value={q} onChange={setQ} placeholder="Find a client" />
      <div className="picker-list">
        {shown.map(c => (
          <button type="button" key={c.id} className="menu__item picker-list__row" onClick={() => { onClose(); navigate(`/portal/dashboard?preview=${encodeURIComponent(c.id)}`) }}>
            <span className="avatar-i avatar-i--sm">{initials(c.name)}</span>
            <span className="picker-list__text"><span>{c.name}</span>{c.sub && <span className="muted">{c.sub}</span>}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="muted">No clients found.</p>}
      </div>
    </Modal>
  )
}
