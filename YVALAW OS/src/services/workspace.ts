// Step 7: time off, announcements, holidays, employee documents (RLS decides who sees what).
import { supabase } from '../lib/supabase'

export type TimeOffRequest = { id: string; employee_id: string; kind: 'vacation' | 'sick' | 'personal' | 'other'; start_date: string; end_date: string; half_day: boolean; note: string | null
  status: 'pending' | 'approved' | 'declined' | 'cancelled'; decided_at: string | null; decision_note: string | null; created_at: string }
export type Announcement = { id: string; title: string; body: string; audience: 'all' | 'client' | 'yva'; pinned: boolean; published_at: string | null; created_at: string }
export type Holiday = { id: string; day: string; name: string; paid: boolean }
export type EmployeeDocument = { id: string; employee_id: string; title: string; category: 'contract' | 'policy' | 'tax' | 'id' | 'other'; storage_path: string; size_bytes: number | null; mime_type: string | null; created_at: string }

const missing = (e: { code?: string; message: string } | null) => (e ? (e.code === '42P01' ? 'Run supabase/migrate-step7-workspace.sql first.' : e.message) : null)

export async function loadTimeOff(filter: { status?: string; employeeId?: string; from?: string; to?: string } = {}): Promise<{ rows: TimeOffRequest[]; error: string | null }> {
  let q = supabase.from('time_off_requests').select('*').order('start_date', { ascending: false }).limit(200)
  if (filter.status) q = q.eq('status', filter.status)
  if (filter.employeeId) q = q.eq('employee_id', filter.employeeId)
  if (filter.from) q = q.gte('end_date', filter.from)
  if (filter.to) q = q.lte('start_date', filter.to)
  const { data, error } = await q
  return { rows: (data || []) as TimeOffRequest[], error: missing(error) }
}
export async function requestTimeOff(r: { kind: string; start: string; end: string; halfDay: boolean; note: string }): Promise<void> {
  const { error } = await supabase.from('time_off_requests').insert({ kind: r.kind, start_date: r.start, end_date: r.end, half_day: r.halfDay, note: r.note.trim() || null })
  if (error) throw new Error(error.message)
}
export async function cancelTimeOff(id: string): Promise<void> {
  const { error } = await supabase.from('time_off_requests').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending')
  if (error) throw new Error(error.message)
}
export async function decideTimeOff(id: string, approve: boolean, note: string): Promise<void> {
  const { error } = await supabase.from('time_off_requests').update({ status: approve ? 'approved' : 'declined', decision_note: note.trim() || null }).eq('id', id).eq('status', 'pending')
  if (error) throw new Error(error.message)
}

export async function loadAnnouncements(includeDrafts = false): Promise<{ rows: Announcement[]; error: string | null }> {
  let q = supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('published_at', { ascending: false, nullsFirst: true }).limit(100)
  if (!includeDrafts) q = q.not('published_at', 'is', null)
  const { data, error } = await q
  return { rows: (data || []) as Announcement[], error: missing(error) }
}
export async function saveAnnouncement(a: Partial<Announcement> & { title: string }): Promise<void> {
  const row = { title: a.title.trim(), body: (a.body || '').trim(), audience: a.audience || 'all', pinned: !!a.pinned, published_at: a.published_at ?? null }
  const { error } = a.id ? await supabase.from('announcements').update(row).eq('id', a.id) : await supabase.from('announcements').insert(row)
  if (error) throw new Error(error.message)
}
export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
export async function loadHolidays(fromDay?: string): Promise<Holiday[]> {
  let q = supabase.from('holidays').select('*').order('day')
  if (fromDay) q = q.gte('day', fromDay)
  const { data } = await q
  return (data || []) as Holiday[]
}
export async function saveHoliday(h: { day: string; name: string; paid: boolean }): Promise<void> {
  const { error } = await supabase.from('holidays').upsert({ day: h.day, name: h.name.trim(), paid: h.paid }, { onConflict: 'day' })
  if (error) throw new Error(error.message)
}
export async function deleteHoliday(id: string): Promise<void> {
  const { error } = await supabase.from('holidays').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function loadEmployeeDocuments(employeeId?: string): Promise<{ rows: EmployeeDocument[]; error: string | null }> {
  let q = supabase.from('employee_documents').select('*').order('created_at', { ascending: false })
  if (employeeId) q = q.eq('employee_id', employeeId)
  const { data, error } = await q
  return { rows: (data || []) as EmployeeDocument[], error: missing(error) }
}
export async function uploadEmployeeDocument(employeeId: string, file: File, title: string, category: EmployeeDocument['category']): Promise<void> {
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80)
  const path = `${employeeId}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('employee-documents').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (up.error) throw new Error(up.error.message)
  const { error } = await supabase.from('employee_documents').insert({ employee_id: employeeId, title: title.trim() || file.name, category, storage_path: path, size_bytes: file.size, mime_type: file.type || null })
  if (error) { await supabase.storage.from('employee-documents').remove([path]); throw new Error(error.message) }
}
export async function deleteEmployeeDocument(doc: EmployeeDocument): Promise<void> {
  const { error } = await supabase.from('employee_documents').delete().eq('id', doc.id)
  if (error) throw new Error(error.message)
  await supabase.storage.from('employee-documents').remove([doc.storage_path])
}
export async function openEmployeeDocument(doc: EmployeeDocument): Promise<void> {
  const { data, error } = await supabase.storage.from('employee-documents').createSignedUrl(doc.storage_path, 300)
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Could not open the file')
  window.open(data.signedUrl, '_blank', 'noopener')
}
