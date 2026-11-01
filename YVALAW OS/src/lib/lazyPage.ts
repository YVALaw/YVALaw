import { lazy, type ComponentType } from 'react'

// Screens load on demand (React.lazy). Every loader is remembered so preloadPages() can fetch the rest in
// the background once the first screen is up — after that, opening any page needs no download.
const loaders: Array<() => Promise<unknown>> = []

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  loaders.push(load)
  return lazy(load)
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
