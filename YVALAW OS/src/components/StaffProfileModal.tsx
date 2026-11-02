// "Create profile" for a staff login (Settings → Team access, account menu → Create my profile): asks for the
// name (prefilled from the email) and position (prefilled from the access role), then creates the YVA-team
// employee record and links the login (services/staffProfiles.ts).
import { useState } from 'react'
import type { Employee } from '../data/types'
import { ROLE_LABELS, type UserRole } from '../lib/roles'
import { createStaffProfile, nameFromEmail } from '../services/staffProfiles'
import { Banner, Field, Modal, onEnter } from './ui'

export type StaffLogin = { userId: string; email: string; role: string }

export default function StaffProfileModal({ login, meId, onClose, onCreated }: {
  login: StaffLogin | null
  meId: string | null
  onClose: () => void
  onCreated: (employee: Employee, existed: boolean) => void
}) {
  const [forId, setForId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (login && forId !== login.userId) {
    setForId(login.userId); setName(nameFromEmail(login.email)); setPosition(ROLE_LABELS[login.role as UserRole] ?? ''); setError(null); setBusy(false)
  }
  if (!login) return null
  const self = login.userId === meId

  async function create() {
    if (!login || !name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const { employee, existed } = await createStaffProfile({ userId: login.userId, email: login.email, name, role: login.role, position, meId })
      setBusy(false)
      onCreated(employee, existed)
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={self ? 'Create my profile' : 'Create profile'}
      sub={<>A YVA-team employee profile for <strong>{login.email}</strong>. Everything this login does is shown on it.</>}
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn--primary" onClick={() => void create()} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create profile'}</button>
      </>}>
      <div className="stack">
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="form-grid">
          <Field label="Full name *"><input className="input" aria-label="Full name" value={name} autoFocus onChange={e => setName(e.target.value)} onKeyDown={onEnter(() => void create())} /></Field>
          <Field label="Position"><input className="input" aria-label="Position" value={position} onChange={e => setPosition(e.target.value)} onKeyDown={onEnter(() => void create())} /></Field>
          <Field label="Email" full hint="From the login — used to sign in"><input className="input" value={login.email} readOnly aria-label="Email" /></Field>
        </div>
        <p className="set-hint">Added to the YVA team as Active with the next employee number. Pay, schedule and documents can be filled in on the profile.</p>
      </div>
    </Modal>
  )
}
