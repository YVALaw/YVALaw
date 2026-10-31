import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBell } from './Icon'
import { loadNotifications, markNotificationsRead, setAppBadge, type AppNotification } from '../services/notifications'

function ago(ms: number, es: boolean): string {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return es ? 'ahora' : 'just now'
  if (m < 60) return es ? `hace ${m} min` : `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return es ? `hace ${h} h` : `${h} h ago`
  return new Date(ms).toLocaleDateString(es ? 'es-DO' : 'en-US', { month: 'short', day: 'numeric' })
}

/** The bell: unread count, recent notifications, tap to open. Refreshes every minute and when the app comes back. */
export default function NotificationBell({ lang = 'en', linkBase = '' }: { lang?: 'en' | 'es'; linkBase?: string }) {
  const es = lang === 'es'
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = items.filter(n => !n.readAt).length

  async function refresh() { setItems(await loadNotifications()) }
  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  useEffect(() => { setAppBadge(unread) }, [unread])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  async function openItem(n: AppNotification) {
    setOpen(false)
    if (!n.readAt) {
      setItems(list => list.map(x => (x.id === n.id ? { ...x, readAt: Date.now() } : x)))
      await markNotificationsRead([n.id]).catch(() => {})
    }
    if (n.link) navigate(`${linkBase}${n.link}`)
  }
  async function readAll() {
    setItems(list => list.map(x => ({ ...x, readAt: x.readAt ?? Date.now() })))
    await markNotificationsRead().catch(() => {})
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="notif-bell" aria-label={es ? `Notificaciones${unread ? ` (${unread} sin leer)` : ''}` : `Notifications${unread ? ` (${unread} unread)` : ''}`}
        onClick={() => setOpen(o => !o)}>
        <IconBell size={18} />
        {unread > 0 && <span className="notif-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog">
          <div className="notif-panel-head">
            <strong>{es ? 'Notificaciones' : 'Notifications'}</strong>
            {unread > 0 && <button className="notif-link" onClick={() => void readAll()}>{es ? 'Marcar todo como leído' : 'Mark all read'}</button>}
          </div>
          {items.length === 0 ? (
            <div className="notif-empty">{es ? 'No tienes notificaciones.' : "You're all caught up."}</div>
          ) : (
            <div className="notif-list">
              {items.map(n => (
                <button key={n.id} className={`notif-item${n.readAt ? '' : ' notif-unread'}`} onClick={() => void openItem(n)}>
                  <span className="notif-dot" aria-hidden />
                  <span className="notif-text">
                    <span className="notif-title">{n.title}</span>
                    {n.body && <span className="notif-body">{n.body}</span>}
                    <span className="notif-time">{ago(n.createdAt, es)}</span>
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
