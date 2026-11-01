// Settings → Data: backup export + restore import (moved unchanged from SettingsPage).
import type { DataSnapshot } from '../../data/types'
import {
  loadCandidates, loadSnapshot,
  saveEmployees, saveClients, saveProjects, saveInvoices, saveCandidates, saveInvoiceCounter,
} from '../../services/storage'
import { supabase } from '../../lib/supabase'

function normalizeImportedEmployee(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row }
  if (next.startYear == null) {
    const legacyYear = next.hireYear ?? next.hire_year
    if (legacyYear != null && legacyYear !== '') {
      next.startYear = legacyYear
    }
  }
  delete next.hireYear
  delete next.hire_year
  return next
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function remapId(value: unknown, map: Map<string, string>): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return map.get(value) || (isUuidLike(value) ? value : null)
}

function createIdMap(items: unknown[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of items) {
    const oldId = (item as { id?: unknown } | undefined)?.id
    if (typeof oldId === 'string' && oldId.trim()) {
      map.set(oldId, crypto.randomUUID())
    }
  }
  return map
}

function pickFields(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]))
}

function normalizeImportedEmployees(items: unknown[], idMap: Map<string, string>): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'userId', 'employeeNumber', 'email', 'phone', 'payRate',
    'defaultShiftStart', 'defaultShiftEnd', 'premiumEnabled', 'premiumStartTime', 'premiumPercent',
    'role', 'employmentType', 'location', 'timezone', 'startYear', 'status', 'notes',
    'photoUrl', 'attachments',
  ]
  return items.map(item => {
    const row = normalizeImportedEmployee(item as Record<string, unknown>)
    const oldId = (item as { id?: unknown } | undefined)?.id
    const id = typeof oldId === 'string' && oldId.trim()
      ? (idMap.get(oldId) || crypto.randomUUID())
      : crypto.randomUUID()
    return { ...pickFields(row, allowed), id }
  })
}

function normalizeImportedClients(items: unknown[], idMap: Map<string, string>): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'company', 'email', 'phone', 'address', 'timezone', 'defaultRate',
    'paymentTerms', 'tags', 'notes', 'status', 'contractEnd', 'photoUrl', 'links', 'contracts',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const id = oldId ? (idMap.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    return { ...pickFields(row, allowed), id }
  })
}

function normalizeImportedProjects(
  items: unknown[],
  maps: { projectIds: Map<string, string>; clientIds: Map<string, string>; employeeIds: Map<string, string> },
): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'rate', 'budget', 'clientId', 'employeeIds', 'nextInvoiceSeq', 'status',
    'billingModel', 'startDate', 'endDate', 'description', 'projectNeeds', 'notes', 'tags',
    'links', 'contracts',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const employeeIds = Array.isArray(row.employeeIds)
      ? row.employeeIds.map(empId => remapId(empId, maps.employeeIds)).filter((v): v is string => !!v)
      : []
    const clientId = remapId(row.clientId, maps.clientIds)
    const id = oldId ? (maps.projectIds.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    return { ...pickFields(row, allowed), id, clientId, employeeIds }
  })
}

function normalizeImportedInvoices(
  items: unknown[],
  maps: { invoiceIds: Map<string, string>; projectIds: Map<string, string>; employeeIds: Map<string, string> },
): Record<string, unknown>[] {
  const allowed = [
    'id', 'number', 'date', 'dueDate', 'clientName', 'clientEmail', 'clientAddress',
    'billingStart', 'billingEnd', 'projectId', 'projectName', 'status', 'subtotal', 'amountPaid',
    'notes', 'items', 'statusHistory', 'employeePayments', 'tags', 'createdAt', 'updatedAt',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const id = oldId ? (maps.invoiceIds.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    const projectId = remapId(row.projectId, maps.projectIds)
    const items = Array.isArray(row.items)
      ? row.items.map(rawItem => {
          const it = rawItem as Record<string, unknown>
          const employeeId = remapId(it.employeeId, maps.employeeIds)
          return employeeId ? { ...it, employeeId } : (() => { const copy = { ...it }; delete copy.employeeId; return copy })()
        })
      : row.items
    const employeePayments = row.employeePayments && typeof row.employeePayments === 'object'
      ? Object.fromEntries(Object.entries(row.employeePayments as Record<string, unknown>).map(([key, value]) => {
          const mappedKey = maps.employeeIds.get(key)
          return [mappedKey || key, value]
        }))
      : row.employeePayments
    return { ...pickFields(row, allowed), id, projectId, items, employeePayments }
  })
}

