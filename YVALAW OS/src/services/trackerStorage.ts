// YVA Time data for the admin views (Time Tracking → Live / Screenshots).
// RLS: staff read tracker_blocks; only CEO/Admin read screenshots (rows + private bucket).
import { supabase } from '../lib/supabase'

export type TrackerBlock = {
  employeeId: string
  blockStart: number          // ms
  targetKey: string
  projectId: string | null
  workType: string | null
  seconds: number
  note: string | null
  status: 'tracked' | 'pending' | 'approved' | 'rejected' | 'removed'
  updatedAt: number           // ms — the app uploads about once a minute while tracking
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
  let q = supabase.from('tracker_blocks')
    .select('employee_id,block_start,target_key,project_id,work_type,seconds,note,status,updated_at')
    .gte('block_start', new Date(fromMs).toISOString())
    .lt('block_start', new Date(toMs).toISOString())
    .order('block_start')
  if (employeeId) q = q.eq('employee_id', employeeId)
  const { data, error } = await q
  if (error) { console.error('loadTrackerBlocks', error); return [] }
  return (data || []).map(r => ({
    employeeId: r.employee_id,
    blockStart: Date.parse(r.block_start),
    targetKey:  r.target_key,
    projectId:  r.project_id,
    workType:   r.work_type,
    seconds:    r.seconds,
    note:       r.note,
    status:     r.status,
    updatedAt:  Date.parse(r.updated_at),
  }))
}

export async function loadTrackerShots(employeeId: string, fromMs: number, toMs: number): Promise<TrackerShot[]> {
  const { data, error } = await supabase.from('tracker_screenshots')
    .select('id,employee_id,block_start,taken_at,monitor,storage_path')
    .eq('employee_id', employeeId)
    .gte('block_start', new Date(fromMs).toISOString())
    .lt('block_start', new Date(toMs).toISOString())
    .order('taken_at')
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

/** Latest screenshot-notice acceptance for an employee (null = never) */
export async function loadLatestConsent(employeeId: string): Promise<number | null> {
  const { data } = await supabase.from('tracker_consents').select('created_at')
    .eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(1)
  return data?.[0] ? Date.parse(data[0].created_at as string) : null
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
