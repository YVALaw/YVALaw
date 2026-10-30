// Talks to YVA OS: the employee-me function and Supabase (tracker tables + screenshots bucket).
// Supabase row-level security decides what this login may write; see
// YVALAW OS/supabase/migrate-yva-time-phase1.sql.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '../shared/types'
import type { BlockRow } from './tracker'
import { API_BASE } from './config'

/** Thrown when the server can't be reached — the work stays queued on this computer */
export class OfflineError extends Error {}
/** Thrown when the login is no longer valid — the person must sign in again */
export class SignedOutError extends Error {}
/** Thrown when YVA disconnected this computer (Employee profile → YVA Time Login → Computers) */
export class DisconnectedError extends Error {}

const OFFLINE_RE = /fetch failed|network|ENOTFOUND|ECONNRE|ETIMEDOUT|EAI_AGAIN|Failed to fetch/i

/** supabase-js reports a failed connection as status 0 with a fetch error message */
function isNetworkFailure(status: number | undefined, message: string | undefined): boolean {
  return !status || OFFLINE_RE.test(message || '')
}

export async function fetchProfile(token: string): Promise<Profile> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/.netlify/functions/employee-me`, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new OfflineError('offline')
  }
  if (res.status === 401) throw new SignedOutError('signed out')
  const data = await res.json().catch(() => ({})) as {
    employee?: { id: string; name: string; email: string | null; worksFor: 'client' | 'yva'; manualTimeAllowed: boolean
                 defaultShiftStart: string | null; defaultShiftEnd: string | null }
    projects?: { id: string; name: string; clientName: string | null; status: string | null }[]
    error?: string
  }
  if (!res.ok || !data.employee) throw new Error(data.error || 'Could not load your profile')
  return {
    employeeId:        data.employee.id,
    name:              data.employee.name,
    email:             data.employee.email,
    worksFor:          data.employee.worksFor,
    manualTimeAllowed: data.employee.manualTimeAllowed,
    shiftStart:        data.employee.defaultShiftStart ?? null,
    shiftEnd:          data.employee.defaultShiftEnd ?? null,
    projects: (data.projects || [])
      .filter(p => !p.status || !/^(completed|closed|cancel)/i.test(p.status))
      .map(p => ({ id: p.id, name: p.name, clientName: p.clientName })),
  }
}

/** activity = client team only (the YVA team's activity is never sent) */
function toServerRow(employeeId: string, r: BlockRow, activity: boolean) {
  const empty = r.removed || r.seconds === 0
  return {
    employee_id:    employeeId,
    block_start:    new Date(r.blockStart).toISOString(),
    target_key:     r.targetKey,
    project_id:     r.projectId,
    work_type:      r.workType,
    seconds:        empty ? 0 : r.seconds,
    active_seconds: activity ? (empty ? 0 : Math.min(r.active, r.seconds)) : null,
    first_offset:   empty ? null : r.first,
    last_offset:    empty ? null : r.last,
    note:           r.note,
    source:         'desktop',
  }
}

/**
 * Upload blocks (absolute seconds, so retrying is safe). If the batch is refused,
 * rows are retried one by one so a single bad row can't block everything else.
 */
export async function upsertBlocks(c: SupabaseClient, employeeId: string, rows: BlockRow[], activity: boolean): Promise<{ saved: BlockRow[]; refused: BlockRow[] }> {
  if (rows.length === 0) return { saved: [], refused: [] }
  const send = (batch: BlockRow[]) => c.from('tracker_blocks')
    .upsert(batch.map(r => toServerRow(employeeId, r, activity)), { onConflict: 'employee_id,block_start,target_key,source' })

  const { error, status } = await send(rows)
  if (!error) return { saved: rows, refused: [] }
  if (isNetworkFailure(status, error.message) || status >= 500) throw new OfflineError(error.message)
  if (status === 401) throw new SignedOutError(error.message)

  const saved: BlockRow[] = [], refused: BlockRow[] = []
  for (const r of rows) {
    const one = await send([r])
    if (!one.error) saved.push(r)
    else if (isNetworkFailure(one.status, one.error.message) || one.status >= 500) throw new OfflineError(one.error.message)
    else refused.push(r)
  }
  return { saved, refused }
}

export async function loadRecentBlocks(c: SupabaseClient, employeeId: string, sinceMs: number) {
  const { data, error, status } = await c.from('tracker_blocks')
    .select('block_start,target_key,seconds,status,note,active_seconds,first_offset,last_offset')
    .eq('employee_id', employeeId)
    .eq('source', 'desktop')          // approved manual time lives in its own rows
    .gte('block_start', new Date(sinceMs).toISOString())
  if (error) {
    if (isNetworkFailure(status, error.message)) throw new OfflineError(error.message)
    throw new Error(error.message)
  }
  return (data || []).map(r => ({
    blockStart: Date.parse(r.block_start as string),
    targetKey:  r.target_key as string,
    seconds:    r.seconds as number,
    status:     r.status as string,
    note:       (r.note as string | null) ?? null,
    active:     (r.active_seconds as number | null) ?? null,
    first:      (r.first_offset as number | null) ?? null,
    last:       (r.last_offset as number | null) ?? null,
  }))
}

/**
 * Check-in (every sync, before uploading): records the app version and confirms this
 * computer is still connected. The database only accepts time from a connected computer.
 */
export async function checkDevice(c: SupabaseClient, deviceId: string, appVersion: string) {
  const { data, error, status } = await c.from('desktop_devices')
    .update({ app_version: appVersion.slice(0, 40) }).eq('id', deviceId).select('id')
  if (error) {
    if (isNetworkFailure(status, error.message) || status >= 500) throw new OfflineError(error.message)
    if (status === 401) throw new SignedOutError(error.message)
    throw new Error(error.message)
  }
  if ((data || []).length === 1) return
  // Nothing matched: disconnected by YVA, signed out, or the record is gone
  const row = await c.from('desktop_devices').select('revoked_at,signed_out_at').eq('id', deviceId).maybeSingle()
  if (row.error) {
    if (isNetworkFailure(row.status, row.error.message) || row.status >= 500) throw new OfflineError(row.error.message)
    throw new Error(row.error.message)
  }
  throw new DisconnectedError(row.data?.revoked_at || !row.data ? 'disconnected' : 'signed out')
}

/** Sign out: this computer stops being able to save time (best effort — the login ends anyway) */
export async function markSignedOut(c: SupabaseClient, deviceId: string) {
  await c.from('desktop_devices').update({ signed_out_at: new Date().toISOString() }).eq('id', deviceId)
}

export function screenshotPath(employeeId: string, takenAt: number, id: string, monitor: number): string {
  return `${employeeId}/${new Date(takenAt).toISOString().slice(0, 10)}/${id}-${monitor}.jpg`
}

export async function uploadScreenshot(c: SupabaseClient, employeeId: string, item: {
  path: string; blockStart: number; takenAt: number; monitor: number; jpeg: Buffer
}) {
  const up = await c.storage.from('screenshots').upload(item.path, item.jpeg, { contentType: 'image/jpeg', upsert: false })
  if (up.error && !/already exists|Duplicate/i.test(up.error.message)) {
    if (OFFLINE_RE.test(up.error.message)) throw new OfflineError(up.error.message)
    throw new Error(up.error.message)
  }
  const { error, status } = await c.from('tracker_screenshots').upsert({
    employee_id:  employeeId,
    block_start:  new Date(item.blockStart).toISOString(),
    taken_at:     new Date(item.takenAt).toISOString(),
    monitor:      item.monitor,
    storage_path: item.path,
  }, { onConflict: 'storage_path', ignoreDuplicates: true })
  if (error) {
    if (isNetworkFailure(status, error.message)) throw new OfflineError(error.message)
    throw new Error(error.message)
  }
}

/** Delete uploaded screenshots (allowed for 2 minutes after upload; the server then removes the block) */
export async function deleteScreenshots(c: SupabaseClient, paths: string[]) {
  const rows = await c.from('tracker_screenshots').delete().in('storage_path', paths).select('id')
  if (rows.error) {
    if (isNetworkFailure(rows.status, rows.error.message)) throw new OfflineError(rows.error.message)
    throw new Error(rows.error.message)
  }
  if ((rows.data || []).length !== paths.length) throw new Error('Too late — screenshots can only be deleted within 2 minutes.')
  await c.storage.from('screenshots').remove(paths)
}

/** Record that the employee accepted the screenshot notice (shown to YVA on their profile) */
export async function recordConsent(c: SupabaseClient, employeeId: string, appVersion: string, noticeVersion: number) {
  const { error, status } = await c.from('tracker_consents')
    .insert({ employee_id: employeeId, app_version: appVersion.slice(0, 40), notice_version: noticeVersion })
  if (error) {
    if (isNetworkFailure(status, error.message)) throw new OfflineError(error.message)
    throw new Error(error.message)
  }
}
