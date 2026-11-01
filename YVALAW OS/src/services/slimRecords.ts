// Settings → Data → "Make lists load faster": photos and attached files that older versions saved INSIDE
// employee / client / candidate records (as text) are moved to Storage, and the record keeps only the link.
// Every list of those records downloads that text on every page, so a few phone photos can make the whole
// app slow. Photos are shrunk to 320 px (they're only ever shown as small avatars); attached files are
// moved byte-for-byte. Runs only when the CEO clicks it; a file that fails to move is left as it was.
import type { Attachment, Candidate, Client, Employee } from '../data/types'
import { loadCandidates, loadClients, loadEmployees, saveCandidates, saveClients, saveEmployees } from './storage'
import { uploadFile } from './fileStorage'
import { dataUrlToBlob, isInlineData, uploadPhoto } from '../utils/photo'

type WithFiles = { id: string; photoUrl?: string; attachments?: Attachment[] }
export type SlimScan = { photos: number; files: number; bytes: number }

const inlineAtt = (a: Attachment) => !a.storageUrl && isInlineData(a.dataUrl)

function scanList(list: WithFiles[]): SlimScan {
  let photos = 0, files = 0, bytes = 0
  for (const r of list) {
    if (isInlineData(r.photoUrl)) { photos++; bytes += r.photoUrl.length }
    for (const a of r.attachments || []) if (inlineAtt(a)) { files++; bytes += a.dataUrl.length }
  }
  return { photos, files, bytes }
}

export async function scanInlineFiles(): Promise<SlimScan> {
  const [e, c, k] = await Promise.all([loadEmployees(), loadClients(), loadCandidates()])
  const parts = [scanList(e), scanList(c), scanList(k as WithFiles[])]
  return parts.reduce((s, p) => ({ photos: s.photos + p.photos, files: s.files + p.files, bytes: s.bytes + p.bytes }), { photos: 0, files: 0, bytes: 0 })
}

async function slimRecord<T extends WithFiles>(r: T, folder: string, fail: (msg: string) => void): Promise<T | null> {
  let changed = false
  let next: T = r
  if (isInlineData(r.photoUrl)) {
    try { next = { ...next, photoUrl: await uploadPhoto(dataUrlToBlob(r.photoUrl), `photos/${folder}/${r.id}`) }; changed = true }
    catch (e) { fail(`photo: ${(e as Error).message}`) }
  }
  if ((r.attachments || []).some(inlineAtt)) {
    const atts: Attachment[] = []
    for (const a of r.attachments || []) {
      if (!inlineAtt(a)) { atts.push(a); continue }
      try {
        const blob = dataUrlToBlob(a.dataUrl)
        const file = new File([blob], a.name || 'file', { type: a.mimeType || blob.type })
        const { storageUrl, storagePath } = await uploadFile(file, `${folder}/${r.id}`)
        atts.push({ ...a, dataUrl: '', storageUrl, storagePath }); changed = true
      } catch (e) { fail(`${a.name}: ${(e as Error).message}`); atts.push(a) }
    }
    next = { ...next, attachments: atts }
  }
  return changed ? next : null
}

/** Move every inline photo/file to Storage. Saves each list once (only the changed records/columns are written). */
export async function slimInlineFiles(onProgress?: (done: number, total: number) => void): Promise<{ moved: number; failed: string[] }> {
  const failed: string[] = []
  let moved = 0, done = 0
  const [employees, clients, candidates] = await Promise.all([loadEmployees(), loadClients(), loadCandidates()])
  const todo = (l: WithFiles[]) => l.filter(r => isInlineData(r.photoUrl) || (r.attachments || []).some(inlineAtt)).length
  const total = todo(employees) + todo(clients) + todo(candidates as WithFiles[])

  async function run<T extends WithFiles>(list: T[], folder: string, label: (r: T) => string, save: (l: T[]) => Promise<void>) {
    let any = false
    const out: T[] = []
    for (const r of list) {
      if (!(isInlineData(r.photoUrl) || (r.attachments || []).some(inlineAtt))) { out.push(r); continue }
      const slim = await slimRecord(r, folder, msg => failed.push(`${label(r)} — ${msg}`))
      if (slim) { out.push(slim); any = true; moved++ } else out.push(r)
      onProgress?.(++done, total)
    }
    if (any) await save(out)
  }
  await run<Employee>(employees, 'employees', r => r.name || 'Employee', saveEmployees)
  await run<Client>(clients, 'clients', r => r.name || 'Client', saveClients)
  await run<Candidate>(candidates as Candidate[], 'candidates', r => r.name || 'Candidate', saveCandidates)
  return { moved, failed }
}
