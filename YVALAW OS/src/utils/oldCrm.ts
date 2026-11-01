// Old CRM (YVALaw/YVA-OS) backup → YVA OS records. Pure conversion, no database (unit-tested in tests/oldCrm.test.ts);
// services/oldCrmImport.ts writes the result. Decisions (2026-11, owner's real data):
//  • IDs: UUIDs are kept; the old short ids ("mn2vlzpdbm0oxl") become a UUID derived from them (same input → same
//    UUID), so links between employees / clients / projects / invoices survive and running the import twice updates
//    instead of duplicating.
//  • Hours: the old CRM wrote "39.51" for 39 h 51 min (from April 2026) but plain decimals before that. Each invoice's
//    format is decided from its own recorded total; hours are stored as decimal hours (what YVA OS reads) and the
//    daily grid as "h:mm". Recorded totals (subtotal, amount paid) are never recomputed.
//  • Night premium: the line's billed amount (billAmount) is kept, so the line shows what was billed.
//  • Invoice status spelling normalised ("Paid" → "paid"); invoices get client_id from the client name.
import type { Attachment } from '../data/types'

type Raw = Record<string, unknown>
export type OldCrmBackup = { employees?: Raw[]; clients?: Raw[]; projects?: Raw[]; invoices?: Raw[]; candidates?: Raw[]; invoiceCounter?: number }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown) => (v == null ? '' : String(v))
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d

/** Is this a backup from the old CRM / YVA OS export? */
export function looksLikeBackup(v: unknown): v is OldCrmBackup {
  if (!v || typeof v !== 'object') return false
  const o = v as Raw
  return ['employees', 'clients', 'projects', 'invoices', 'candidates'].some(k => Array.isArray(o[k]))
}

/** Same old id → same UUID (SHA-256 based); real UUIDs are kept */
export async function stableUuid(oldId: string): Promise<string> {
  if (UUID_RE.test(oldId)) return oldId.toLowerCase()
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`yva-old-crm:${oldId}`)))
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = [...h.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

/** "39.51" → 39.85 (39 h 51 min). Exactly two digits after the point under 60 = minutes; anything else is decimal. */
export function hmToHours(v: unknown): number {
  const s = str(v).trim().replace(',', '.')
  if (!s) return 0
  if (s.includes(':')) { const [h, m] = s.split(':'); return num(h) + num(m) / 60 }
  const m = /^(\d+)\.(\d{2})$/.exec(s)
  if (m && Number(m[2]) < 60) return Number(m[1]) + Number(m[2]) / 60
  return num(s)
}
const decHours = (v: unknown) => num(str(v).trim().replace(',', '.'))

/** Can this value only be a decimal (3+ decimals, or "x.75"-style minutes ≥ 60)? */
function onlyDecimal(v: unknown): boolean {
  const s = str(v).trim()
  if (/^\d+\.\d{3,}$/.test(s)) return true
  const m = /^\d+\.(\d{2})$/.exec(s)
  return !!m && Number(m[1]) >= 60
}
/** Does reading it as h.mm change anything (two digits after the point)? */
const ambiguous = (v: unknown) => /^\d+\.\d{2}$/.test(str(v).trim())

const toHM = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }

export type HoursFormat = 'hm' | 'decimal' | 'whole'
const HM_SINCE = '2026-04-14'   // when the old CRM switched to h.mm

/** Which hour format an old invoice used, judged by its own recorded total */
export function invoiceHoursFormat(inv: Raw): HoursFormat {
  const items = (Array.isArray(inv.items) ? inv.items : []) as Raw[]
  const hourItems = items.filter(it => it.kind !== 'item')
  const values = hourItems.flatMap(it => [it.hoursTotal, ...Object.values((it.daily as Raw) || {})])
  if (values.some(onlyDecimal)) return 'decimal'
  if (!values.some(ambiguous)) return 'whole'
  const total = (read: (v: unknown) => number) => items.reduce((s, it) => {
    if (it.kind === 'item') return s + num(it.qty) * num(it.rate)
    if (it.billAmount != null && num(it.premiumHours) > 0) return s + num(it.billAmount)
    return s + read(it.hoursTotal) * num(it.rate)
  }, 0)
  const sub = num(inv.subtotal)
  const hmOk = Math.abs(total(hmToHours) - sub) < 0.06
  const decOk = Math.abs(total(decHours) - sub) < 0.06
  if (hmOk && !decOk) return 'hm'
  if (decOk && !hmOk) return 'decimal'
  return str(inv.date) >= HM_SINCE ? 'hm' : 'decimal'
}

