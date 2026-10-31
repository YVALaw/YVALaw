// Safe saving: work out the smallest set of writes that turns what this browser last loaded
// ("baseline") into what the page wants to save.
//
// Pages still hand over a whole list (saveInvoices(list) etc.), but instead of
// "upsert every row and delete every row that isn't in my list" (which deleted records other
// people — or the Sunday job — had created after the page loaded, and overwrote their edits),
// we now only:
//   • insert rows this browser has never seen (new records),
//   • update the columns that actually changed, per record (so two people editing different
//     fields of the same invoice both keep their change, and a payment recorded by Stripe isn't
//     undone by someone fixing a typo in the notes),
//   • delete rows this browser loaded and the page removed (never rows it didn't know about).
// Pure logic, no Supabase — unit-tested in tests/syncPlan.test.ts.

export type Row = Record<string, unknown> & { id: string }

/** camelCase TS object → snake_case DB row (top-level keys only) */
export function toSnakeRow(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.replace(/([A-Z])/g, c => `_${c.toLowerCase()}`), v]))
}

/** The row as it would be written: snake_case, no created_at, "" and undefined → null */
export function normalizeRow(obj: Record<string, unknown>): Row {
  const row = toSnakeRow(obj)
  delete row['created_at']                       // managed by the database
  for (const k of Object.keys(row)) if (row[k] === '' || row[k] === undefined) row[k] = null
  return row as Row
}

/** JSON with sorted object keys, so {a,b} and {b,a} compare equal */
export function stable(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}

export type SyncPlan = {
  /** New rows (null columns left out so database defaults apply), grouped by identical column sets */
  inserts: Row[][]
  /** Changed columns only; records with the same change are grouped: one UPDATE … WHERE id IN (…) */
  updates: { patch: Record<string, unknown>; ids: string[] }[]
  deletes: string[]
}

/**
 * @param baseline  rows this browser loaded (id → normalized row); `null` = never loaded this table
 * @param rows      normalized rows the page wants to save
 * @param scope     only baseline rows matching this may be deleted (e.g. general expenses only)
 * @param deletable only these ids may be deleted — the rows the page's list was built from (see LoadTracker)
 */
export function planSync(baseline: Map<string, Row> | null, rows: Row[], scope?: (row: Row) => boolean, deletable?: Set<string>): SyncPlan {
  const insertRows: Row[] = []
  const updates = new Map<string, { patch: Record<string, unknown>; ids: string[] }>()
  const wanted = new Set<string>()

  for (const row of rows) {
    if (!row.id || wanted.has(row.id)) continue        // duplicates in a list: first one wins
    wanted.add(row.id)
    const prev = baseline?.get(row.id)
    if (!prev) {
      insertRows.push(Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as Row)
      continue
    }
    const patch: Record<string, unknown> = {}
    for (const k of Object.keys(row)) {
      if (k === 'id') continue
      if (stable(row[k]) !== stable(prev[k] ?? null)) patch[k] = row[k]
    }
    if (Object.keys(patch).length === 0) continue
    const key = stable(patch)
    const g = updates.get(key)
    if (g) g.ids.push(row.id)
    else updates.set(key, { patch, ids: [row.id] })
  }

  const deletes = baseline
    ? [...baseline.entries()].filter(([id, prev]) => !wanted.has(id) && (!deletable || deletable.has(id)) && (!scope || scope(prev))).map(([id]) => id)
    : []

  const groups = new Map<string, Row[]>()
  for (const r of insertRows) {
    const sig = Object.keys(r).sort().join(',')
    groups.set(sig, [...(groups.get(sig) ?? []), r])
  }
  return { inserts: [...groups.values()], updates: [...updates.values()], deletes }
}

/** The baseline after the plan was written successfully */
export function applyPlan(baseline: Map<string, Row>, plan: SyncPlan, rows: Row[]): void {
  for (const id of plan.deletes) baseline.delete(id)
  const byId = new Map(rows.map(r => [r.id, r]))
  for (const group of plan.inserts) for (const r of group) baseline.set(r.id, byId.get(r.id) ?? r)
  for (const u of plan.updates) for (const id of u.ids) {
    const prev = baseline.get(id)
    if (prev) baseline.set(id, { ...prev, ...u.patch })
  }
}

/**
 * Which rows may a save delete? Only rows the page actually had.
 *
 * Each load (and each save) is a "generation" with the ids it contained. Loaded row objects are
 * tagged with their generation; pages build the list they save with filter/map/spread, which keeps
 * the untouched row objects, so the tags in a saved list tell which load it came from. A row
 * created by someone else after that load (e.g. invoices made by the Sunday job while the Invoices
 * page stayed open, then picked up by another part of the app) is in a newer generation only,
 * so it is never treated as "removed by this page".
 */
export class LoadTracker {
  // Each generation keeps the rows exactly as they were loaded/saved (normalized), so a save
  // compares the page's rows with the version THAT page had — not a newer copy another screen loaded.
  private gens = new Map<number, { table: string; rows: Map<string, Row> }>()
  private next = 0
  private tags = new WeakMap<object, number>()

  /** Record a load or a successful save of `items` (row objects as the page holds them) */
  record(table: string, items: readonly object[]): void {
    const gen = this.next++
    const rows = new Map<string, Row>()
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = normalizeRow(it as Record<string, unknown>)
      if (row.id) rows.set(row.id, row)
      this.tags.set(it, gen)
    }
    this.gens.set(gen, { table, rows })
    if (this.gens.size > 120) this.gens.delete(this.gens.keys().next().value as number)   // keep memory bounded
  }

  /** The generation the page's list came from (see class comment), or null if the table was never loaded */
  private choose(table: string, items: readonly object[]) {
    let newest = -1
    for (const it of items) {
      const g = it && typeof it === 'object' ? this.tags.get(it) : undefined
      if (g !== undefined && g > newest && this.gens.get(g)?.table === table) newest = g
    }
    if (newest >= 0) return this.gens.get(newest)!
    const mine = [...this.gens.values()].filter(g => g.table === table)
    if (mine.length === 0) return null
    const known = items.map(i => (i as { id?: string }).id).filter((id): id is string => !!id && mine.some(g => g.rows.has(id)))
    // An empty (or all-new) list: only the latest load/save of this table tells what the page had
    if (known.length === 0) return mine[mine.length - 1]
    // Every row was rebuilt: the oldest generation holding all of them — the least that could be stale
    return mine.find(g => known.every(id => g.rows.has(id))) ?? { table, rows: new Map<string, Row>() }
  }

  /** Ids this save may delete, or null when the table was never loaded here */
  deletable(table: string, items: readonly object[]): Set<string> | null {
    const g = this.choose(table, items)
    return g ? new Set(g.rows.keys()) : null
  }

  /** What the page started from: its generation's rows, falling back to `fallback` for ids it doesn't have */
  baseline(table: string, items: readonly object[], fallback: Map<string, Row> | null): Map<string, Row> | null {
    const g = this.choose(table, items)
    if (!g && !fallback) return null
    const out = new Map(fallback ?? [])
    if (g) for (const [id, row] of g.rows) out.set(id, row)
    return out
  }
}
