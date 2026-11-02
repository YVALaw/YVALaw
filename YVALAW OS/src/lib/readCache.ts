// How YVA OS keeps data in memory (2026-11). Read this before touching loaders.
//
// Two layers:
//  1. Every database read goes through `writeAwareFetch` (the Supabase client's fetch). A successful read is kept in
//     memory and identical reads share it — this covers every page and every future loader automatically.
//     "Live" reads are never kept: notifications, counters, the change stamps themselves, and anything asking for
//     "since <a moment in the last day>" (who's tracking now, today's live board, computers seen recently).
//  2. `cachedRead(key, loader)` shares the parsed result of a loader for a few seconds.
//
// How long is a read kept? — CHANGE STAMPS (supabase/migrate-live-updates.sql)
//  Each watched table has a "last changed" number in public.data_versions, bumped by a trigger on every save by
//  anyone. Supabase Realtime pushes the new numbers to open windows (services/liveUpdates.ts). A read of watched
//  tables is kept until one of its tables' numbers moves (safety net: 30 min), so nothing is re-read while nobody
//  saves. Tables without a stamp (and every table before the stamps are known / when the SQL hasn't run) are kept
//  LIST_MS (1 min). There is no timed background refresh: database work only happens when data actually changes.
//  When the live connection is down, opening a page or coming back to the window does one tiny "what changed?" read.
//
// Writes: any insert/update/delete/RPC through the Supabase client (except read-only RPCs) and any POST to a Netlify
// function clears everything — before it is sent and again when it finishes — so your own saves show at once.

/** Callers on the same screen share one request */
export const SHARE_MS = 4000
/** Reads of tables without a change stamp are kept this long */
export const LIST_MS = 60_000
/** Reads of stamped tables are kept until they change, re-checked at least this often anyway */
const STAMPED_MAX_MS = 30 * 60_000

let epoch = 0
type Entry = { at: number; epoch: number; p: Promise<unknown>; tables: Set<string> }
const entries = new Map<string, Entry>()
/** Tables read by loaders still running (a read made while several run is credited to all of them — harmless) */
const running = new Set<Set<string>>()

/** Run `loader` once for every caller asking for `key` within `freshMs`; arrays come back as copies */
export function cachedRead<T>(key: string, loader: () => Promise<T>, freshMs = SHARE_MS): Promise<T> {
  const hit = entries.get(key)
  if (hit && hit.epoch === epoch && Date.now() - hit.at < freshMs) {
    // the page on screen shows these tables too, even though it didn't read them itself
    return hit.p.then(v => { for (const t of hit.tables) pageTables.add(t); return copy(v) }) as Promise<T>
  }
  const mine = epoch
  const tables = new Set<string>()
  running.add(tables)
  const p = loader()
  entries.set(key, { at: Date.now(), epoch: mine, p, tables })
  p.then(() => running.delete(tables), () => { running.delete(tables); if (entries.get(key)?.p === p) entries.delete(key) })
  return p.then(copy)
}

/** Forget every kept read (called on every write and on sign-out) */
export function clearReadCache() {
  epoch++
  entries.clear()
  responses.clear()
  inflight.clear()
}

const copy = <T,>(v: T): T => (Array.isArray(v) ? (v.slice() as unknown as T) : v)

// ── Layer 1: kept database responses ──────────────────────────────────────────────────────────────────────────

type Kept = { at: number; epoch: number; deps: string[]; stamped: boolean; status: number; statusText: string; headers: [string, string][]; body: string | null }
const responses = new Map<string, Kept>()
const inflight = new Map<string, Promise<Kept | null>>()
const MAX_KEPT = 400

