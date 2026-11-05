import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ic, P } from './Icon'
import { loadNotifications, markNotificationsRead, setAppBadge, type AppNotification } from '../services/notifications'
import { supabase } from '../lib/supabase'
import { LIVE_UPDATES_ON } from '../lib/liveConfig'
import { notificationTarget } from '../lib/notificationTarget'

function ago(ms: number, es: boolean): string {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return es ? 'ahora' : 'just now'
  if (m < 60) return es ? `hace ${m} min` : `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return es ? `hace ${h} h` : `${h}h ago`
  return new Date(ms).toLocaleDateString(es ? 'es-DO' : 'en-US', { month: 'short', day: 'numeric' })
}
const DOT: Record<string, string> = {
  payment_received: 'success', payslip_ready: 'success', lead_new: 'info', application_new: 'muted',
  timeoff_request: 'warning', timeoff_decision: 'info', time_adjusted: 'warning', week_ready: 'warning', payroll_due: 'warning',
}

/** The bell (redesign): 38px circle (44px on phones), red dot when unread, 380px popover with "Mark all read".
 *  New notifications are pushed by Supabase Realtime (only this person's rows; supabase/migrate-live-updates.sql
 *  adds the table to Realtime). It also refreshes when the app comes back, and every 2 minutes only while the live
 *  connection is down (or Realtime isn't switched on). Also used in My workspace (lang = es). */
export default function NotificationBell({ lang = 'en', linkBase = '', onOpenChange }: { lang?: 'en' | 'es'; linkBase?: string; onOpenChange?: (open: boolean) => void }) {
  const es = lang === 'es'
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpenState] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = items.filter(n => !n.readAt).length
  const setOpen = (v: boolean) => { setOpenState(v); onOpenChange?.(v) }

  async function refresh() { setItems(await loadNotifications()) }
  useEffect(() => {
    let alive = true, live = false, lastVis = 0
    let channel: ReturnType<typeof supabase.channel> | null = null
    void refresh()
    // Live updates paused (lib/liveConfig.ts): no Realtime connection; checks every 10 minutes and on return instead
    if (LIVE_UPDATES_ON) void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id
      if (!alive || !uid) return
      channel = supabase
        .channel(`yva-notifications-${uid}-${Math.random().toString(36).slice(2, 8)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, () => { if (alive) void refresh() })
        .subscribe(state => {
          const was = live
          live = state === 'SUBSCRIBED'
          if (live && !was && alive) void refresh()   // reconnected: catch up on anything missed
        })
    })
    const id = setInterval(() => { if (!live && document.visibilityState === 'visible') void refresh() }, LIVE_UPDATES_ON ? 120_000 : 600_000)
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - lastVis > 30_000) { lastVis = Date.now(); void refresh() } }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])
  useEffect(() => { setAppBadge(unread) }, [unread])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', key) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openItem(n: AppNotification) {
    setOpen(false)
    if (!n.readAt) {
      setItems(list => list.map(x => (x.id === n.id ? { ...x, readAt: Date.now() } : x)))
      await markNotificationsRead([n.id]).catch(() => {})
    }
    // The exact record (older notifications only named the list page — notificationTarget finds the record)
    const target = await notificationTarget(n)
    if (target) navigate(`${linkBase}${target}`)
  }
  async function readAll() {
    setItems(list => list.map(x => ({ ...x, readAt: x.readAt ?? Date.now() })))
    await markNotificationsRead().catch(() => {})
  }

  return (
    <div className="bell" ref={ref}>
      <button type="button" className="icon-btn bell__btn" aria-expanded={open}
        aria-label={es ? `Notificaciones${unread ? ` (${unread} sin leer)` : ''}` : `Notifications${unread ? ` (${unread} unread)` : ''}`}
        onClick={() => setOpen(!open)}>
        <Ic d={P.bell} size={17} />
        {unread > 0 && <span className="bell__dot" aria-hidden />}
      </button>
      {open && (
        <div className="bell__pop" role="dialog" aria-label={es ? 'Notificaciones' : 'Notifications'}>
          <div className="bell__head">
            <span className="bell__title">{es ? 'Notificaciones' : 'Notifications'}</span>
            {unread > 0 && <button type="button" className="link" onClick={() => void readAll()}>{es ? 'Marcar todo como leído' : 'Mark all read'}</button>}
          </div>
          {items.length === 0 ? (
            <div className="bell__empty">{es ? 'No tienes notificaciones.' : "You're all caught up."}</div>
          ) : (
            <div className="bell__list">
              {items.map(n => (
                <button type="button" key={n.id} className={`bell__item${n.readAt ? '' : ' bell__item--unread'}`} onClick={() => void openItem(n)}>
                  <span className={`dot dot--${DOT[n.kind] ?? 'muted'}`} aria-hidden />
                  <span className="bell__text">
                    <span className="bell__item-title">{n.title}</span>
                    <span className="bell__meta">{[n.body, ago(n.createdAt, es)].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
