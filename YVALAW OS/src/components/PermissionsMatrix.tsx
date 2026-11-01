import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GRANTABLE_ROLES, PERMISSIONS } from '../lib/permissions'
import { ROLE_LABELS } from '../lib/roles'
import { Banner, Skel } from './ui'
import BoxToggle from './settings/BoxToggle'

/** Settings → Team access → Permissions (CEO only; the database enforces it too).
 *  Roles are columns; click a box to grant or remove. The CEO always has everything. */
export default function PermissionsMatrix() {
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void supabase.from('role_permissions').select('role,permission').then(({ data, error: e }) => {
      if (e) setError(e.code === '42P01' ? 'Run supabase/migrate-step1-foundation.sql in Supabase to turn on permissions.' : e.message)
      setGranted(new Set((data || []).map(r => `${r.role}|${r.permission}`)))
      setReady(true)
    })
  }, [])

  async function toggle(role: string, permission: string) {
    const key = `${role}|${permission}`
    const on = !granted.has(key)
    setError(null)
    setGranted(s => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n })
    const { error: e } = on
      ? await supabase.from('role_permissions').insert({ role, permission })
      : await supabase.from('role_permissions').delete().eq('role', role).eq('permission', permission)
    if (e) {
      setError(e.message)
      setGranted(s => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n })
    }
  }

  const groups = [...new Set(PERMISSIONS.map(p => p.group))]
  const locked = !ready || (!!error && !granted.size)
  return (
    <section className="set-card set-card--scroll" aria-label="Permissions">
      <div className="set-card__head">
        <div className="set-card__titles">
          <h2 className="set-card__title">Permissions</h2>
          <span className="set-card__sub">{ROLE_LABELS.ceo} always has everything. Click to grant or remove.</span>
        </div>
      </div>
      {error && <div className="set-perm__error"><Banner tone="danger">{error}</Banner></div>}
      <div className="set-perm" role="table" aria-label="Permissions by role">
        <div className="set-perm__row set-perm__row--head" role="row">
          <span role="columnheader">Permission</span>
          {GRANTABLE_ROLES.map(r => <span key={r} role="columnheader">{ROLE_LABELS[r]}</span>)}
        </div>
        {!ready ? [0, 1, 2, 3, 4].map(i => (
          <div key={i} className="set-perm__row" role="row"><Skel w="60%" />{GRANTABLE_ROLES.map(r => <Skel key={r} w={22} h={22} r={6} />)}</div>
        )) : groups.map(g => [
          <div key={g} className="set-perm__row set-perm__row--group" role="row"><span role="cell">{g}</span></div>,
          ...PERMISSIONS.filter(p => p.group === g).map(p => (
            <div key={p.key} className="set-perm__row" role="row">
              <span className="set-perm__label" role="cell" title={p.help}>
                <span>{p.label}</span>
                <span className="set-perm__key">{p.key}</span>
              </span>
              {GRANTABLE_ROLES.map(r => (
                <span key={r} className="set-perm__cell" role="cell">
                  <BoxToggle label={`${ROLE_LABELS[r]}: ${p.label}`} disabled={locked}
                    checked={granted.has(`${r}|${p.key}`)} onChange={() => void toggle(r, p.key)} />
                  <span className="set-perm__role" aria-hidden>{ROLE_LABELS[r]}</span>
                </span>
              ))}
            </div>
          )),
        ])}
      </div>
    </section>
  )
}
