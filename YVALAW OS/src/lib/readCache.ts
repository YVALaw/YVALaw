// How YVA OS keeps data in memory so moving between pages is instant (2026-11 speed pass).
//
// Two layers, both cleared by ANY write:
//  1. Every database read goes through `writeAwareFetch` (the Supabase client's fetch). A successful read is kept
//     for a minute and identical reads share it — this covers every page and every future loader automatically.
//     "Live" reads are never kept: notifications, counters, and anything asking for "since <a moment in the last
//     day>" (who's tracking now, today's live board, computers seen recently).
//  2. `cachedRead(key, loader)` keeps the parsed result of a loader (e.g. the employee list) so screens that load
//     the same list share it.
// Writes: any insert/update/delete/RPC through the Supabase client (except the few read-only RPCs) and any POST to
// a Netlify function clears everything — before it is sent and again when it finishes, so a read that raced the
// write can't be kept.
// Keep-warm (`startKeepWarm`, Shell): while the window is open and in front, everything read in the last few
// minutes is re-read in the background about every minute and shortly after each write, so pages open from
// memory with data less than a minute old.

/** Callers on the same screen share one request */
export const SHARE_MS = 4000
/** Lists and pages: kept a minute (own writes clear at once; other people's changes show within a minute) */
export const LIST_MS = 60_000

let epoch = 0
const entries = new Map<string, { at: number; epoch: number; p: Promise<unknown> }>()

/** Run `loader` once for every caller asking for `key` within `freshMs`; arrays come back as copies */
export function cachedRead<T>(key: string, loader: () => Promise<T>, freshMs = SHARE_MS): Promise<T> {
  const hit = entries.get(key)
  if (hit && hit.epoch === epoch && Date.now() - hit.at < freshMs) return hit.p.then(copy) as Promise<T>
  const mine = epoch
  const p = loader()
  entries.set(key, { at: Date.now(), epoch: mine, p })
  p.catch(() => { if (entries.get(key)?.p === p) entries.delete(key) })
  return p.then(copy)
}

/** Forget every kept read (called on every write and on sign-out) */
export function clearReadCache() {
  epoch++
  entries.clear()
  responses.clear()
  inflight.clear()
  scheduleRewarm()
}

const copy = <T,>(v: T): T => (Array.isArray(v) ? (v.slice() as unknown as T) : v)

// ── Layer 1: kept database responses ──────────────────────────────────────────────────────────────────────────

type Kept = { at: number; epoch: number; status: number; statusText: string; headers: [string, string][]; body: string | null }
const responses = new Map<string, Kept>()
const inflight = new Map<string, Promise<Kept | null>>()
/** Reads made recently (for keep-warm): key → how to repeat it */
const recent = new Map<string, { usedAt: number; url: string; init: RequestInit }>()
const MAX_KEPT = 400
const RECENT_MS = 5 * 60_000

const isWrite = (method?: string) => { const m = (method || 'GET').toUpperCase(); return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' }
/** Database functions that only read (they're called with POST, like writes). Every other function call clears. */
const READ_ONLY_RPC = new Set(['placement_bill_rates', 'portal_chat_config', 'portal_invoices', 'log_action'])   // log_action only writes history
/** Tables whose reads must always be live */
const NEVER_KEEP = new Set(['notifications', 'counters', 'desktop_link_codes', 'push_subscriptions'])
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

function keyOf(url: string, method: string, init?: RequestInit, input?: RequestInfo | URL): string {
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  return [method, url, h.get('authorization'), h.get('accept'), h.get('prefer'), h.get('range'), h.get('accept-profile')].join('\n')
}

const rebuild = (k: Kept, method: string) => new Response(method === 'HEAD' ? null : k.body, { status: k.status, statusText: k.statusText, headers: k.headers })

async function readAndKeep(key: string, method: string, init: RequestInit | undefined, input: RequestInfo | URL): Promise<Kept | null> {
  const mine = epoch
  const res = await fetch(input, init)
  if (!res.ok) return null
  const kept: Kept = { at: Date.now(), epoch: mine, status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], body: method === 'HEAD' ? null : await res.text() }
  if (mine === epoch) {
    responses.set(key, kept)
    if (responses.size > MAX_KEPT) { const oldest = [...responses.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) responses.delete(oldest[0]) }
  }
  return kept
}

