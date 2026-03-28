import { useEffect, useState, useCallback } from 'react'

export type ActiveTimer = {
  employeeId?: string
  employeeName: string
  projectId?: string
  projectName?: string
  clientName?: string
  description?: string
  billable: boolean
  startedAt: number  // unix ms
}

const KEY = 'yva_active_timer'

export function getStoredTimer(): ActiveTimer | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null }
}

export function setStoredTimer(t: ActiveTimer | null) {
  if (t) localStorage.setItem(KEY, JSON.stringify(t))
  else localStorage.removeItem(KEY)
}

/** Returns elapsed seconds since startedAt */
export function elapsedSeconds(startedAt: number): number {
  return Math.floor((Date.now() - startedAt) / 1000)
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Hook that provides reactive timer state, ticking every second when active */
export function useActiveTimer() {
  const [timer, setTimer] = useState<ActiveTimer | null>(() => getStoredTimer())
  const [elapsed, setElapsed] = useState(0)

  // Sync from localStorage (handles cross-component updates)
  const refresh = useCallback(() => {
    const stored = getStoredTimer()
    setTimer(stored)
    if (stored) setElapsed(elapsedSeconds(stored.startedAt))
    else setElapsed(0)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 1000)
    return () => clearInterval(interval)
  }, [refresh])

  function start(t: Omit<ActiveTimer, 'startedAt'>) {
    const full: ActiveTimer = { ...t, startedAt: Date.now() }
    setStoredTimer(full)
    setTimer(full)
    setElapsed(0)
  }

  function stop(): ActiveTimer | null {
    const current = getStoredTimer()
    setStoredTimer(null)
    setTimer(null)
    setElapsed(0)
    return current
  }

  return { timer, elapsed, start, stop, refresh }
}
