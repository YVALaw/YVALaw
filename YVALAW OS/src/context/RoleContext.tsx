import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AppRole, UserRole } from '../lib/roles'
import { auditPortalActivity } from '../services/portalStorage'

type RoleCtx = {
  role:               AppRole
  userId:             string | null
  email:              string | null
  loading:            boolean
  isClient:           boolean
  clientId:           string | null
  mustChangePassword: boolean
}

const ROLE_CACHE_KEY = 'yva_role'
const PORTAL_LOGIN_AUDIT_PREFIX = 'yva_portal_login_audit_'

function portalLoginAuditKey(clientId: string, userId: string): string {
  return `${PORTAL_LOGIN_AUDIT_PREFIX}${clientId}_${userId}`
}

function clearPortalLoginAuditKeys() {
  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const key = sessionStorage.key(i)
    if (key?.startsWith(PORTAL_LOGIN_AUDIT_PREFIX)) sessionStorage.removeItem(key)
  }
}

const Ctx = createContext<RoleCtx>({
  role: 'recruiter', userId: null, email: null, loading: true,
  isClient: false, clientId: null, mustChangePassword: false,
})

export function RoleProvider({ children }: { children: ReactNode }) {
  const cached = sessionStorage.getItem(ROLE_CACHE_KEY) as AppRole | null
  const [role,               setRole]               = useState<AppRole>(cached ?? 'recruiter')
  const [userId,             setUserId]             = useState<string | null>(null)
  const [email,              setEmail]              = useState<string | null>(null)
  const [isClient,           setIsClient]           = useState(cached === 'client')
  const [clientId,           setClientId]           = useState<string | null>(null)
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [loading,            setLoading]            = useState(!cached)

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { setLoading(false); return }

      setUserId(user.id)
      setEmail(user.email ?? null)

      // Check must_change_password flag from user metadata (set by invite function)
      const meta = user.user_metadata ?? {}
      setMustChangePassword(meta.must_change_password === true)

      // ── Step 1: Check internal user_roles table ───────────────────────────
      const { data: roleRow } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single()

      if (roleRow?.role && roleRow.role !== 'client') {
        // Internal OS user
        setRole(roleRow.role as UserRole)
        setIsClient(false)
        setClientId(null)
        sessionStorage.setItem(ROLE_CACHE_KEY, roleRow.role)
        setLoading(false)
        return
      }

      // ── Step 2: Check client_users table ─────────────────────────────────
      const { data: clientRow } = await supabase
        .from('client_users')
        .select('client_id')
        .eq('auth_id', user.id)
        .single()

      if (clientRow?.client_id) {
        setRole('client')
        setIsClient(true)
        setClientId(clientRow.client_id)
        sessionStorage.setItem(ROLE_CACHE_KEY, 'client')
        const auditKey = portalLoginAuditKey(clientRow.client_id, user.id)
        if (!sessionStorage.getItem(auditKey)) {
          void auditPortalActivity({ clientId: clientRow.client_id, eventType: 'portal_login' })
            .then(() => sessionStorage.setItem(auditKey, '1'))
            .catch(err => console.warn('portal login audit skipped', err))
        }
        setLoading(false)
        return
      }

      // ── Step 3: Unknown user — auto-assign recruiter (internal signup path) ──
      await supabase
        .from('user_roles')
        .insert({ user_id: user.id, email: user.email, role: 'recruiter' })
      setRole('recruiter')
      setIsClient(false)
      setClientId(null)
      sessionStorage.setItem(ROLE_CACHE_KEY, 'recruiter')
      setLoading(false)
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(ROLE_CACHE_KEY)
        clearPortalLoginAuditKeys()
        setRole('recruiter')
        setUserId(null)
        setEmail(null)
        setIsClient(false)
        setClientId(null)
        setMustChangePassword(false)
      }
      if (event === 'USER_UPDATED' && session) {
        // Re-check must_change_password after password update
        const meta = session.user.user_metadata ?? {}
        setMustChangePassword(meta.must_change_password === true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <Ctx.Provider value={{ role, userId, email, loading, isClient, clientId, mustChangePassword }}>
      {children}
    </Ctx.Provider>
  )
}

export function useRole() { return useContext(Ctx) }