/** fetch for the Supabase client: keeps reads a minute, shares identical reads, and clears everything on writes */
export const writeAwareFetch: typeof fetch = async (input, init) => {
  const raw = urlOf(input)
  const method = methodOf(input, init)
  let url: URL | null = null
  try { url = new URL(raw) } catch { /* not a URL we know */ }

  if (isWrite(method)) {
    const rpc = url ? /^\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(url.pathname)?.[1] : undefined
    const dataWrite = !!url && url.pathname.startsWith('/rest/v1/') && !(rpc && READ_ONLY_RPC.has(rpc))
    if (!dataWrite) return fetch(input, init)
    clearReadCache()
    try { return await fetch(input, init) } finally { clearReadCache() }
  }

  if (!url || !keepable(url, method) || init?.signal?.aborted) return fetch(input, init)
  const key = keyOf(raw, method, init, input)
  recent.set(key, { usedAt: Date.now(), url: raw, init: { method, headers: init?.headers } })
  const hit = responses.get(key)
  if (hit && hit.epoch === epoch && Date.now() - hit.at < LIST_MS) return rebuild(hit, method)
  let p = inflight.get(key)
  if (!p) {
    const mine: Promise<Kept | null> = readAndKeep(key, method, init, input).finally(() => { if (inflight.get(key) === mine) inflight.delete(key) })
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
    clearReadCache()
    try { return await orig(input, init) } finally { clearReadCache() }
  }
}

// ── Keep-warm ─────────────────────────────────────────────────────────────────────────────────────────────────

let warmStarted = false
let lastWarm = 0
let rewarmTimer: ReturnType<typeof setTimeout> | null = null
const extraWarmers: Array<() => unknown> = []

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

/** Re-read everything read in the last few minutes (4 at a time), so the next pages open from memory */
async function warmNow() {
  if (!warmStarted || !visible()) return
  lastWarm = Date.now()
  const now = Date.now()
  for (const [k, r] of recent) if (now - r.usedAt > RECENT_MS) recent.delete(k)
  const todo = [...recent.entries()].filter(([k]) => { const h = responses.get(k); return !h || h.epoch !== epoch || now - h.at > LIST_MS / 2 })
  const worker = async () => {
    for (let job = todo.shift(); job; job = todo.shift()) {
      const [key, r] = job
      if (inflight.has(key)) continue
      const method = (r.init.method || 'GET').toUpperCase()
      const p: Promise<Kept | null> = readAndKeep(key, method, r.init, r.url).catch(() => null)
        .finally(() => { if (inflight.get(key) === p) inflight.delete(key) })
      inflight.set(key, p)
      const kept = await p
      if (!kept) recent.delete(key)   // refused (e.g. the sign-in token changed): the page will ask again itself
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  for (const w of extraWarmers) { try { void w() } catch { /* a warmer failing never matters */ } }
}

function scheduleRewarm() {
  if (!warmStarted) return
  if (rewarmTimer) clearTimeout(rewarmTimer)
  rewarmTimer = setTimeout(() => { rewarmTimer = null; void warmNow() }, 2000)
}

/** Start keeping recently used data fresh in the background (staff app; once per page load).
 *  `warmers` also run on every pass (e.g. load the main lists even before their page was opened). */
export function startKeepWarm(...warmers: Array<() => unknown>) {
  extraWarmers.push(...warmers)
  if (warmStarted || typeof window === 'undefined') return
  warmStarted = true
  window.setInterval(() => { if (visible()) void warmNow() }, LIST_MS - 5000)
  document.addEventListener('visibilitychange', () => { if (visible() && Date.now() - lastWarm > LIST_MS / 2) void warmNow() })
  for (const w of warmers) { try { void w() } catch { /* ignore */ } }
}

/** Sign-out: forget what was kept and what was read */
export function forgetEverything() { recent.clear(); clearReadCache() }