export type FileJob = { table: 'candidates' | 'employees'; recordId: string; index: number; name: string; size: number; kind: 'inline' | 'copy' }
export type ConvertedBackup = {
  employees: Raw[]; clients: Raw[]; projects: Raw[]; invoices: Raw[]; candidates: Raw[]
  files: FileJob[]
  employeeCounter: number | null    // next employee number for this year, from the imported numbers
  invoiceCounter: number | null
  summary: {
    invoicesByFormat: Record<HoursFormat, number>
    statusesFixed: number
    billed: number
    dateRange: [string, string] | null
    duplicateEmployeeNumbers: string[]
    invoicesWithoutClient: string[]
    /** People on invoice lines who aren't in the employee list (former staff) — their lines keep the name */
    formerStaff: string[]
  }
}

const pick = (row: Raw, keys: string[]) => Object.fromEntries(keys.filter(k => k in row && row[k] !== undefined).map(k => [k, row[k]]))

const EMPLOYEE_KEYS = ['name', 'employeeNumber', 'email', 'phone', 'payRate', 'defaultShiftStart', 'defaultShiftEnd', 'premiumEnabled',
  'premiumStartTime', 'premiumPercent', 'role', 'employmentType', 'location', 'timezone', 'startYear', 'status', 'notes', 'photoUrl', 'createdAt']
const CLIENT_KEYS = ['name', 'company', 'email', 'phone', 'address', 'timezone', 'defaultRate', 'paymentTerms', 'tags', 'notes', 'status',
  'contractEnd', 'photoUrl', 'links', 'contracts', 'createdAt']
const PROJECT_KEYS = ['name', 'rate', 'budget', 'nextInvoiceSeq', 'status', 'billingModel', 'startDate', 'endDate', 'description', 'projectNeeds',
  'notes', 'tags', 'links', 'contracts', 'createdAt']
const INVOICE_KEYS = ['number', 'date', 'dueDate', 'clientName', 'clientEmail', 'clientAddress', 'billingStart', 'billingEnd', 'projectName',
  'subtotal', 'amountPaid', 'notes', 'statusHistory', 'tags', 'createdAt', 'updatedAt']
const CANDIDATE_KEYS = ['name', 'email', 'phone', 'role', 'source', 'stage', 'notes', 'resumeUrl', 'linkedinUrl', 'appliedAt', 'updatedAt', 'createdAt']

