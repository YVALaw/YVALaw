// "Who is tracking right now" compares the YVA Time app's last upload (database time) with "now". The browser's clock
// can be minutes off (a PC that never synced its time): 2026-11-04 a few minutes' difference made Time Tracking, the
// Team list, Home and the dock all show "nobody tracking" while the person was tracking. serverNow() is the browser
// clock corrected by the Date header of a tiny same-origin request (Netlify's clock, to the second).
// Use it — never Date.now() — for any "in the last N minutes" check against database timestamps.

/** One rule everywhere: the app uploads (and checks in) about once a minute, so 3 minutes means "right now" */
export const LIVE_MS = 3 * 60_000
const RECHECK_MS = 10 * 60_000
/** Smaller differences are ignored (the Date header only has whole seconds) */
const IGNORE_MS = 2000

let offset = 0
let checkedAt = 0
let pending: Promise<void> | null = null

/** Server time in ms (browser clock + the last measured difference) */
export function serverNow(): number { return Date.now() + offset }

/** Measures the difference at most every 10 minutes; never throws (keeps the old value on failure) */
export function syncServerClock(): Promise<void> {
  if (checkedAt && Date.now() - checkedAt < RECHECK_MS) return Promise.resolve()
  if (pending) return pending
  pending = (async () => {
    try {
      const t0 = Date.now()
      const res = await fetch(`${import.meta.env.BASE_URL}404.txt?clock=${t0}`, { method: 'HEAD', cache: 'no-store' })
      const t1 = Date.now()
      const server = Date.parse(res.headers.get('date') || '')
      if (Number.isFinite(server)) {
        offset = clockOffset(server, t0, t1)
        checkedAt = Date.now()
      }
    } catch { /* offline: keep the last value */ } finally { pending = null }
  })()
  return pending
}

/** Server time after making sure the difference has been measured */
export async function serverNowSynced(): Promise<number> {
  await syncServerClock()
  return serverNow()
}

/** The difference between a whole-second server Date header and the browser clock at the middle of the request */
export function clockOffset(serverDateMs: number, sentAt: number, receivedAt: number): number {
  const est = serverDateMs + 500 - (sentAt + receivedAt) / 2
  return Math.abs(est) < IGNORE_MS ? 0 : Math.round(est)
}

/** For tests */
export function _resetServerClock(value = 0) { offset = value; checkedAt = 0; pending = null }
