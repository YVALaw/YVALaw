// Live updates (2026-11, supabase/migrate-live-updates.sql). Every open window listens to one tiny table,
// public.data_versions, through Supabase Realtime. When anyone saves, that table's number moves and every window
// drops only the kept reads of that table (lib/readCache.ts) — the next look at it reads fresh, nothing else is
// re-read, and nothing is refreshed on a timer. If the live connection is down (or Realtime isn't switched on),
// opening a page or coming back to the window does one "what changed?" read instead.
// Before the SQL script has run there are no numbers: reads are simply kept 1 minute, as before.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { applyVersions, checkForChanges, onTeamChange, pageChanged, registerVersionSource, setLiveConnected, type VersionRow } from '../lib/readCache'

let started = false

export function startLiveUpdates() {
  if (started || typeof window === 'undefined') return
  started = true
  registerVersionSource(async () => {
    const { data, error } = await supabase.from('data_versions').select('table_name,version')
    return error ? null : (data as VersionRow[])
  })
  void checkForChanges(0)
  supabase
    .channel('yva-data-versions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'data_versions' }, payload => {
      const row = payload.new as VersionRow | undefined
      if (row?.table_name) applyVersions([row])
    })
    .subscribe(state => {
      const live = state === 'SUBSCRIBED'
      setLiveConnected(live)
      // (Re)connected: changes made while not connected weren't pushed — catch up once (the first page's own
      // check covers the very first connect)
      if (live) void checkForChanges(3000)
    })

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForChanges(30_000) })
  window.addEventListener('online', () => void checkForChanges(0))
}

/** For the shells: starts live updates, tells the cache when a new page is on screen, and reports when a teammate
 *  changed something the current page shows. `showLatest()` re-opens the page with fresh data (bump `pageKey`). */
export function useLiveUpdates(path: string) {
  const lastPath = useRef<string | null>(null)
  // Before the new page renders (and starts reading), so its reads are tracked from the first one
  if (lastPath.current !== path) { lastPath.current = path; startLiveUpdates(); pageChanged() }
  const [teamChanged, setTeamChanged] = useState(false)
  const [pageKey, setPageKey] = useState(0)
  useEffect(() => onTeamChange(() => setTeamChanged(true)), [])
  useEffect(() => { setTeamChanged(false) }, [path])
  const showLatest = useCallback(() => { setTeamChanged(false); pageChanged(); setPageKey(k => k + 1) }, [])
  return { teamChanged, pageKey, showLatest, dismiss: () => setTeamChanged(false) }
}
