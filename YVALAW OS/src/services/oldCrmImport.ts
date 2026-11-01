// Settings → Data → Import from old CRM (CEO). Converts with utils/oldCrm.ts, then:
//  1. copies résumés / videos into this app's storage (files stored inside records, or still in the old CRM's
//     storage) — a file that can't be copied keeps its old link and is listed;
//  2. writes employees, clients, projects, invoices, candidates with upsert on id (keeps the original created dates;
//     running it again updates the same records — never duplicates, never deletes);
//  3. sets the employee / invoice number counters so new numbers continue after the imported ones;
//  4. reads the records back and checks the counts and the billed total.
// A field the database doesn't have is left out (listed in the result) instead of failing the whole import.
import { supabase } from '../lib/supabase'
import { clearReadCache } from '../lib/readCache'
import { uploadFile } from './fileStorage'
import { loadEmployeeCounter, loadInvoiceCounter, saveEmployeeCounter, saveInvoiceCounter } from './storage'
import { dataUrlToBlob } from '../utils/photo'
import { toSnakeRow } from '../utils/syncPlan'
import { convertOldCrmBackup, looksLikeBackup, type ConvertedBackup } from '../utils/oldCrm'
import type { Attachment } from '../data/types'

type Raw = Record<string, unknown>
const TABLES = ['employees', 'clients', 'projects', 'invoices', 'candidates'] as const
type Table = typeof TABLES[number]

export type ImportPreview = {
  data: ConvertedBackup
  existing: Record<Table, number>      // records already in YVA OS
  alreadyImported: Record<Table, number>   // of the file's records, how many are already here (a re-run updates them)
  fileBytes: number
}

const ownHost = () => { try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).host } catch { return '' } }

/** Read the file and work out what would happen — nothing is written */
export async function previewOldCrmImport(text: string): Promise<ImportPreview> {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error("This file isn't a backup (it isn't valid JSON).") }
  if (!looksLikeBackup(parsed)) throw new Error("This file doesn't look like a CRM backup (no employees, clients, projects, invoices or candidates).")
  const data = await convertOldCrmBackup(parsed, ownHost())
  const existing = {} as Record<Table, number>
  const alreadyImported = {} as Record<Table, number>
  for (const t of TABLES) {
    const { count } = await supabase.from(t).select('id', { count: 'exact', head: true })
    existing[t] = count ?? 0
    const ids = (data[t] as Raw[]).map(r => String(r.id))
    let found = 0
    for (let i = 0; i < ids.length; i += 150) {
      const { data: rows } = await supabase.from(t).select('id').in('id', ids.slice(i, i + 150))
      found += rows?.length ?? 0
    }
    alreadyImported[t] = found
  }
  return { data, existing, alreadyImported, fileBytes: data.files.reduce((s, f) => s + f.size, 0) }
}

export type ImportProgress = { step: string; done: number; total: number }
export type ImportResult = {
  written: Record<Table, number>
  verified: { ok: boolean; counts: Record<Table, number>; billed: number }
  filesCopied: number
  filesKept: string[]       // could not be copied → still linked to where they were
  skippedFields: string[]
}

/** Upsert in batches; a column this database doesn't have is dropped (and reported) instead of failing */
async function upsertAll(table: Table, rows: Raw[], skipped: Set<string>, onBatch: (n: number) => void): Promise<number> {
  let dropped = new Set<string>()
  const prepare = (r: Raw) => {
    const row = toSnakeRow(r)
    for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === '') row[k] = null
    for (const k of dropped) delete row[k]
    return row
  }
  let written = 0
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50)
    for (let attempt = 0; ; attempt++) {
      const { error } = await supabase.from(table).upsert(batch.map(prepare), { onConflict: 'id', defaultToNull: false })
      if (!error) break
      const col = /Could not find the '([^']+)' column/i.exec(error.message)?.[1]
      if (col && attempt < 25) { dropped = new Set([...dropped, col]); skipped.add(`${table}.${col}`); continue }
      throw new Error(`Saving ${table} failed: ${error.message}`)
    }
    written += batch.length
    onBatch(written)
  }
  return written
}