function normalizeImportedCandidates(items: unknown[], idMap: Map<string, string>): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'email', 'phone', 'role', 'source', 'stage', 'notes', 'resumeUrl',
    'linkedinUrl', 'appliedAt', 'updatedAt', 'attachments',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const id = oldId ? (idMap.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    return { ...pickFields(row, allowed), id }
  })
}

/** Restores a backup file. Resolves with the status line shown under the buttons. */
export function importBackup(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as Partial<DataSnapshot & { candidates: unknown[]; invoiceCounter: number }>
        void (async () => {
          try {
            let count = 0
            const employeeIdMap = Array.isArray(data.employees) ? createIdMap(data.employees) : new Map<string, string>()
            const clientIdMap = Array.isArray(data.clients) ? createIdMap(data.clients) : new Map<string, string>()
            const projectIdMap = Array.isArray(data.projects) ? createIdMap(data.projects) : new Map<string, string>()
            const invoiceIdMap = Array.isArray(data.invoices) ? createIdMap(data.invoices) : new Map<string, string>()
            const candidateIdMap = Array.isArray(data.candidates) ? createIdMap(data.candidates) : new Map<string, string>()

            if (Array.isArray(data.employees)) { await saveEmployees(normalizeImportedEmployees(data.employees, employeeIdMap) as Parameters<typeof saveEmployees>[0]); count++ }
            if (Array.isArray(data.projects))  { await saveProjects(normalizeImportedProjects(data.projects, { projectIds: projectIdMap, clientIds: clientIdMap, employeeIds: employeeIdMap }) as Parameters<typeof saveProjects>[0]);   count++ }
            if (Array.isArray(data.clients))   { await saveClients(normalizeImportedClients(data.clients, clientIdMap) as Parameters<typeof saveClients>[0]);     count++ }
            if (Array.isArray(data.invoices))  { await saveInvoices(normalizeImportedInvoices(data.invoices, { invoiceIds: invoiceIdMap, projectIds: projectIdMap, employeeIds: employeeIdMap }) as Parameters<typeof saveInvoices>[0]);   count++ }
            if (typeof data.invoiceCounter === 'number') { await saveInvoiceCounter(data.invoiceCounter); count++ }
            if (Array.isArray(data.candidates)) { await saveCandidates(normalizeImportedCandidates(data.candidates, candidateIdMap) as Parameters<typeof saveCandidates>[0]); count++ }
            if (count === 0) throw new Error('No supported data sets found in this file.')
            resolve(`Imported ${count} data set${count !== 1 ? 's' : ''} successfully. Reloading…`)
            setTimeout(() => window.location.reload(), 900)
          } catch (error) {
            resolve(`Import failed — ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        })()
      } catch { resolve('Import failed — invalid JSON file.') }
    }
    reader.readAsText(file)
  })
}

/** Downloads a full JSON backup */
export async function exportBackup(): Promise<void> {
  const [snap, candidates, invoiceCounter] = await Promise.all([
    loadSnapshot(), loadCandidates(),
    supabase.from('counters').select('value').eq('key', 'invoice').single().then(r => (r.data?.value as number) ?? 1),
  ])
  const data = {
    employees: snap.employees,
    clients: snap.clients,
    projects: snap.projects,
    invoices: snap.invoices,
    candidates,
    invoiceCounter,
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `yva-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click(); URL.revokeObjectURL(url)
}

/** Danger zone: wipes the core tables. Server-side check: only the CEO may do it. Returns false if refused. */
export async function clearAllData(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data: roleRow } = await supabase.from('user_roles').select('role').eq('user_id', user.id).single()
  if (roleRow?.role !== 'ceo') return false

  const tables = ['employees', 'clients', 'projects', 'invoices', 'tasks', 'expenses', 'activity_log', 'candidates', 'invoice_templates']
  await Promise.all(tables.map(t => supabase.from(t).delete().neq('id', '')))
  await supabase.from('counters').update({ value: 1 }).eq('key', 'invoice')
  await supabase.from('counters').update({ value: 1 }).eq('key', 'employee')
  return true
}
