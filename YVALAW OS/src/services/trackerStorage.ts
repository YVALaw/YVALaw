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
