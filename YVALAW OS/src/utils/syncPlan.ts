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

/** Load tag carried by row objects. An enumerable Symbol survives `{ ...row, field }` (object
 *  spread copies symbol keys) but is ignored by Object.entries / JSON, so it never reaches the database. */
const GEN: unique symbol = Symbol('yvaLoadGen')
const KEEP_PER_TABLE = 30

/**
 * What a save compares against, per row.
 *
 * Each load (and each save) is a "generation" holding the rows exactly as they were loaded/saved.
 * Row objects are tagged with their generation, and the tag survives `{ ...row, notes }`, so an
 * edited row is compared with the copy IT was made from — not a newer copy another screen loaded
 * (that would write back everyone else's changes, e.g. undo a payment) and not an older one.
 * Changes this browser itself saved after that copy are layered on top, so changing a field back
 * to its original value is still saved. Rows rebuilt from scratch (no tag) use the oldest copy
 * this browser still remembers, plus its own later saves.
 *
 * Deleting: a save only deletes rows that were in the load the page's list came from, so rows
 * created elsewhere later (the Monday job, another person) are never treated as "removed".
 */
export class LoadTracker {
  private gens = new Map<number, { table: string; rows: Map<string, Row> }>()
  private next = 0
  private tags = new WeakMap<object, number>()          // fallback when an object can't take the symbol (frozen)
  private writes = new Map<string, { gen: number; id: string; patch: Record<string, unknown> }[]>()

  /** Record a load (or the list of a successful save) */
  record(table: string, items: readonly object[]): number {
    const gen = this.next++
    const rows = new Map<string, Row>()
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = normalizeRow(it as Record<string, unknown>)
      if (row.id) rows.set(row.id, row)
      this.tags.set(it, gen)
      try { (it as Record<symbol, unknown>)[GEN] = gen } catch { /* frozen: WeakMap tag only */ }
    }
    this.gens.set(gen, { table, rows })
    const mine = [...this.gens.entries()].filter(([, g]) => g.table === table)
    if (mine.length > KEEP_PER_TABLE) {
      for (const [n] of mine.slice(0, mine.length - KEEP_PER_TABLE)) this.gens.delete(n)
      const oldest = mine[mine.length - KEEP_PER_TABLE][0]
      this.writes.set(table, (this.writes.get(table) ?? []).filter(w => w.gen >= oldest))
    }
    return gen
  }

  /** Record a successful save: its list (new generation) and exactly what it wrote */
  recordSave(table: string, items: readonly object[], plan: SyncPlan): void {
    const gen = this.record(table, items)
    const log = this.writes.get(table) ?? []
    for (const group of plan.inserts) for (const r of group) log.push({ gen, id: r.id, patch: r })
    for (const u of plan.updates) for (const id of u.ids) log.push({ gen, id, patch: u.patch })
    this.writes.set(table, log)
  }

  private tagOf(it: unknown): number | undefined {
    if (!it || typeof it !== 'object') return undefined
    const s = (it as Record<symbol, unknown>)[GEN]
    return typeof s === 'number' ? s : this.tags.get(it)
  }

  private mine(table: string) {
    return [...this.gens.entries()].filter(([, g]) => g.table === table)
  }

  /** Ids this save may delete, or null when the table was never loaded here */
  deletable(table: string, items: readonly object[]): Set<string> | null {
    const mine = this.mine(table)
    if (mine.length === 0) return null
    let newest = -1
    for (const it of items) {
      const g = this.tagOf(it)
      if (g !== undefined && g > newest && this.gens.get(g)?.table === table) newest = g
    }
    if (newest >= 0) return new Set(this.gens.get(newest)!.rows.keys())
    const known = items.map(i => (i as { id?: string }).id).filter((id): id is string => !!id && mine.some(([, g]) => g.rows.has(id)))
    if (known.length > 0) {
      // Every row rebuilt: the oldest generation holding all of them — the least that could be stale
      const g = mine.find(([, g]) => known.every(id => g.rows.has(id)))
      return g ? new Set(g[1].rows.keys()) : new Set()
    }
    // An empty (or all-new) list: only rows every remembered load/save had (a row another screen
    // picked up later is not one this page could have removed)
    const [first, ...rest] = mine
    return new Set([...first[1].rows.keys()].filter(id => rest.every(([, g]) => g.rows.has(id))))
  }

  /** Per row: the copy the page's row was made from (+ this browser's later saves); `fallback` for unknown ids */
  baseline(table: string, items: readonly object[], fallback: Map<string, Row> | null): Map<string, Row> | null {
    const mine = this.mine(table)
    if (mine.length === 0 && !fallback) return null
    const out = new Map(fallback ?? [])
    const log = this.writes.get(table) ?? []
    for (const it of items) {
      const id = (it as { id?: string })?.id
      if (!id) continue
      let from = -1
      let row: Row | undefined
      const g = this.tagOf(it)
      const tagged = g !== undefined ? this.gens.get(g) : undefined
      if (tagged && tagged.table === table && tagged.rows.has(id)) { from = g!; row = tagged.rows.get(id) }
      else {
        const oldest = mine.find(([, gg]) => gg.rows.has(id))
        if (oldest) { from = oldest[0]; row = oldest[1].rows.get(id) }
      }
      if (!row) continue
      let merged: Row = row
      for (const w of log) if (w.id === id && w.gen > from) merged = { ...merged, ...w.patch } as Row
      out.set(id, merged)
    }
    return out
  }
}
