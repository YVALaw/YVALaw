// "Keep me signed in": when is the saved sign-in forgotten at start-up? (src/lib/keepSignedIn.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ALIVE_MS, KEEP_KEY, TAB_MARK_KEY, WIN_PREFIX, anotherWindowOpen, applyKeepSignedInOnStartup, readKeepSignedIn, readOpenWindows, savedSignInKeys, shouldForgetSignIn, writeKeepSignedIn } from '../src/lib/keepSignedIn.ts'

class MemStore {
  m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}

test('the choice: ticked by default, remembered per device', () => {
  const s = new MemStore()
  assert.equal(readKeepSignedIn(s), true)
  writeKeepSignedIn(s, false)
  assert.equal(s.getItem(KEEP_KEY), '0')
  assert.equal(readKeepSignedIn(s), false)
  writeKeepSignedIn(s, true)
  assert.equal(readKeepSignedIn(s), true)
})

test('start-up rule: forget only when unticked, this window is new, and no other window is open', () => {
  const now = 1_800_000_000_000
  const open = { a: now - 20_000 }
  const stale = { a: now - ALIVE_MS - 1 }
  assert.equal(shouldForgetSignIn({ keep: true, windowWasOpen: false, windows: {}, now }), false)        // ticked: never
  assert.equal(shouldForgetSignIn({ keep: false, windowWasOpen: true, windows: {}, now }), false)        // reload of an open window
  assert.equal(shouldForgetSignIn({ keep: false, windowWasOpen: false, windows: open, now }), false)     // another tab open
  assert.equal(shouldForgetSignIn({ keep: false, windowWasOpen: false, windows: {}, now }), true)        // browser / app was closed
  assert.equal(shouldForgetSignIn({ keep: false, windowWasOpen: false, windows: stale, now }), true)     // left over from a crash
  assert.equal(anotherWindowOpen({ me: now }, now, 'me'), false)
  assert.equal(anotherWindowOpen({ me: now, other: now - 60_000 }, now, 'me'), true)                    // throttled background tab (1/min)
  assert.equal(anotherWindowOpen({ other: now + 3_600_000 }, now), false)                               // clock nonsense ignored
})

test('register parsing is forgiving; only Supabase sign-in keys are removed', () => {
  const s = new MemStore()
  s.setItem(WIN_PREFIX + 'a', '5'); s.setItem(WIN_PREFIX + 'b', 'x'); s.setItem(WIN_PREFIX + 'c', '-3'); s.setItem('other', '9')
  assert.deepEqual(readOpenWindows(s), { a: 5 })
  s.setItem('sb-rwgte-auth-token', '{}'); s.setItem('sb-rwgte-auth-token-code-verifier', 'x'); s.setItem('yva_last_email', 'hans@yva.com'); s.setItem('sb-other', 'keep')
  assert.deepEqual(savedSignInKeys(s).sort(), ['sb-rwgte-auth-token', 'sb-rwgte-auth-token-code-verifier'])
})

/** A minimal window for applyKeepSignedInOnStartup */
function fakeWindow(local: MemStore, session: MemStore) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const intervals: (() => void)[] = []
  const w = {
    localStorage: local, sessionStorage: session,
    setInterval: (fn: () => void) => { intervals.push(fn); return intervals.length },
    addEventListener: (name: string, fn: (e: unknown) => void) => { listeners[name] = fn },
    document: { visibilityState: 'visible', addEventListener: () => {} },
  }
  return { w: w as unknown as Window & typeof globalThis, listeners, intervals }
}

test('start-up in a real flow: close the last window → signed out; another tab open → stays; ticked → stays', () => {
  const local = new MemStore()
  const token = 'sb-proj-auth-token'
  // Signed in with "Keep me signed in" unticked, in tab A
  writeKeepSignedIn(local, false)
  local.setItem(token, '{"access_token":"x"}')
  const tabA = fakeWindow(local, new MemStore())
  tabA.w.sessionStorage.setItem(TAB_MARK_KEY, '1')      // the login page marked this window
  assert.equal(applyKeepSignedInOnStartup(tabA.w), false)   // reload of tab A keeps the sign-in
  assert.ok(local.getItem(token))
  assert.equal(Object.keys(readOpenWindows(local)).length, 1)
  // Tab B opened while A is open → keeps it, and gets its own mark
  const sessionB = new MemStore()
  const tabB = fakeWindow(local, sessionB)
  assert.equal(applyKeepSignedInOnStartup(tabB.w), false)
  assert.ok(local.getItem(token))
  assert.equal(sessionB.getItem(TAB_MARK_KEY), '1')
  // A closes: B still open; B closes too → register empty
  tabA.listeners.pagehide({}); tabB.listeners.pagehide({})
  assert.deepEqual(readOpenWindows(local), {})
  // Browser started again (new window, empty sessionStorage) → sign-in forgotten
  const tabC = fakeWindow(local, new MemStore())
  assert.equal(applyKeepSignedInOnStartup(tabC.w), true)
  assert.equal(local.getItem(token), null)
  assert.equal(local.getItem(KEEP_KEY), '0', 'the choice itself stays')
  // Same story with "Keep me signed in" ticked → never forgotten
  tabC.listeners.pagehide({})
  writeKeepSignedIn(local, true); local.setItem(token, '{}')
  assert.equal(applyKeepSignedInOnStartup(fakeWindow(local, new MemStore()).w), false)
  assert.ok(local.getItem(token))
})

test('storage that throws (blocked site data) never breaks start-up', () => {
  const boom = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() {}, key: () => null, length: 0 }
  const w = { get localStorage(): never { throw new Error('SecurityError') }, sessionStorage: boom } as unknown as Window & typeof globalThis
  assert.equal(applyKeepSignedInOnStartup(w), false)
  assert.equal(readKeepSignedIn(boom as unknown as MemStore), true)
})
