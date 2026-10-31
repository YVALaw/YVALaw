// YVA Time data for the admin views (Time Tracking → Live / Approve / Schedule / Screenshots).
// RLS: staff read tracker_blocks; only CEO/Admin read screenshots (rows + private bucket).
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/pages'

export type TrackerBlock = {
  employeeId: string
  blockStart: number          // ms
  targetKey: string
  projectId: string | null
  workType: string | null
  seconds: number
  activeSeconds: number | null   // keyboard/mouse seconds (client team, app 0.3+); null = not measured
  firstOffset: number | null     // first counted second inside the block (0–599)
  lastOffset: number | null      // last counted second inside the block
  source: 'desktop' | 'manual'
  note: string | null
  status: 'tracked' | 'pending' | 'approved' | 'rejected' | 'removed'
  updatedAt: number           // ms — the app uploads about once a minute while tracking
}

/** Activity % from summed seconds (null when nothing was measured) */
export function activityPct(active: number, measuredSeconds: number): number | null {
  return measuredSeconds > 0 ? Math.round((active / measuredSeconds) * 100) : null
}

/** Sum activity over blocks that measured it (YVA team and manual time don't) */
export function blocksActivity(blocks: TrackerBlock[]): number | null {
  let active = 0, measured = 0
  for (const b of blocks) {
    if (b.activeSeconds === null || b.status === 'removed' || b.status === 'rejected') continue
    active += b.activeSeconds; measured += b.seconds
  }
  return activityPct(active, measured)
}

/** Colour for an activity % badge: green 60%+, amber 30–59%, red under 30% */
export function activityColor(pct: number): string {
  return pct >= 60 ? '#047857' : pct >= 30 ? '#b45309' : '#b91c1c'
}

export type TrackerShot = {
  id: string
  employeeId: string
  blockStart: number
  takenAt: number
  monitor: number
  storagePath: string
}

export async function loadTrackerBlocks(fromMs: number, toMs: number, employeeId?: string): Promise<TrackerBlock[]> {
  const { data, error } = await fetchAllPages<Record<string, any>>((from, to) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = supabase.from('tracker_blocks')
      .select('employee_id,block_start,target_key,project_id,work_type,seconds,active_seconds,first_offset,last_offset,source,note,status,updated_at')
      .gte('block_start', new Date(fromMs).toISOString())
      .lt('block_start', new Date(toMs).toISOString())
      .order('block_start').order('id')
    if (employeeId) q = q.eq('employee_id', employeeId)
    return q.range(from, to)
  })
  if (error) { console.error('loadTrackerBlocks', error); return [] }
  return (data || []).map(r => ({
    employeeId: r.employee_id,
    blockStart: Date.parse(r.block_start),
    targetKey:  r.target_key,
    projectId:  r.project_id,
    workType:   r.work_type,
    seconds:    r.seconds,
    activeSeconds: r.active_seconds ?? null,
    firstOffset:   r.first_offset ?? null,
    lastOffset:    r.last_offset ?? null,
    source:     r.source ?? 'desktop',
    note:       r.note,
    status:     r.status,
    updatedAt:  Date.parse(r.updated_at),
  }))
}

export async function loadTrackerShots(employeeId: string, fromMs: number, toMs: number): Promise<TrackerShot[]> {
  const { data, error } = await fetchAllPages<Record<string, any>>((from, to) => supabase.from('tracker_screenshots')   // eslint-disable-line @typescript-eslint/no-explicit-any
    .select('id,employee_id,block_start,taken_at,monitor,storage_path')
    .eq('employee_id', employeeId)
    .gte('block_start', new Date(fromMs).toISOString())
    .lt('block_start', new Date(toMs).toISOString())
    .order('taken_at').order('id').range(from, to))
  if (error) { console.error('loadTrackerShots', error); return [] }
  return (data || []).map(r => ({
    id:          r.id,
    employeeId:  r.employee_id,
    blockStart:  Date.parse(r.block_start),
    takenAt:     Date.parse(r.taken_at),
    monitor:     r.monitor,
    storagePath: r.storage_path,
  }))
}

/** Short-lived links to private screenshot files (1 hour) */
export async function signScreenshotUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from('screenshots').createSignedUrls(paths, 3600)
  if (error || !data) { console.error('signScreenshotUrls', error); return {} }
  return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path as string, d.signedUrl]))
}

/** Admin delete (hours are not changed — only an employee's own delete removes the block) */
export async function deleteTrackerShot(shot: TrackerShot): Promise<boolean> {
  const { error } = await supabase.from('tracker_screenshots').delete().eq('id', shot.id)
  if (error) { console.error('deleteTrackerShot', error); return false }
  await supabase.storage.from('screenshots').remove([shot.storagePath])
  return true
}

// ── Phase 2: approvals, manual time requests, consent ─────────────────────────

/** The browser's time zone — approval days are counted in it (same as the admin sees) */
export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santo_Domingo'

export type ManualRequest = {
  id: string
  employeeId: string
  projectId: string | null
  workType: string | null
  startsAt: number
  endsAt: number
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  approvedSeconds: number | null
  decisionNote: string | null
  createdAt: number
}

