import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendEmail } from '../../services/email'
import { loadEmployees, loadUserRoles, upsertUserRole, type UserRoleRow } from '../../services/storage'
import { linkStaffProfile } from '../../services/staffProfiles'
import type { Employee } from '../../data/types'
import { ROLE_LABELS, ROLE_OPTIONS, isStaff, type AppRole, type UserRole } from '../../lib/roles'
import { Ic, P } from '../Icon'
import { Menu, Modal, onEnter } from '../ui'
import { dateMed, initials } from '../../utils/format'
import PermissionsMatrix from '../PermissionsMatrix'
import StaffProfileModal, { type StaffLogin } from '../StaffProfileModal'
import { useToast } from '../../context/ToastContext'
import { deleteStaffLogin } from '../../services/staffLogins'

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
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const signupUrl = `${window.location.origin}${SIGNUP_PATH}`
  const navigate = useNavigate()
  // Staff profiles: the employee record linked to each login (null = still loading)
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [creating, setCreating] = useState<StaffLogin | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  // "Delete login" (⋯ menu): the row being confirmed, and whether the request is running
  const [removing, setRemoving] = useState<Row | null>(null)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    let alive = true
    void loadEmployees().then(list => { if (alive) setEmployees(list) }).catch(() => { if (alive) setEmployees([]) })
    return () => { alive = false }
  }, [])

  async function linkExisting(u: Row, emp: Employee) {
    setLinking(u.user_id)
    try {
      await linkStaffProfile(emp.id, u.user_id, meId)
      setEmployees(prev => (prev ?? []).map(e => e.id === emp.id ? { ...e, userId: u.user_id } : e))
      notify('success', `${u.email || 'This login'} is now linked to ${emp.name}'s profile.`)
    } catch (e) {
      notify('danger', `Could not link ${u.email || 'this login'} to ${emp.name}: ${(e as Error).message}`)
    }
    setLinking(null)
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviteSending(true)
    const subject = `You've been invited to YVA OS`
    const body = `Hi,\n\nYou've been invited to join YVA OS — the internal operations platform.\n\nClick the link below to create your account:\n${signupUrl}\n\nOnce you sign up, your account will be active and an admin can assign your role.\n\nWelcome to the team!\n\n— YVA Staffing`
    try {
      const r = await sendEmail(inviteEmail.trim(), subject, body)
      if (r?.mode === 'failed') throw new Error(r.fallbackReason || 'not sent')
      toast.success(`Invite sent to ${inviteEmail.trim()}`)
      setInviteEmail('')
    } catch {
      toast.error('Failed to send invite. Check Settings → Integrations → Email sending.')
    }
    setInviteSending(false)
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(signupUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { window.prompt('Copy this link:', signupUrl) }
  }

  async function changeRole(u: Row, newRole: string) {
    if (!users) return
    // Only staff and pending sign-ups get a staff role here (a client or employee login must never become staff by accident)
    if (u.role !== 'pending' && !isStaff(u.role as AppRole)) return
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

  async function confirmDelete() {
    const u = removing
    if (!u || !users) return
    setDeleting(true)
    try {
      const r = await deleteStaffLogin(u.user_id)
      setUsers(users.filter(x => x.user_id !== u.user_id))
      setEmployees(prev => prev ? prev.map(e => e.userId && String(e.userId) === u.user_id ? { ...e, userId: undefined } : e) : prev)
      toast.success(`Deleted the login of ${r.email || u.email || 'this person'}.${r.unlinkedEmployee ? ` ${r.unlinkedEmployee}'s profile and history are kept.` : ' Their history is kept.'}`)
      setRemoving(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setDeleting(false)
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
          const profile = employees?.find(e => e.userId && String(e.userId) === u.user_id) ?? null
          const sameEmail = !profile && u.email ? employees?.find(e => !e.userId && e.email && e.email.toLowerCase() === u.email.toLowerCase()) ?? null : null
          const showProfile = !isPending && isStaff(u.role as AppRole)
          const sub = isPending
            ? `Waiting for a role${u.created_at ? ` · signed up ${dateMed(u.created_at)}` : ''}`
            : isMe ? 'You' : ROLE_LABELS[u.role as UserRole] ?? u.role
          return (
            <div key={u.user_id} className={`set-user${isPending ? ' set-user--pending' : ''}`} data-role={u.role}>
              <span className="set-user__ini" aria-hidden>{initials((u.email || '?').split('@')[0].replace(/[._-]+/g, ' '))}</span>
              <div className="set-user__main">
                <span className="set-user__email">{u.email || '—'}</span>
                <span className={`set-user__sub${isPending ? ' set-user__sub--warn' : ''}`}>{sub}</span>
                {showProfile && employees !== null && (
                  <span className="set-user__profile" data-profile={profile ? 'linked' : sameEmail ? 'match' : 'none'}>
                    {profile ? (
                      <>
                        <span className="set-user__pname">Profile: {profile.name}{profile.employeeNumber ? <> · <span className="mono">{profile.employeeNumber}</span></> : null}</span>
                        <button type="button" className="link" onClick={() => navigate(`/employees/${profile.id}`)}>Open profile</button>
                      </>
                    ) : (
                      <>
                        <span className="set-user__pname set-user__pname--none">No profile yet</span>
                        {sameEmail && <button type="button" className="link" disabled={linking === u.user_id} onClick={() => void linkExisting(u, sameEmail)}>{linking === u.user_id ? 'Linking…' : `Link to existing employee (${sameEmail.name})`}</button>}
                        <button type="button" className="link" onClick={() => setCreating({ userId: u.user_id, email: u.email || '', role: u.role })}>Create profile</button>
                      </>
                    )}
                  </span>
                )}
              </div>
              {isPending || isStaff(u.role as AppRole) ? (
                <select className="select" aria-label={`Role for ${u.email || 'user'}`} value={u.role} onChange={e => void changeRole(u, e.target.value)}>
                  {isPending && <option value="pending" disabled>Pick a role…</option>}
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              ) : (
                // Client portal / YVA Time logins are managed from the client or employee page — never turned into staff here
                <span className="set-user__fixed" title="Managed from the client or employee page">{u.role === 'client' ? 'Client portal login' : u.role === 'employee' ? 'Employee (YVA Time) login' : u.role}</span>
              )}
              {!isMe && (isPending || isStaff(u.role as AppRole)) && (
                <Menu label={`Actions for ${u.email || 'user'}`} buttonClass="btn btn--icon btn--ghost set-user__menu"
                  items={[{ label: isPending ? 'Delete sign-up' : 'Delete login', icon: P.trash, danger: true, onClick: () => setRemoving(u) }]} />
              )}
            </div>
          )
        })}
      </section>

      <Modal open={!!removing} onClose={() => { if (!deleting) setRemoving(null) }}
        title={`Delete ${removing?.email || 'this person'}'s login?`}
        sub={removing ? (removing.role === 'pending' ? 'New sign-up waiting for a role' : ROLE_LABELS[removing.role as UserRole] ?? removing.role) : undefined}
        footer={<>
          <button type="button" className="btn" disabled={deleting} onClick={() => setRemoving(null)}>Cancel</button>
          <button type="button" className="btn btn--danger" disabled={deleting} onClick={() => void confirmDelete()}>
            <Ic d={P.trash} size={14} /> {deleting ? 'Deleting…' : 'Delete login'}
          </button>
        </>}>
        {removing && (() => {
          const profile = employees?.find(e => e.userId && String(e.userId) === removing.user_id)
          return (
            <div className="set-del">
              <p className="set-del__lead"><strong>{removing.email || 'This person'}</strong> will no longer be able to sign in to YVA OS. This can't be undone — to give them access again, send a new invite.</p>
              <ul className="set-del__list">
                <li>Their sign-in and role are removed, and they get no more notification emails or phone alerts.</li>
                <li>{profile ? <>Their staff profile <strong>{profile.name}</strong> is kept (unlinked from this login).</> : 'No staff profile is linked to this login.'}</li>
                <li>Everything they did stays in the change history, and this deletion is recorded there too.</li>
              </ul>
            </div>
          )
        })()}
      </Modal>

      <StaffProfileModal login={creating} meId={meId} onClose={() => setCreating(null)} onCreated={(emp, existed) => {
        const who = creating?.email || 'this login'
        setCreating(null)
        notify('success', existed ? `${who} already had a profile (${emp.name}).` : `Profile created for ${emp.name}${emp.employeeNumber ? ` (${emp.employeeNumber})` : ''} and linked to ${who}.`)
        navigate(`/employees/${emp.id}`)
      }} />

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
