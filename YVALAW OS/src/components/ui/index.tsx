// Redesign (2026-11) UI kit. Every screen builds from these + the classes in src/styles/ds.css.
// Keep components presentational: data loading stays in pages/services.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Ic, P } from '../Icon'
import { initials } from '../../utils/format'

/* ── Hooks ─────────────────────────────────────────────────────────── */

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  const [match, setMatch] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}
/** Phone layout: below 760px (bottom dock, sheets, cards instead of tables) */
export const useIsMobile = () => useMediaQuery('(max-width: 759px)')

/** Esc closes; the page behind doesn't scroll while an overlay is open */
export function useOverlay(open: boolean, onClose: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current() } }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ── Page structure ────────────────────────────────────────────────── */

/** On phones the shell header already shows the page name, so the H1 is hidden there unless keepTitleOnPhone
 *  (use it when the title is a record name, e.g. a client profile). */
export function PageHeader({ title, sub, actions, className, keepTitleOnPhone }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; className?: string; keepTitleOnPhone?: boolean }) {
  return (
    <div className={cx('page-head', keepTitleOnPhone && 'page-head--keep', className)}>
      <div className="page-head__text">
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Card({ title, meta, actions, children, className, pad, onClick }: {
  title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; pad?: boolean; onClick?: () => void
}) {
  return (
    <section className={cx('card', pad && 'card--pad', onClick && 'card--hover', className)} onClick={onClick}>
      {(title || meta || actions) && (
        <div className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          <div className="row">{meta && <span className="card__meta">{meta}</span>}{actions}</div>
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="card card-empty"><div>{children}</div>{action && <div style={{ marginTop: 12 }}>{action}</div>}</div>
}

export type Kpi = { label: string; value: ReactNode; note?: ReactNode; tone?: 'danger' | 'warning' | 'success' | 'muted'; onClick?: () => void }
export function KpiStrip({ items, compact }: { items: Kpi[]; compact?: boolean }) {
  return (
    <div className={cx('kpi-strip', compact && 'kpi-strip--compact')}>
      {items.map((k, i) => {
        const inner = <>
          <span className="kpi-cell__label">{k.label}</span>
          <span className="kpi-cell__value">{k.value}</span>
          {k.note !== undefined && k.note !== null && k.note !== '' && <span className={cx('kpi-cell__note', k.tone && k.tone !== 'muted' && `t-${k.tone}`)}>{k.note}</span>}
        </>
        return k.onClick
          ? <button key={i} type="button" className="kpi-cell" onClick={k.onClick}>{inner}</button>
          : <div key={i} className="kpi-cell">{inner}</div>
      })}
    </div>
  )
}

/* ── Controls ──────────────────────────────────────────────────────── */

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx('seg__opt', o.value === value && 'seg__opt--on')} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { value: T; label: ReactNode; count?: number | null; badge?: number | null; hidden?: boolean }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.filter(t => !t.hidden).map(t => (
        <button key={t.value} type="button" role="tab" aria-selected={t.value === value} className={cx('tab', t.value === value && 'tab--on')} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count != null && <span className="tab__count">{t.count}</span>}
          {t.badge ? <span className="tab__badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Chips<T extends string>({ value, options, onChange, small }: { value: T; options: { value: T; label: ReactNode; count?: number | null }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className="chips">
      {options.map(o => (
        <button key={o.value} type="button" className={cx('chip', small && 'chip--sm', o.value === value && 'chip--on')} onClick={() => onChange(o.value)} aria-pressed={o.value === value}>
          {o.label}{o.count != null && <span className="chip__count">{o.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, error, children, full, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; full?: boolean; htmlFor?: string }) {
  return (
    <label className={cx('field', full && 'field--full')} htmlFor={htmlFor}>
      {label && <span className="field__label">{label}</span>}
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Search…', label, width }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; width?: number | string }) {
  return (
    <div className="search-input" style={width ? { width } : undefined}>
      <Ic d={P.search} size={15} />
      <input className="input" type="search" aria-label={label ?? placeholder} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

export function Checkbox({ checked, onChange, label, disabled, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return (
    <label className="check" aria-label={ariaLabel}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="check__box">{checked && <Ic d={P.check} size={12} stroke={3} />}</span>
      {label}
    </label>
  )
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span className="switch__track" />
    </label>
  )
}

export function Stepper({ label, onPrev, onNext, prevDisabled, nextDisabled, prevLabel = 'Previous', nextLabel = 'Next' }: { label: ReactNode; onPrev: () => void; onNext: () => void; prevDisabled?: boolean; nextDisabled?: boolean; prevLabel?: string; nextLabel?: string }) {
  return (
    <div className="stepper">
      <button type="button" className="stepper__btn" onClick={onPrev} disabled={prevDisabled} aria-label={prevLabel}><Ic d={P.chevL} /></button>
      <span className="stepper__label">{label}</span>
      <button type="button" className="stepper__btn" onClick={onNext} disabled={nextDisabled} aria-label={nextLabel}><Ic d={P.chevR} /></button>
    </div>
  )
}

/* ── Status ────────────────────────────────────────────────────────── */

export type Tone = 'neutral' | 'sent' | 'viewed' | 'partial' | 'danger' | 'success' | 'warning' | 'info' | 'teal' | 'gold' | 'navy'
const TONE_BY_STATUS: Record<string, Tone> = {
  draft: 'neutral', neutral: 'neutral', cancelled: 'neutral', closed: 'neutral', completed: 'neutral', expired: 'neutral', archived: 'neutral', inactive: 'neutral', planning: 'neutral',
  sent: 'sent', viewed: 'viewed', partial: 'partial',
  overdue: 'danger', rejected: 'danger', churned: 'danger', declined: 'danger', lost: 'danger', failed: 'danger', terminated: 'danger',
  paid: 'success', active: 'success', approved: 'success', fulfilled: 'success', accepted: 'success', won: 'success', hired: 'success', applied_ok: 'success',
  pending: 'warning', paused: 'warning', waiting: 'warning', 'on hold': 'warning', on_hold: 'warning', check: 'warning', screening: 'warning',
  prospect: 'info', 'in review': 'info', in_review: 'info', reviewing: 'info', interview: 'info', meeting: 'info', proposal: 'info', contacted: 'info', new: 'info', applied: 'info', offer: 'teal',
}
export const toneFor = (status?: string | null): Tone => TONE_BY_STATUS[String(status || '').toLowerCase()] ?? 'neutral'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function Pill({ tone, status, children, className }: { tone?: Tone; status?: string | null; children?: ReactNode; className?: string }) {
  const t = tone ?? toneFor(status)
  return <span className={cx('pill', `pill--${t}`, className)}>{children ?? (status ? cap(String(status).replace(/_/g, ' ')) : '')}</span>
}

export function Dot({ tone = 'muted', live }: { tone?: 'danger' | 'warning' | 'success' | 'info' | 'muted'; live?: boolean }) {
  return <span className={cx('dot', live ? 'dot--live' : `dot--${tone}`)} aria-hidden />
}

/** Activity % with the same thresholds everywhere: ≥60 green, 30–59 amber, <30 red */
export function Activity({ pct }: { pct: number | null | undefined }) {
  if (pct == null || !Number.isFinite(pct)) return <span className="soft">—</span>
  const p = Math.round(pct)
  return <span className={cx('num', p >= 60 ? 'act-high' : p >= 30 ? 'act-mid' : 'act-low')}>{p}%</span>
}

export function Banner({ tone = 'success', children, onClose, action }: { tone?: 'success' | 'info' | 'warning' | 'danger' | 'gold'; children: ReactNode; onClose?: () => void; action?: ReactNode }) {
  return (
    <div className={cx('banner', `banner--${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className="banner__body">{children}</div>
      {action}
      {onClose && <button type="button" className="banner__close" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  )
}

export function Avatar({ name, src, size, soft }: { name?: string | null; src?: string | null; size?: 'sm' | 'lg' | 'xl'; soft?: boolean }) {
  return <span className={cx('avatar-i', size && `avatar-i--${size}`, soft && 'avatar-i--soft')} title={name ?? undefined}>{src ? <img src={src} alt="" /> : initials(name)}</span>
}
export function AvatarStack({ names, max = 4, size = 'sm' }: { names: string[]; max?: number; size?: 'sm' | 'lg' }) {
  const shown = names.slice(0, max)
  const extra = names.length - shown.length
  return (
    <span className="avatar-stack" aria-label={names.join(', ')}>
      {shown.map((n, i) => <Avatar key={i} name={n} size={size} />)}
      {extra > 0 && <span className={cx('avatar-i', `avatar-i--${size}`, 'avatar-i--soft')}>+{extra}</span>}
    </span>
  )
}

export function Skel({ w = '100%', h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ display: 'block', width: w, height: h, borderRadius: r }} aria-hidden />
}

/** Shown for the moment a screen's code is still downloading (React.lazy) */
export function PageLoading() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <Skel w={220} h={26} r={6} />
      <span className="page-loading__gap" />
      <Skel h={84} r={12} />
      <span className="page-loading__gap" />
      <Skel h={260} r={12} />
    </div>
  )
}

/* ── Overlays (rendered in a portal so page layout never clips them) ── */

function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

export function Drawer({ open, onClose, title, sub, footer, children, size, headExtra }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; footer?: ReactNode; children: ReactNode; size?: 'wide' | 'narrow'; headExtra?: ReactNode
}) {
  useOverlay(open, onClose)
  if (!open) return null
  return (
    <Portal>
      <div className="scrim" onClick={onClose} />
      <aside className={cx('drawer', size && `drawer--${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="drawer__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="drawer__title">{title}</h2>
            {sub && <div className="drawer__sub">{sub}</div>}
            {headExtra}
          </div>
          <button type="button" className="x-close" onClick={onClose} aria-label="Close"><Ic d={P.x} /></button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__foot">{footer}</div>}
      </aside>
    </Portal>
  )
}

export function Modal({ open, onClose, title, sub, footer, children, size }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; footer?: ReactNode; children?: ReactNode; size?: 'wide' | 'xl'
}) {
  useOverlay(open, onClose)
  if (!open) return null
  return (
    <Portal>
      <div className="scrim" onClick={onClose} />
      <div className={cx('modal-x', size && `modal-x--${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-x__head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="modal-x__title">{title}</h2>
            {sub && <div className="modal-x__sub">{sub}</div>}
          </div>
          <button type="button" className="x-close" onClick={onClose} aria-label="Close"><Ic d={P.x} /></button>
        </div>
        {children && <div className="modal-x__body">{children}</div>}
        {footer && <div className="modal-x__foot">{footer}</div>}
      </div>
    </Portal>
  )
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useOverlay(open, onClose)
  if (!open) return null
  return (
    <Portal>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <span className="sheet__grab" />
        {title && <div className="section-label" style={{ padding: '0 4px 6px' }}>{title}</div>}
        {children}
      </div>
    </Portal>
  )
}

export type MenuItem = { label: ReactNode; onClick: () => void; icon?: string; danger?: boolean; hidden?: boolean; disabled?: boolean } | 'sep'
/** ⋯ or "Label ▾" dropdown; destructive items go here, never next to the primary button */
/** ⋯ menu. The list is drawn over the page (portal, fixed position) so a table or card with overflow hidden can't cut it
 *  off; it opens below the button, or above it when there isn't room, and closes on scroll / resize / Esc / click outside. */
export function Menu({ items, label = 'More actions', trigger, align = 'right', buttonClass = 'btn btn--icon' }: { items: MenuItem[]; label?: string; trigger?: ReactNode; align?: 'left' | 'right'; buttonClass?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' })
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false) }
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const away = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', away, true)
    window.addEventListener('resize', away)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', key); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away) }
  }, [open])
  useLayoutEffect(() => {
    if (!open || !ref.current || !listRef.current) return
    const b = ref.current.getBoundingClientRect()
    const h = listRef.current.offsetHeight, w = listRef.current.offsetWidth
    const gap = 6, vw = window.innerWidth, vh = window.innerHeight
    const below = vh - b.bottom - gap >= h || b.top - gap < h
    const top = below ? Math.min(b.bottom + gap, vh - h - 8) : b.top - gap - h
    const left = align === 'right' ? Math.max(8, Math.min(b.right - w, vw - w - 8)) : Math.max(8, Math.min(b.left, vw - w - 8))
    setPos({ position: 'fixed', top: Math.max(8, top), left })
  }, [open, align])
  const visible = items.filter(i => i === 'sep' || !i.hidden)
  if (!visible.some(i => i !== 'sep')) return null
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-label={trigger ? undefined : label}
        onClick={e => { e.stopPropagation(); setPos({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' }); setOpen(o => !o) }}>
        {trigger ?? <Ic d={P.more} size={18} stroke={2.6} />}
      </button>
      {open && createPortal(
        <div className="menu menu--floating" role="menu" ref={listRef} style={pos} onMouseDown={e => e.stopPropagation()}>
          {visible.map((it, i) => it === 'sep'
            ? <div key={i} className="menu__sep" />
            : <button key={i} type="button" role="menuitem" disabled={it.disabled} className={cx('menu__item', it.danger && 'menu__item--danger')} onClick={e => { e.stopPropagation(); setOpen(false); it.onClick() }}>
                {it.icon && <Ic d={it.icon} />}{it.label}
              </button>)}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** Enter-to-submit helper for single-line inputs */
export const onEnter = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); fn() } }

/** Table on desktop, stacked cards on phones: pass both renderers */
export function Responsive({ table, cards }: { table: ReactNode; cards: ReactNode }) {
  const mobile = useIsMobile()
  return <>{mobile ? cards : table}</>
}
