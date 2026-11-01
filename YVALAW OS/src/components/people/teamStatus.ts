// People hub: YVA Time status per employee for the Team table (tracking now / app connected / invited / no login).
// Reads the same staff-readable tables the Live tab and the profile's Computers list use.
import { supabase } from '../../lib/supabase'
import type { Employee } from '../../data/types'

export type TimeStatus = 'tracking' | 'connected' | 'signed_out' | 'invited' | 'none'
export const TIME_STATUS: Record<TimeStatus, { label: string; tone: 'success' | 'muted' | 'warning' | 'off'; live?: boolean }> = {
  tracking:   { label: 'Tracking now', tone: 'success', live: true },
  connected:  { label: 'Connected', tone: 'muted' },
  signed_out: { label: 'Signed out', tone: 'off' },
  invited:    { label: 'Invited', tone: 'warning' },
  none:       { label: 'No login', tone: 'off' },
}

const LIVE_MS = 3 * 60_000   // same rule as Time Tracking → Live: a block updated in the last 3 minutes

export async function loadTimeActivity(): Promise<{ tracking: Set<string>; devices: Map<string, { active: number; total: number }> }> {
  const since = new Date(Date.now() - LIVE_MS).toISOString()
  const [blocks, devs] = await Promise.all([
    supabase.from('tracker_blocks').select('employee_id,updated_at').gte('updated_at', since).limit(1000),
    supabase.from('desktop_devices').select('employee_id,signed_out_at,revoked_at').limit(2000),
  ])
  const tracking = new Set<string>(((blocks.data || []) as { employee_id: string }[]).map(b => String(b.employee_id)))
  const devices = new Map<string, { active: number; total: number }>()
  for (const d of (devs.data || []) as { employee_id: string; signed_out_at: string | null; revoked_at: string | null }[]) {
    const k = String(d.employee_id), cur = devices.get(k) || { active: 0, total: 0 }
    cur.total++
    if (!d.signed_out_at && !d.revoked_at) cur.active++
    devices.set(k, cur)
  }
  return { tracking, devices }
}

export function timeStatusOf(e: Employee, a: { tracking: Set<string>; devices: Map<string, { active: number; total: number }> } | null): TimeStatus {
  if (a?.tracking.has(e.id)) return 'tracking'
  const d = a?.devices.get(e.id)
  if (d?.active) return 'connected'
  if (d?.total) return 'signed_out'
  return e.userId ? 'invited' : 'none'
}