/** Copy every file that lives inside a record or in the old CRM's storage into this app's storage */
async function copyFiles(data: ConvertedBackup, onProgress: (p: ImportProgress) => void): Promise<{ copied: number; kept: string[] }> {
  const kept: string[] = []
  let copied = 0, done = 0
  const total = data.files.length
  for (const job of data.files) {
    onProgress({ step: `Copying files (${job.name})`, done, total })
    const rec = (data[job.table] as Raw[]).find(r => r.id === job.recordId)
    const atts = (rec?.attachments as Attachment[] | undefined) ?? []
    const a = atts[job.index]
    if (!a) { done++; continue }
    try {
      let blob: Blob
      if (job.kind === 'inline') blob = dataUrlToBlob(a.dataUrl)
      else {
        const res = await fetch(String(a.storageUrl))
        if (!res.ok) throw new Error(`the old storage answered ${res.status}`)
        blob = await res.blob()
      }
      const file = new File([blob], a.name || 'file', { type: a.mimeType || blob.type || 'application/octet-stream' })
      const { storageUrl, storagePath } = await uploadFile(file, `${job.table}/${job.recordId}`)
      atts[job.index] = { ...a, dataUrl: '', storageUrl, storagePath, size: a.size || file.size }
      copied++
    } catch (e) {
      kept.push(`${a.name || 'file'} — ${(e as Error).message}`)
    }
    done++
  }
  onProgress({ step: 'Copying files', done, total })
  return { copied, kept }
}

export async function runOldCrmImport(preview: ImportPreview, opts: { copyFiles: boolean }, onProgress: (p: ImportProgress) => void): Promise<ImportResult> {
  const data = preview.data
  const skipped = new Set<string>()
  let filesCopied = 0
  let filesKept: string[] = []
  if (opts.copyFiles && data.files.length) {
    const r = await copyFiles(data, onProgress)
    filesCopied = r.copied; filesKept = r.kept
  }
  const written = {} as Record<Table, number>
  for (const t of TABLES) {
    const rows = data[t] as Raw[]
    onProgress({ step: `Saving ${t}`, done: 0, total: rows.length })
    written[t] = rows.length ? await upsertAll(t, rows, skipped, n => onProgress({ step: `Saving ${t}`, done: n, total: rows.length })) : 0
  }
  // Number counters continue after the imported numbers (never go backwards)
  if (data.employeeCounter != null) {
    const cur = await loadEmployeeCounter().catch(() => 1)
    if (data.employeeCounter > cur) await saveEmployeeCounter(data.employeeCounter)
  }
  if (data.invoiceCounter != null) {
    const cur = await loadInvoiceCounter().catch(() => 1)
    if (data.invoiceCounter > cur) await saveInvoiceCounter(data.invoiceCounter)
  }
  clearReadCache()

  // Read back: every imported record is there, and the billed total matches the file
  onProgress({ step: 'Checking', done: 0, total: 1 })
  const counts = {} as Record<Table, number>
  let billed = 0
  for (const t of TABLES) {
    const ids = (data[t] as Raw[]).map(r => String(r.id))
    let found = 0
    for (let i = 0; i < ids.length; i += 150) {
      const { data: rows } = await supabase.from(t).select(t === 'invoices' ? 'id,subtotal' : 'id').in('id', ids.slice(i, i + 150))
      found += rows?.length ?? 0
      if (t === 'invoices') billed += (rows as unknown as { subtotal: number }[] | null)?.reduce((s, r) => s + (Number(r.subtotal) || 0), 0) ?? 0
    }
    counts[t] = found
  }
  billed = Math.round(billed * 100) / 100
  const ok = TABLES.every(t => counts[t] === (data[t] as Raw[]).length) && Math.abs(billed - data.summary.billed) < 0.05
  onProgress({ step: 'Done', done: 1, total: 1 })
  return { written, verified: { ok, counts, billed }, filesCopied, filesKept, skippedFields: [...skipped] }
}
