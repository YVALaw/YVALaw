import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { GRANTABLE_ROLES, PERMISSIONS } from '../lib/permissions'
import { ROLE_LABELS } from '../lib/roles'

/** Settings → Team Access → Permissions (CEO only; the database enforces it too) */
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
  return (
    <div>
      {error && <div className="portal-message portal-message-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="table-wrap">
        <table className="perm-table">
          <thead>
            <tr>
              <th>Permission</th>
              <th>{ROLE_LABELS.ceo}</th>
              {GRANTABLE_ROLES.map(r => <th key={r}>{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => [
              <tr key={g} className="perm-group"><td colSpan={2 + GRANTABLE_ROLES.length}>{g}</td></tr>,
              ...PERMISSIONS.filter(p => p.group === g).map(p => (
                <tr key={p.key}>
                  <td>{p.label}<small>{p.help}</small></td>
                  <td><input type="checkbox" checked disabled aria-label={`CEO: ${p.label} (always)`} /></td>
                  {GRANTABLE_ROLES.map(r => (
                    <td key={r}>
                      <input type="checkbox" disabled={!ready || !!error && !granted.size} checked={granted.has(`${r}|${p.key}`)}
                        aria-label={`${ROLE_LABELS[r]}: ${p.label}`} onChange={() => void toggle(r, p.key)} />
                    </td>
                  ))}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  )
}
