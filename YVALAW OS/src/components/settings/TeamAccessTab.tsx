import { useState } from 'react'
import { sendEmail } from '../../services/gmail'
import { loadUserRoles, upsertUserRole, type UserRoleRow } from '../../services/storage'
import { ROLE_LABELS, ROLE_OPTIONS, type UserRole } from '../../lib/roles'
import { Ic, P } from '../Icon'
import { Banner, onEnter } from '../ui'
import { dateMed, initials } from '../../utils/format'
import PermissionsMatrix from '../PermissionsMatrix'

const SIGNUP_PATH = '/os/xDdasQwd24zaQ'
type Row = UserRoleRow & { created_at?: string }

/** Settings → Team access (CEO only): invite, users with role selects, permissions grid */
export default function TeamAccessTab({ users, setUsers, meId, notify }: {
  users: Row[] | null
  setUsers: (rows: Row[]) => void
  meId: string | null
  notify: (tone: 'success' | 'danger', text: string) => void
}) {
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const signupUrl = `${window.location.origin}${SIGNUP_PATH}`

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviteSending(true)
    setInviteMsg(null)
    const subject = `You've been invited to YVA OS`
    const body = `Hi,\n\nYou've been invited to join YVA OS — the internal operations platform.\n\nClick the link below to create your account:\n${signupUrl}\n\nOnce you sign up, your account will be active and an admin can assign your role.\n\nWelcome to the team!\n\n— YVA Staffing`
    try {
      const r = await sendEmail(inviteEmail.trim(), subject, body)
      if (r?.mode === 'failed') throw new Error(r.fallbackReason || 'not sent')
      setInviteMsg({ type: 'ok', text: `Invite sent to ${inviteEmail.trim()}` })
      setInviteEmail('')
    } catch {
      setInviteMsg({ type: 'err', text: 'Failed to send invite. Make sure Gmail is connected.' })
    }
    setInviteSending(false)
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(signupUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { window.prompt('Copy this link:', signupUrl) }
  }

  async function changeRole(u: Row, newRole: string) {
    if (!users) return
    const before = users
    setUsers(users.map(r => r.user_id === u.user_id ? { ...r, role: newRole } : r))
    try {
      await upsertUserRole(u.user_id, u.email, newRole)
      // upsertUserRole doesn't report failures, so read the row back
      const fresh = await loadUserRoles()
      if (fresh.find(r => r.user_id === u.user_id)?.role !== newRole) throw new Error('not saved')
      setUsers(fresh)
      notify('success', `${u.email || 'User'} is now ${ROLE_LABELS[newRole as UserRole] ?? newRole}.`)
    } catch {
      setUsers(before)
      notify('danger', `Could not change the role for ${u.email || 'this user'}. Try again.`)
    }
  }

  const sorted = users ? [...users].sort((a, b) => Number(b.role === 'pending') - Number(a.role === 'pending')) : null
  const pending = users?.filter(u => u.role === 'pending').length ?? 0

  return (
    <>
      <section className="set-card set-card--flush" aria-label="People with access">
        <div className="set-card__head">
          <div className="set-card__titles">
            <h2 className="set-card__title">People with access</h2>
            <span className="set-card__sub">
              {pending > 0 ? `${pending} new sign-up${pending === 1 ? '' : 's'} waiting for a role` : 'New sign-ups wait here until you pick a role'}
            </span>
          </div>
        </div>
        {sorted === null ? (
          <div className="set-hist__skel">{[0, 1, 2].map(i => <span key={i} className="skel set-skel-row" />)}</div>
        ) : sorted.length === 0 ? (
          <div className="set-hist__empty">No users found. Users appear here after they first log in.</div>
        ) : sorted.map(u => {
          const isPending = u.role === 'pending'
          const isMe = u.user_id === meId
          const sub = isPending
            ? `Waiting for a role${u.created_at ? ` · signed up ${dateMed(u.created_at)}` : ''}`
            : isMe ? 'You' : ROLE_LABELS[u.role as UserRole] ?? u.role
          return (
            <div key={u.user_id} className={`set-user${isPending ? ' set-user--pending' : ''}`} data-role={u.role}>
              <span className="set-user__ini" aria-hidden>{initials((u.email || '?').split('@')[0].replace(/[._-]+/g, ' '))}</span>
              <div className="set-user__main">
                <span className="set-user__email">{u.email || '—'}</span>
                <span className={`set-user__sub${isPending ? ' set-user__sub--warn' : ''}`}>{sub}</span>
              </div>
              <select className="select" aria-label={`Role for ${u.email || 'user'}`} value={u.role} onChange={e => void changeRole(u, e.target.value)}>
                {isPending && <option value="pending" disabled>Pick a role…</option>}
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
          )
        })}
      </section>

      <PermissionsMatrix />

      <section className="set-card set-card--mid" aria-label="Invite a team member">
        <div className="set-card__titles">
          <h2 className="set-card__title">Invite a team member</h2>
          <span className="set-card__sub">Send a private signup link via your connected email. The recipient can register and will appear in the list above, waiting for a role.</span>
        </div>
        <div className="set-invite">
          <input className="input" type="email" aria-label="Invite email" placeholder="colleague@email.com" value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)} onKeyDown={onEnter(() => void sendInvite())} />
          <button type="button" className="btn btn--primary" onClick={() => void sendInvite()} disabled={inviteSending || !inviteEmail.trim()}>
            <Ic d={P.send} size={14} /> {inviteSending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
        {inviteMsg && <Banner tone={inviteMsg.type === 'ok' ? 'success' : 'danger'}>{inviteMsg.text}</Banner>}
        <div className="set-link-box">
          <span>Signup link</span>
          <span className="set-code">{signupUrl}</span>
          <button type="button" className="btn btn--xs" onClick={() => void copyLink()}>
            <Ic d={copied ? P.check : P.copy} size={13} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </section>
    </>
  )
}
