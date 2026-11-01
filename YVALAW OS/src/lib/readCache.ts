// Shared reads: when several parts of the app load the same table (the page, the dock's status lines,
// search, a side panel, the next page you open…), they share one request instead of each fetching it.
// Main lists are reused for a minute (LIST_MS), everything else for a few seconds, and ANY write — a Supabase insert/update/delete/RPC or a
// POST to a Netlify function — clears everything, so nobody ever sees data older than their own save.
// A read that started before a write is not kept for later callers (epoch check).

/** Default: callers on the same screen share one request */
export const SHARE_MS = 4000
/** Main lists (employees, clients, projects, invoices…): kept a minute, so moving between pages is instant.
 *  Own writes clear them at once; other people's changes show within a minute or on reload. */
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

/** Forget every shared read (called on every write) */
export function clearReadCache() {
  epoch++
  entries.clear()
}

const copy = <T,>(v: T): T => (Array.isArray(v) ? (v.slice() as unknown as T) : v)

const isWrite = (method?: string) => { const m = (method || 'GET').toUpperCase(); return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' }

/** Database functions that only read (they're called with POST, like writes). Every other function call clears. */
const READ_ONLY_RPC = new Set(['placement_bill_rates', 'portal_chat_config', 'portal_invoices'])
const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

/** fetch for the Supabase client: writes clear the shared reads */
export const writeAwareFetch: typeof fetch = (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : undefined)
  if (isWrite(method)) {
    const rpc = /\/rest\/v1\/rpc\/([a-z_0-9]+)/.exec(urlOf(input))?.[1]
    if (!rpc || !READ_ONLY_RPC.has(rpc)) clearReadCache()
  }
  return fetch(input, init)
}

/** Netlify functions (week close, payroll, payments…) change data server-side: clear on any POST to them */
export function watchFunctionWrites() {
  if (typeof window === 'undefined' || (window as unknown as { __yvaFetchWatched?: boolean }).__yvaFetchWatched) return
  ;(window as unknown as { __yvaFetchWatched?: boolean }).__yvaFetchWatched = true
  const orig = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    const method = init?.method ?? (input instanceof Request ? input.method : undefined)
    if (url.includes('/.netlify/functions/') && isWrite(method)) clearReadCache()
    return orig(input, init)
  }
}