/** Turn an old-CRM backup into YVA OS records (camelCase; services/oldCrmImport.ts writes them) */
export async function convertOldCrmBackup(b: OldCrmBackup, ownStorageHost = ''): Promise<ConvertedBackup> {
  const ids = new Map<string, string>()
  const idOf = async (v: unknown): Promise<string | null> => {
    const s = str(v).trim()
    if (!s) return null
    if (!ids.has(s)) ids.set(s, await stableUuid(s))
    return ids.get(s)!
  }

  const employees: Raw[] = []
  const numbers = new Map<string, number>()
  for (const e of b.employees || []) {
    const row: Raw = { ...pick(e, EMPLOYEE_KEYS), id: await idOf(e.id) }
    if (row.startYear == null && e.hireYear != null && e.hireYear !== '') row.startYear = String(e.hireYear)
    row.attachments = Array.isArray(e.attachments) ? e.attachments : []
    employees.push(row)
    const n = str(e.employeeNumber); if (n) numbers.set(n, (numbers.get(n) || 0) + 1)
  }

  const clients: Raw[] = []
  const clientByName = new Map<string, string>()
  for (const c of b.clients || []) {
    const id = await idOf(c.id)
    clients.push({ ...pick(c, CLIENT_KEYS), id })
    if (id && str(c.name).trim()) clientByName.set(str(c.name).trim().toLowerCase(), id)
  }

  const projects: Raw[] = []
  for (const p of b.projects || []) {
    const employeeIds = (Array.isArray(p.employeeIds) ? p.employeeIds : []).map(String)
    const row: Raw = {
      ...pick(p, PROJECT_KEYS),
      id: await idOf(p.id),
      clientId: await idOf(p.clientId),
      employeeIds: await Promise.all(employeeIds.map(idOf)),
    }
    if (typeof row.billingModel === 'string') row.billingModel = row.billingModel.toLowerCase()
    if (Array.isArray(p.assignments)) {
      row.assignments = await Promise.all((p.assignments as Raw[]).map(async a => ({ ...a, employeeId: await idOf(a.employeeId) })))
    }
    projects.push(row)
  }

  const invoices: Raw[] = []
  const byFormat: Record<HoursFormat, number> = { hm: 0, decimal: 0, whole: 0 }
  let statusesFixed = 0, billed = 0
  const dates: string[] = []
  const noClient: string[] = []
  for (const inv of b.invoices || []) {
    const fmt = invoiceHoursFormat(inv); byFormat[fmt]++
    const read = fmt === 'hm' ? hmToHours : decHours
    const items = await Promise.all(((Array.isArray(inv.items) ? inv.items : []) as Raw[]).map(async it => {
      if (it.kind === 'item') return { ...it }
      const daily: Record<string, string> = {}
      for (const [d, v] of Object.entries((it.daily as Raw) || {})) { const h = read(v); if (h > 0) daily[d] = toHM(h) }
      const out: Raw = { ...it, hoursTotal: round(read(it.hoursTotal)), daily }
      if (Object.keys(daily).length === 0) delete out.daily
      const emp = await idOf(it.employeeId); if (emp) out.employeeId = emp; else delete out.employeeId
      const proj = await idOf(it.projectId); if (proj) out.projectId = proj; else delete out.projectId
      if (it.billAmount != null) out.billAmount = round(num(it.billAmount), 4)
      return out
    }))
    const status = str(inv.status).trim()
    const lower = status.toLowerCase() || 'draft'
    if (status && status !== lower) statusesFixed++
    const payments = inv.employeePayments && typeof inv.employeePayments === 'object'
      ? Object.fromEntries(await Promise.all(Object.entries(inv.employeePayments as Raw).map(async ([k, v]) => [await idOf(k) ?? k, v])))
      : undefined
    const clientId = clientByName.get(str(inv.clientName).trim().toLowerCase()) ?? null
    if (!clientId) noClient.push(str(inv.number))
    invoices.push({
      ...pick(inv, INVOICE_KEYS),
      id: await idOf(inv.id),
      status: lower,
      projectId: await idOf(inv.projectId),
      clientId,
      items,
      ...(payments ? { employeePayments: payments } : {}),
    })
    billed += num(inv.subtotal)
    if (inv.date) dates.push(str(inv.date))
  }

  const knownEmployees = new Set(employees.map(e => e.id))
  const formerStaff = [...new Set(invoices.flatMap(i => (i.items as Raw[]).filter(it => it.employeeId && !knownEmployees.has(it.employeeId)).map(it => str(it.employeeName))))].filter(Boolean).sort()

  const candidates: Raw[] = []
  const files: FileJob[] = []
  for (const c of b.candidates || []) {
    const id = (await idOf(c.id))!
    const atts = (Array.isArray(c.attachments) ? c.attachments : []) as Attachment[]
    atts.forEach((a, index) => {
      const inline = str(a.dataUrl).startsWith('data:')
      const external = !!a.storageUrl && !(ownStorageHost && str(a.storageUrl).includes(ownStorageHost))
      if (inline || external) files.push({ table: 'candidates', recordId: id, index, name: a.name || 'file', size: num(a.size), kind: inline ? 'inline' : 'copy' })
    })
    candidates.push({ ...pick(c, CANDIDATE_KEYS), id, attachments: atts.map(a => ({ ...a, dataUrl: a.storageUrl ? '' : a.dataUrl })) })
  }

  // Next employee number for this year: highest YVA<yy><nnn> + 1
  const yy = String(new Date().getFullYear()).slice(2)
  const seqs = [...numbers.keys()].map(n => new RegExp(`^YVA${yy}(\\d{3,})$`).exec(n)).filter(Boolean).map(m => Number(m![1]))
  return {
    employees, clients, projects, invoices, candidates, files,
    employeeCounter: seqs.length ? Math.max(...seqs) + 1 : null,
    invoiceCounter: typeof b.invoiceCounter === 'number' ? b.invoiceCounter : null,
    summary: {
      invoicesByFormat: byFormat, statusesFixed, billed: round(billed, 2),
      dateRange: dates.length ? [dates.reduce((a, c) => (c < a ? c : a)), dates.reduce((a, c) => (c > a ? c : a))] : null,
      duplicateEmployeeNumbers: [...numbers.entries()].filter(([, n]) => n > 1).map(([k]) => k),
      invoicesWithoutClient: noClient,
      formerStaff,
    },
  }
}
