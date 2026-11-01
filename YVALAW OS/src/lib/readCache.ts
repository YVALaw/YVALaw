// Shared reads: when several parts of one screen load the same table at the same moment (the page, the
// dock's status lines, search, a side panel…), they share one request instead of each fetching it.
// A result is reused for a few seconds only, and ANY write — a Supabase insert/update/delete/RPC or a
// POST to a Netlify function — clears everything, so nobody ever sees data older than their own save.
// A read that started before a write is not kept for later callers (epoch check).

const FRESH_MS = 4000
let epoch = 0
const entries = new Map<string, { at: number; epoch: number; p: Promise<unknown> }>()

/** Run `loader` once for every caller asking for `key` within a few seconds; arrays come back as copies */
export function cachedRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = entries.get(key)
  if (hit && hit.epoch === epoch && Date.now() - hit.at < FRESH_MS) return hit.p.then(copy) as Promise<T>
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

/** fetch for the Supabase client: writes clear the shared reads */
export const writeAwareFetch: typeof fetch = (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : undefined)
  if (isWrite(method)) clearReadCache()
  return fetch(input, init)
}

/** Netlify functions (week close, payroll, payments…) change data server-side: clear on any POST to them */
export function watchFunctionWrites() {
  if (typeof window === 'undefined' || (window as unknown as { __yvaFetchWatched?: boolean }).__yvaFetchWatched) return
  ;(window as unknown as { __yvaFetchWatched?: boolean }).__yvaFetchWatched = true
  const orig = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : undefined)
    if (url.includes('/.netlify/functions/') && isWrite(method)) clearReadCache()
    return orig(input, init)
  }
}