function toRequest(r: Record<string, unknown>): ManualRequest {
  return {
    id: r.id as string, employeeId: r.employee_id as string,
    projectId: (r.project_id as string | null) ?? null, workType: (r.work_type as string | null) ?? null,
    startsAt: Date.parse(r.starts_at as string), endsAt: Date.parse(r.ends_at as string),
    reason: r.reason as string, status: r.status as ManualRequest['status'],
    approvedSeconds: (r.approved_seconds as number | null) ?? null, decisionNote: (r.decision_note as string | null) ?? null,
    createdAt: Date.parse(r.created_at as string),
  }
}

/** Staff: requests (all or one status). Employees get their own through RLS. */
export async function loadManualRequests(status?: ManualRequest['status']): Promise<ManualRequest[]> {
  let q = supabase.from('manual_time_requests').select('*').order('starts_at', { ascending: false }).limit(200)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) { console.error('loadManualRequests', error); return [] }
  return (data || []).map(toRequest)
}

/** Approve finished days (up to yesterday) and roll them into time_entries */
export async function approveTime(employeeId: string, from: string, to: string): Promise<{ blocks: number; entries: number }> {
  const { data, error } = await supabase.rpc('yva_time_approve', { p_employee: employeeId, p_from: from, p_to: to, p_tz: LOCAL_TZ })
  if (error) throw new Error(error.message)
  return data as { blocks: number; entries: number }
}

/** Undo an approval (approved by mistake): back to "waiting", removed from time log / portal / invoice import */
export async function reopenTime(employeeId: string, from: string, to: string): Promise<{ blocks: number; entries: number }> {
  const { data, error } = await supabase.rpc('yva_time_reopen', { p_employee: employeeId, p_from: from, p_to: to, p_tz: LOCAL_TZ })
  if (error) throw new Error(error.message)
  return data as { blocks: number; entries: number }
}

export async function decideRequest(id: string, approve: boolean, note?: string): Promise<{ status: string; seconds: number }> {
  const { data, error } = await supabase.rpc('yva_time_decide_request', { p_request: id, p_approve: approve, p_note: note ?? null, p_tz: LOCAL_TZ })
  if (error) throw new Error(error.message)
  return data as { status: string; seconds: number }
}

export async function createManualRequest(r: { employeeId: string; projectId: string | null; workType: string | null; startsAt: Date; endsAt: Date; reason: string }) {
  const { error } = await supabase.from('manual_time_requests').insert({
    employee_id: r.employeeId, project_id: r.projectId, work_type: r.workType,
    starts_at: r.startsAt.toISOString(), ends_at: r.endsAt.toISOString(), reason: r.reason,
  })
  if (error) throw new Error(error.message)
}

export async function cancelManualRequest(id: string) {
  const { error } = await supabase.from('manual_time_requests').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending')
  if (error) throw new Error(error.message)
}

/** Latest screenshot-notice acceptance for an employee (null = never). Version 2 includes activity %. */
export async function loadLatestConsent(employeeId: string): Promise<{ at: number; version: number } | null> {
  const { data } = await supabase.from('tracker_consents').select('created_at,notice_version')
    .eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1)
  return data?.[0] ? { at: Date.parse(data[0].created_at as string), version: (data[0].notice_version as number | null) ?? 1 } : null
}

// ── Phase 3: computers signed in to YVA Time ──────────────────────────────────

export type DesktopDevice = {
  id: string
  name: string
  platform: string | null
  appVersion: string | null
  createdAt: number
  lastSeenAt: number
  signedOutAt: number | null
  revokedAt: number | null
}

export async function loadDevices(employeeId: string): Promise<DesktopDevice[]> {
  const { data, error } = await supabase.from('desktop_devices')
    .select('id,name,platform,app_version,created_at,last_seen_at,signed_out_at,revoked_at')
    .eq('employee_id', employeeId).order('last_seen_at', { ascending: false }).limit(50)
  if (error) { console.error('loadDevices', error); return [] }
  const ms = (v: unknown) => (v ? Date.parse(v as string) : null)
  return (data || []).map(r => ({
    id: r.id, name: r.name, platform: r.platform, appVersion: r.app_version,
    createdAt: ms(r.created_at)!, lastSeenAt: ms(r.last_seen_at)!, signedOutAt: ms(r.signed_out_at), revokedAt: ms(r.revoked_at),
  }))
}

/** Disconnect a computer (CEO/Admin/Accounting): ends its login; the database refuses its time */
export async function disconnectDevice(deviceId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('You must be logged in.')
  const res = await fetch('/.netlify/functions/desktop-device-revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ deviceId }),
  })
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new Error(data.error || 'Could not disconnect the computer')
}

/** Approved YVA Time hours for one project and date range (Invoice builder → Import YVA Time hours) */
export async function loadTrackerEntriesForProject(projectId: string, from: string, to: string) {
  const { data, error } = await supabase.from('time_entries')
    .select('employee_id,employee_name,date,hours')
    .eq('source', 'tracker').eq('project_id', projectId)
    .gte('date', from).lte('date', to)
  if (error) { console.error('loadTrackerEntriesForProject', error); return [] }
  return (data || []).map(r => ({
    employeeId: r.employee_id as string, employeeName: r.employee_name as string,
    date: r.date as string, hours: Number(r.hours) || 0,
  }))
}

/** Hours as "h:mm" — the invoice grid reads "7.25" as 7 h 25 min, so never write decimals there */
export function hoursToHM(hours: number): string {
  const minutes = Math.round(hours * 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
