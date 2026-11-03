// Settings → Team access → "Delete login" (CEO only). The server function delete-staff-login.cjs does the work:
// deletes the sign-in and role, unlinks the staff profile (kept, with all history) and records it in the change history.
import { supabase } from '../lib/supabase'

export type DeletedLogin = { email: string; role: string; unlinkedEmployee: string | null }

export async function deleteStaffLogin(userId: string): Promise<DeletedLogin> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Please sign in again.')
  const res = await fetch('/.netlify/functions/delete-staff-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ userId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Could not delete the login (${res.status})`)
  return data as DeletedLogin
}
