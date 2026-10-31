// The bell, notification choices and phone/computer push for the signed-in person.
import { supabase } from '../lib/supabase'

export type AppNotification = { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: number; readAt: number | null }
export type NotificationPref = { kind: string; email: boolean; push: boolean; emailTo: string | null }

export async function loadNotifications(limit = 30): Promise<AppNotification[]> {
  const { data, error } = await supabase.from('notifications').select('id,kind,title,body,link,created_at,read_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) { if (error.code !== '42P01') console.warn('loadNotifications', error.message); return [] }
  return (data || []).map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link,
    createdAt: Date.parse(r.created_at), readAt: r.read_at ? Date.parse(r.read_at) : null }))
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  if (ids) q = q.in('id', ids)
  const { error } = await q
  if (error) throw new Error(error.message)
}

export async function loadNotificationPrefs(): Promise<NotificationPref[]> {
  const { data, error } = await supabase.from('notification_prefs').select('kind,email,push,email_to')
  if (error) return []
  return (data || []).map(r => ({ kind: r.kind, email: r.email, push: r.push, emailTo: r.email_to }))
}

export async function saveNotificationPref(p: NotificationPref): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { error } = await supabase.from('notification_prefs').upsert({
    user_id: user.id, kind: p.kind, email: p.email, push: p.push, email_to: p.emailTo || null, updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

/** Deliver pending notifications now (and optionally create a test one for me) */
export async function sendNotificationsNow(test = false): Promise<{ emailed: number; pushed: number; emailProblem: string | null }> {
  const res = await fetch('/.netlify/functions/notifications-send-now', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeader()) }, body: JSON.stringify({ test }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not send (${res.status})`)
  return data
}

/** App icon badge (home-screen app / installed app) */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (count > 0) void nav.setAppBadge?.(count).catch(() => {})
  else void nav.clearAppBadge?.().catch(() => {})
}

// ── Phone / computer push ──────────────────────────────────────────────────

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

function keyToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4)
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}
const toB64url = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')

/** enablePush failures with a code, so a screen can show its own (e.g. Spanish) wording; `message` stays English */
export type PushSetupErrorCode = 'ios_install' | 'unsupported' | 'not_allowed' | 'not_configured' | 'signed_out' | 'other_account'
export class PushSetupError extends Error {
  constructor(public code: PushSetupErrorCode, message: string) { super(message); this.name = 'PushSetupError' }
}

/** Ask permission, subscribe this device and save it. Must be called from a tap/click. */
export async function enablePush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw isIos()
      ? new PushSetupError('ios_install', 'On iPhone: tap Share → "Add to Home Screen", open YVA OS from the new icon, then turn this on.')
      : new PushSetupError('unsupported', 'This browser does not support notifications.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushSetupError('not_allowed', 'Notifications were not allowed. You can allow them in your browser or phone settings.')
  const reg = (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL))
    ?? await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
  await navigator.serviceWorker.ready
  const cfg = await fetch('/.netlify/functions/push-config').then(r => r.json()).catch(() => ({}))
  if (!cfg.publicKey) throw new PushSetupError('not_configured', cfg.error || 'Phone notifications are not set up on the server yet.')
  let sub = await reg.pushManager.getSubscription()
  if (sub && toB64url(sub.options.applicationServerKey) !== cfg.publicKey) { await sub.unsubscribe(); sub = null }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(cfg.publicKey) as BufferSource })
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new PushSetupError('signed_out', 'Not signed in')
  // A device used by someone else before keeps its old row (other person's): replace only our own
  await supabase.from('push_subscriptions').delete().eq('endpoint', json.endpoint)
  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_agent: navigator.userAgent.slice(0, 300),
  })
  if (error) throw error.code === '23505' ? new PushSetupError('other_account', 'This device is registered to another YVA account. Sign out there first.') : new Error(error.message)
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration(import.meta.env.BASE_URL)
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

/** Sign out, first removing this device's phone/computer notifications (so a shared device stops getting them) */
export async function signOutAndForgetDevice(): Promise<void> {
  try { await Promise.race([disablePush(), new Promise(r => setTimeout(r, 2500))]) } catch { /* still sign out */ }
  await supabase.auth.signOut()
}
