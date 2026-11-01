// Saved views (REDESIGN.md rule 10): per-user filters kept in localStorage `yva_views_<page>`,
// stored as { [userId]: SavedView[] } so two people sharing a browser keep their own lists.
export type SavedView<F> = { id: string; name: string; filters: F }

const key = (page: string) => `yva_views_${page}`
function readAll<F>(page: string): Record<string, SavedView<F>[]> {
  try { const v = JSON.parse(localStorage.getItem(key(page)) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}
export function loadViews<F>(page: string, userId: string | null): SavedView<F>[] {
  const list = readAll<F>(page)[userId || 'anon']
  return Array.isArray(list) ? list.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string') : []
}
/** Returns false when the browser refuses to store (private mode, storage full) */
export function storeViews<F>(page: string, userId: string | null, views: SavedView<F>[]): boolean {
  try { const all = readAll<F>(page); all[userId || 'anon'] = views; localStorage.setItem(key(page), JSON.stringify(all)); return true } catch { return false }
}
