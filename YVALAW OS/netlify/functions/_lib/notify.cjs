/**
 * Notifications: create them (bell), then deliver by email (configured Gmail sender) and
 * phone/computer push, respecting each person's choices (notification_prefs).
 *
 *   notify(userIds, { kind, title, body, link })      → rows in public.notifications
 *   notifyPermission(permission, {...})               → everyone holding that permission
 *   dispatchPending()                                 → email + push for new rows (scheduled every
 *                                                       5 minutes, and right after creating them)
 */
const { rest, enc, authAdmin, usersWithPermission, APP_URL } = require('./supa.cjs')
const { sendMail, senderToken, GmailNotSetUp } = require('./gmail.cjs')
const { sendPush, vapidKeys } = require('./webpush.cjs')

async function notify(userIds, { kind, title, body = null, link = null }) {
  const ids = [...new Set([].concat(userIds).filter(Boolean))]
  if (!ids.length) return []
  return rest('notifications', {
    method: 'POST', prefer: 'return=representation',
    body: ids.map(user_id => ({ user_id, kind, title: String(title).slice(0, 200), body: body ? String(body).slice(0, 2000) : null, link })),
  })
}

async function notifyPermission(permission, n) {
  return notify(await usersWithPermission(permission), n)
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function emailFor(n) {
  const url = n.link ? `${APP_URL}${n.link.replace(/^\//, '')}` : APP_URL
  const text = `${n.title}\n\n${n.body ? `${n.body}\n\n` : ''}Open YVA OS: ${url}\n\n— YVA OS (change which emails you get in Settings → Notifications)`
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#1b1e2b">
<div style="border-left:4px solid #facc15;padding:4px 0 4px 14px;margin-bottom:16px"><div style="font-size:17px;font-weight:700">${escapeHtml(n.title)}</div></div>
${n.body ? `<p style="font-size:14px;line-height:1.6;white-space:pre-line">${escapeHtml(n.body)}</p>` : ''}
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#facc15;color:#1b1e2b;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px">Open YVA OS</a></p>
<p style="font-size:12px;color:#6b7280">YVA OS · change which emails you get in Settings → Notifications</p></div>`
  return { subject: n.title, text, html }
}

/**
 * Deliver new notifications (created in the last 2 days, not yet picked up).
 * Safe to run concurrently: each row is claimed with a conditional update first.
 * Returns a summary for logs/tests.
 */
async function dispatchPending({ limit = 100 } = {}) {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const pending = await rest(`notifications?dispatch_claimed_at=is.null&created_at=gt.${enc(since)}&select=id&order=created_at&limit=${limit}`)
  if (!pending.length) return { claimed: 0, emailed: 0, pushed: 0, emailProblem: null }
  const claimed = await rest(`notifications?id=in.(${pending.map(p => p.id).join(',')})&dispatch_claimed_at=is.null`, {
    method: 'PATCH', prefer: 'return=representation', body: { dispatch_claimed_at: new Date().toISOString() },
  })
  if (!claimed.length) return { claimed: 0, emailed: 0, pushed: 0, emailProblem: null }

  const users = [...new Set(claimed.map(n => n.user_id))]
  const userList = users.map(enc).join(',')
  const [prefs, subs] = await Promise.all([
    rest(`notification_prefs?user_id=in.(${userList})&select=user_id,kind,email,push,email_to`),
    rest(`push_subscriptions?user_id=in.(${userList})&select=id,user_id,endpoint,p256dh,auth,failures`),
  ])
  const pref = (u, kind) => prefs.find(p => p.user_id === u && p.kind === kind)
  const emails = new Map()

  let sender = null, emailProblem = null
  const wantsEmail = claimed.some(n => pref(n.user_id, n.kind)?.email !== false)
  if (wantsEmail) {
    try { sender = await senderToken() } catch (e) { emailProblem = e.message; if (!(e instanceof GmailNotSetUp)) console.error('notify: gmail sender', e) }
  }
  let keys = null
  if (subs.length) keys = await vapidKeys().catch(e => { console.error('notify: vapid keys', e); return null })

  let emailed = 0, pushed = 0
  for (const n of claimed) {
    const p = pref(n.user_id, n.kind)
    const done = {}
    if (sender && p?.email !== false) {
      try {
        let to = pref(n.user_id, '*')?.email_to || emails.get(n.user_id)
        if (!to) { to = (await authAdmin(`users/${n.user_id}`)).email; emails.set(n.user_id, to) }
        if (to) { await sendMail({ to, ...emailFor(n) }, sender); done.emailed_at = new Date().toISOString(); emailed++ }
      } catch (e) { console.error('notify: email failed', n.id, e.message) }
    }
    if (keys && p?.push !== false) {
      const mine = subs.filter(s => s.user_id === n.user_id)
      let any = false
      for (const s of mine) {
        const r = await sendPush(s, { title: n.title, body: n.body || '', url: n.link || '/', tag: n.id }, keys)
        if (r === 'ok') { any = true; await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', body: { last_ok_at: new Date().toISOString(), failures: 0 } }).catch(() => {}) }
        else if (r === 'gone' || (s.failures || 0) >= 9) await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {})
        else await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', body: { failures: (s.failures || 0) + 1 } }).catch(() => {})
      }
      if (any) { done.pushed_at = new Date().toISOString(); pushed++ }
    }
    if (Object.keys(done).length) await rest(`notifications?id=eq.${n.id}`, { method: 'PATCH', body: done }).catch(() => {})
  }
  return { claimed: claimed.length, emailed, pushed, emailProblem }
}

module.exports = { notify, notifyPermission, dispatchPending, emailFor }
