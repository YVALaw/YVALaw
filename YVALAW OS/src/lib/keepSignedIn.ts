// "Keep me signed in" on the login page (staff, client portal and My workspace share one login page).
//
//   ticked   → the sign-in stays on this device until Sign out (Supabase keeps it in localStorage, as before).
//   unticked → the sign-in ends when the browser / installed app is closed: on the next start, if no YVA OS
//              window was still open, the saved sign-in is removed before Supabase reads it.
//
// The choice is remembered on this device (localStorage `yva_keep_signed_in`, '0' = unticked; default ticked).
// "Was this window already open?" = a sessionStorage mark (kept on reload, gone when the window closes).
// "Is another YVA OS window open?" = a small register in localStorage: every window writes its own key
// (`yva_win_<id>` = time) every 15 s and removes it on `pagehide` (close / reload / navigate away). One key per window,
// never a shared list: windows in different processes see localStorage changes a moment late, and a read-modify-write
// of one list let a closing page wipe the entry the reloaded page had just written. An entry seen in the last 75 s counts as
// open — background tabs may only run timers once a minute. So closing one tab never signs out the others, and a
// new tab opened while another is open stays signed in. The installed app and browser tabs share the register.
//
// Before (until 2026-11): unticked added a `beforeunload` that called signOut() — that also fired on every reload
// and, being a global sign-out, ended the sign-in in every other open tab; the choice wasn't remembered.
// Pure parts are unit-tested in tests/keepSignedIn.test.ts.

export const KEEP_KEY = 'yva_keep_signed_in'
export const TAB_MARK_KEY = 'yva_window_open'
export const WIN_PREFIX = 'yva_win_'
export const BEAT_MS = 15_000
export const ALIVE_MS = 75_000
const PRUNE_MS = 10 * 60_000
/** Supabase's saved sign-in (sb-<project>-auth-token, plus -code-verifier / -user parts) */
const AUTH_KEY_RE = /^sb-.+-auth-token/

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type ListableStore = Store & { readonly length: number; key(i: number): string | null }
export type OpenWindows = Record<string, number>

export function readKeepSignedIn(local: Store): boolean {
  try { return local.getItem(KEEP_KEY) !== '0' } catch { return true }
}

export function writeKeepSignedIn(local: Store, keep: boolean): void {
  try { local.setItem(KEEP_KEY, keep ? '1' : '0') } catch { /* private mode: falls back to "keep" */ }
}

/** Every window in the register: id → last seen (ms) */
export function readOpenWindows(local: ListableStore): OpenWindows {
  const out: OpenWindows = {}
  try {
    for (let i = 0; i < local.length; i++) {
      const k = local.key(i)
      if (!k || !k.startsWith(WIN_PREFIX)) continue
      const t = Number(local.getItem(k))
      if (Number.isFinite(t) && t > 0) out[k.slice(WIN_PREFIX.length)] = t
    }
  } catch { /* blocked */ }
  return out
}

/** Is any window other than `selfId` alive (seen within ALIVE_MS)? */
export function anotherWindowOpen(windows: OpenWindows, now: number, selfId?: string): boolean {
  return Object.entries(windows).some(([id, t]) => id !== selfId && now - t < ALIVE_MS && t <= now + 5_000)
}

/** The start-up rule: forget the saved sign-in only if the person chose not to stay signed in, this window is new,
 *  and no other YVA OS window is open */
export function shouldForgetSignIn({ keep, windowWasOpen, windows, now }: { keep: boolean; windowWasOpen: boolean; windows: OpenWindows; now: number }): boolean {
  return !keep && !windowWasOpen && !anotherWindowOpen(windows, now)
}

export function savedSignInKeys(local: ListableStore): string[] {
  const out: string[] = []
  for (let i = 0; i < local.length; i++) { const k = local.key(i); if (k && AUTH_KEY_RE.test(k)) out.push(k) }
  return out
}

function writeWindow(local: Store, id: string, now: number | null) {
  try { if (now === null) local.removeItem(WIN_PREFIX + id); else local.setItem(WIN_PREFIX + id, String(now)) } catch { /* storage full / blocked */ }
}
/** Entries left by windows that never said goodbye (crash, killed app) */
function pruneWindows(local: ListableStore, now: number) {
  try { for (const [id, t] of Object.entries(readOpenWindows(local))) if (now - t > PRUNE_MS) local.removeItem(WIN_PREFIX + id) } catch { /* ignore */ }
}

/**
 * Run once, before the Supabase client is created (lib/supabase.ts). Removes the saved sign-in when the rule says so,
 * marks this window, and keeps its entry in the register up to date. Returns whether the sign-in was forgotten.
 */
export function applyKeepSignedInOnStartup(win: Window & typeof globalThis = window): boolean {
  let local: Storage, session: Storage
  try { local = win.localStorage; session = win.sessionStorage } catch { return false }
  const now = Date.now()
  let forgot = false
  try {
    const windowWasOpen = session.getItem(TAB_MARK_KEY) === '1'
    if (shouldForgetSignIn({ keep: readKeepSignedIn(local), windowWasOpen, windows: readOpenWindows(local), now })) {
      const keys = savedSignInKeys(local)
      keys.forEach(k => local.removeItem(k))
      forgot = keys.length > 0
    }
    session.setItem(TAB_MARK_KEY, '1')
    pruneWindows(local, now)
  } catch { /* storage blocked: Supabase decides as usual */ }

  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const beat = () => writeWindow(local, id, Date.now())
  beat()
  win.setInterval(beat, BEAT_MS)
  win.addEventListener('pagehide', () => writeWindow(local, id, null))
  win.addEventListener('pageshow', e => { if ((e as PageTransitionEvent).persisted) beat() })
  win.document.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible') beat() })
  return forgot
}

/** Login page: remember the choice for this device (and mark this window, so a reload keeps the new sign-in) */
export function setKeepSignedIn(keep: boolean): void {
  try { writeKeepSignedIn(window.localStorage, keep); window.sessionStorage.setItem(TAB_MARK_KEY, '1') } catch { /* ignore */ }
}

export function keepSignedInChoice(): boolean {
  try { return readKeepSignedIn(window.localStorage) } catch { return true }
}
