// Saved views (REDESIGN.md rule 10): per-user filter sets kept in this browser's localStorage under
// `yva_views_<page>`, as { [userId]: SavedView[] }. No table needed; nothing leaves the browser.
import { useCallback, useEffect, useState } from 'react'

export type SavedView<F> = { id: string; name: string; filters: F }
type Store<F> = Record<string, SavedView<F>[]>

function read<F>(key: string): Store<F> {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

export function useSavedViews<F>(page: string, userId: string | null) {
  const key = `yva_views_${page}`
  const who = userId || 'anonymous'
  const [views, setViews] = useState<SavedView<F>[]>(() => read<F>(key)[who] || [])
  useEffect(() => { setViews(read<F>(key)[who] || []) }, [key, who])

  const write = useCallback((next: SavedView<F>[]) => {
    setViews(next)
    try { const all = read<F>(key); all[who] = next; localStorage.setItem(key, JSON.stringify(all)) } catch { /* private mode: views last until reload */ }
  }, [key, who])

  const save = useCallback((name: string, filters: F) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const existing = views.find(v => v.name.toLowerCase() === trimmed.toLowerCase())
    write(existing ? views.map(v => v.id === existing.id ? { ...v, filters } : v) : [...views, { id: crypto.randomUUID(), name: trimmed, filters }])
  }, [views, write])
  const remove = useCallback((id: string) => write(views.filter(v => v.id !== id)), [views, write])
  return { views, save, remove }
}
