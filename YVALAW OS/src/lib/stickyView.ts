import { useEffect, useState } from 'react'

/** A page's view switch (list / by project / board…) that starts on `fallback` and then remembers the person's
 *  last choice on this computer (localStorage `yva_view_<key>`). Unknown stored values fall back. */
export function useStickyView<T extends string>(key: string, fallback: T, allowedValues: readonly T[]): [T, (v: T) => void] {
  const storageKey = `yva_view_${key}`
  const [value, setValue] = useState<T>(() => {
    try { const v = localStorage.getItem(storageKey) as T | null; return v && allowedValues.includes(v) ? v : fallback } catch { return fallback }
  })
  useEffect(() => { try { localStorage.setItem(storageKey, value) } catch { /* private mode: just don't remember */ } }, [storageKey, value])
  return [value, setValue]
}
