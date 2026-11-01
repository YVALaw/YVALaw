import { lazy, type ComponentType } from 'react'

// Screens load on demand (React.lazy). Every loader is remembered so preloadPages() can fetch the rest in
// the background once the first screen is up — after that, opening any page needs no download.
const loaders: Array<() => Promise<unknown>> = []

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  loaders.push(load)
  return lazy(load)
}

let started = false
/** Fetch every screen's code while the browser is idle (one at a time, never blocking the current page) */
export function preloadPages() {
  if (started || typeof window === 'undefined') return
  started = true
  const idle = (fn: () => void) => {
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }
    if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 })
    else setTimeout(fn, 1200)
  }
  let i = 0
  const next = () => { if (i >= loaders.length) return; const load = loaders[i++]; void load().catch(() => {}).finally(() => idle(next)) }
  setTimeout(() => idle(next), 1500)
}
