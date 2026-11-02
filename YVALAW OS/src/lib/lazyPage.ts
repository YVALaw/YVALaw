import { lazy, type ComponentType } from 'react'

// Screens load on demand (React.lazy). Every loader is remembered so preloadPages() can fetch the rest in
// the background once the first screen is up — after that, opening any page needs no download.
const loaders: Array<() => Promise<unknown>> = []

/** After a new version goes live, a window that was already open asks for the OLD screen files, which no longer
 *  exist — the import fails and the screen would stay on "Loading…" forever. Then reload once to get the new
 *  version (at most once a minute, so a real outage can't cause a reload loop). */
const RELOAD_KEY = 'yva_reloaded_for_update'
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* storage blocked: still reload once */ }
  window.location.reload()
  return true
}
const isChunkError = (e: unknown) => /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch|MIME type|ChunkLoadError/i.test(String((e as Error)?.message ?? e))

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  loaders.push(load)
  return lazy(() => load().catch(err => {
    if (typeof window !== 'undefined' && isChunkError(err) && reloadForNewVersion()) return new Promise<never>(() => {})   // page is reloading
    throw err
  }))
}

let started = false
/** Fetch every screen's code in the background, 4 at a time, most-used screens first (the order lazyPage was
 *  called in App.tsx, with sign-in/one-off screens moved to the end). Never blocks the current page. */
export function preloadPages() {
  if (started || typeof window === 'undefined') return
  started = true
  const queue = [...loaders.filter(l => !rare.has(l)), ...loaders.filter(l => rare.has(l))]
  const worker = async () => { for (let load = queue.shift(); load; load = queue.shift()) await load().catch(() => {}) }
  window.setTimeout(() => { for (let i = 0; i < 4; i++) void worker() }, 1200)
}

const rare = new Set<() => Promise<unknown>>()
/** A screen hardly anyone opens during a session (sign-up, password, connect app): preloaded last */
export function rarePage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  rare.add(load)
  return lazyPage(load)
}