const isWrite = (method?: string) => { const m = (method || 'GET').toUpperCase(); return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' }
/** Database functions that only read (they're called with POST, like writes). Every other function call clears. */
const READ_ONLY_RPC = new Set(['placement_bill_rates', 'portal_chat_config', 'portal_invoices', 'log_action'])   // log_action only writes history
/** Tables whose reads must always be live */
const NEVER_KEEP = new Set(['notifications', 'counters', 'desktop_link_codes', 'push_subscriptions', 'data_versions'])
const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
const methodOf = (input: RequestInfo | URL, init?: RequestInit) => (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

/** A read that asks for "since <a moment in the last ~day>" is live (tracking now, today's board, seen recently) */
function asksForRecentMoment(search: string): boolean {
  let s = search
  try { s = decodeURIComponent(search) } catch { /* keep raw */ }
  const cutoff = Date.now() - 25 * 3600_000
  for (const m of s.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g)) {
    const t = Date.parse(m[0])
    if (Number.isFinite(t) && t > cutoff) return true
  }
  return false
}

function keepable(url: URL, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  if (!url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/rest/v1/rpc/')) return false
  if (NEVER_KEEP.has(url.pathname.slice(9))) return false
  return !asksForRecentMoment(url.search)
}

/** The tables a read depends on: the table itself + any embedded ones (select=*,clients(name)) */
export function depsOf(url: URL): string[] {
  const deps = [url.pathname.slice(9)]
  const sel = url.searchParams.get('select') || ''
  for (const m of sel.matchAll(/([a-z_][a-z0-9_]*)(?:![a-z0-9_]+)?\s*\(/gi)) deps.push(m[1].toLowerCase())
  return [...new Set(deps)]
}

function keyOf(url: string, method: string, init?: RequestInit, input?: RequestInfo | URL): string {
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  return [method, url, h.get('authorization'), h.get('accept'), h.get('prefer'), h.get('range'), h.get('accept-profile')].join('\n')
}

const rebuild = (k: Kept, method: string) => new Response(method === 'HEAD' ? null : k.body, { status: k.status, statusText: k.statusText, headers: k.headers })

function fresh(k: Kept): boolean {
  if (k.epoch !== epoch) return false
  const age = Date.now() - k.at
  return k.stamped ? age < STAMPED_MAX_MS : age < LIST_MS
}

async function readAndKeep(key: string, method: string, deps: string[], init: RequestInit | undefined, input: RequestInfo | URL): Promise<Kept | null> {
  const mine = epoch
  const before = deps.map(d => versions.get(d))
  // Kept until it changes only if every table it reads had a known number when the read started
  const stamped = stampsKnown && before.every(v => v !== undefined)
  const res = await fetch(input, init)
  if (!res.ok) return null
  const kept: Kept = { at: Date.now(), epoch: mine, deps, stamped, status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: method === 'HEAD' ? null : await res.text() }
  // Keep it only if nothing it depends on changed while it was being read (a save, or a teammate's change)
  if (mine === epoch && deps.every((d, i) => versions.get(d) === before[i])) {
    responses.set(key, kept)
    if (responses.size > MAX_KEPT) { const oldest = [...responses.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) responses.delete(oldest[0]) }
  }
  return kept
}

/** fetch for the Supabase client: keeps reads until they change, shares identical reads, clears everything on writes */
export const writeAwareFetch: typeof fetch = async (input, init) => {
  const raw = urlOf(input)
  const method = methodOf(input, init)
  let url: URL | null = null
  try { url = new URL(raw) } catch { /* not a URL we know */ }

  if (isWrite(method)) {
    const rpc = url ? /^\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(url.pathname)?.[1] : undefined
    const dataWrite = !!url && url.pathname.startsWith('/rest/v1/') && !(rpc && READ_ONLY_RPC.has(rpc))
    if (!dataWrite) return fetch(input, init)
    markOwnWrite()
    clearReadCache()
    try { return await fetch(input, init) } finally { clearReadCache() }
  }

  if (url && url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/')) for (const d of depsOf(url)) { pageTables.add(d); for (const r of running) r.add(d) }
  if (!url || !keepable(url, method) || init?.signal?.aborted) return fetch(input, init)
  const key = keyOf(raw, method, init, input)
  const hit = responses.get(key)
  if (hit && fresh(hit)) return rebuild(hit, method)
  let p = inflight.get(key)
  if (!p) {
    const mine: Promise<Kept | null> = readAndKeep(key, method, depsOf(url), init, input).finally(() => { if (inflight.get(key) === mine) inflight.delete(key) })
    inflight.set(key, mine)
    p = mine
  }
  // A failed or refused read is answered by a normal request, so the caller sees the real error
  const kept = await p.catch(() => null)
  return kept ? rebuild(kept, method) : fetch(input, init)
}

/** Netlify functions (week close, payroll, payments…) change data server-side: clear on any POST to them */
export function watchFunctionWrites() {
  if (typeof window === 'undefined' || (window as unknown as { __yvaFetchWatched?: boolean }).__yvaFetchWatched) return
  ;(window as unknown as { __yvaFetchWatched?: boolean }).__yvaFetchWatched = true
  const orig = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!(urlOf(input).includes('/.netlify/functions/') && isWrite(methodOf(input, init)))) return orig(input, init)
    markOwnWrite()
    clearReadCache()
    try { return await orig(input, init) } finally { clearReadCache() }
  }
}

// ── Change stamps ─────────────────────────────────────────────────────────────────────────────────────────────

export type VersionRow = { table_name: string; version: number | string }
const versions = new Map<string, number>()
let stampsKnown = false
let liveConnected = false
let lastCheck = 0
let versionSource: (() => Promise<VersionRow[] | null>) | null = null
/** Until when changes are assumed to be this window's own save (a save can touch several tables through triggers) */
let ownWriteUntil = 0
const OWN_WRITE_MS = 8000
/** Tables the page on screen has read (reset when the page changes) */
const pageTables = new Set<string>()
const changeListeners = new Set<(tables: string[]) => void>()

function markOwnWrite() { ownWriteUntil = Date.now() + OWN_WRITE_MS }

/** New change numbers (from Realtime or a check). Drops kept reads of tables that changed; tells the page when a
 *  teammate changed something it shows. Returns the tables that changed. */
export function applyVersions(rows: VersionRow[], { complete = false }: { complete?: boolean } = {}): string[] {
  const changed: string[] = []
  for (const r of rows) {
    if (!r?.table_name) continue
    const v = Number(r.version)
    if (!Number.isFinite(v)) continue
    const prev = versions.get(r.table_name)
    if (prev === undefined || v > prev) {
      versions.set(r.table_name, v)
      if (prev !== undefined) changed.push(r.table_name)
    }
  }
  if (complete) stampsKnown = true
  if (changed.length) {
    for (const [k, kept] of responses) if (kept.deps.some(d => changed.includes(d))) responses.delete(k)
    entries.clear()
    const theirs = Date.now() < ownWriteUntil ? [] : changed.filter(t => pageTables.has(t))
    if (theirs.length) for (const fn of changeListeners) { try { fn(theirs) } catch { /* a listener failing never matters */ } }
  }
  return changed
}

/** Where the change numbers come from (services/liveUpdates.ts registers a Supabase read of data_versions) */
export function registerVersionSource(load: () => Promise<VersionRow[] | null>) { versionSource = load }

/** One tiny "what changed?" read (skipped if one ran less than `minGapMs` ago). No source / table missing → stamps
 *  stay unknown and reads fall back to the 1-minute keep. */
export async function checkForChanges(minGapMs = 10_000): Promise<void> {
  if (!versionSource || Date.now() - lastCheck < minGapMs) return
  lastCheck = Date.now()
  const rows = await versionSource().catch(() => null)
  if (rows) applyVersions(rows, { complete: true })
}

export function setLiveConnected(v: boolean) { liveConnected = v }
export const isLiveConnected = () => liveConnected
export const changeStampsActive = () => stampsKnown

/** A new page is on screen: start tracking what it reads; catch up on changes if the live connection is down */
export function pageChanged() {
  pageTables.clear()
  if (!liveConnected) void checkForChanges(10_000)
}

/** Called with the tables a teammate changed that the current page shows */
export function onTeamChange(fn: (tables: string[]) => void): () => void {
  changeListeners.add(fn)
  return () => { changeListeners.delete(fn) }
}

// ── Start-up ──────────────────────────────────────────────────────────────────────────────────────────────────

let warmed = false
/** After sign-in: read the main lists once in the background so the next pages open from memory. They then stay
 *  until they change (no timed refresh). Name kept from the earlier keep-warm design. */
export function startKeepWarm(...warmers: Array<() => unknown>) {
  if (warmed) return
  warmed = true
  for (const w of warmers) { try { void w() } catch { /* ignore */ } }
}

/** Sign-out: forget what was kept and the change numbers */
export function forgetEverything() {
  versions.clear(); stampsKnown = false; ownWriteUntil = 0; pageTables.clear(); lastCheck = 0
  clearReadCache()
}

/** Tests only */
export function __resetForTests() { forgetEverything(); versionSource = null; liveConnected = false; changeListeners.clear() }
