// "Sign in with YVA OS": the app never sees a password.
//  1. beginSignIn() makes a PKCE verifier/challenge and opens YVA OS /connect-app in the browser
//  2. the person clicks Connect; YVA OS opens yvatime://auth?code=…&state=… (or they paste the code)
//  3. redeem() sends code + verifier to desktop-link-redeem and gets a magic-link token hash
//  4. verifyOtp() turns it into this app's own Supabase session (refreshed automatically,
//     stored encrypted on this computer)
import crypto from 'node:crypto'
import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js'
import { API_BASE, CONNECT_URL, SIGN_IN_TIMEOUT_MS } from './config'
import { readJson, readSecret, removeFile, writeJson, writeSecret } from './store'

type Connection = { supabaseUrl: string; anonKey: string }

const SESSION_FILE = 'session.bin'
let client: SupabaseClient | null = null
let pending: { verifier: string; state: string; at: number } | null = null

// supabase-js keeps its session through this adapter: one encrypted JSON blob
const secureStorage: SupportedStorage = {
  getItem: key => {
    const all = JSON.parse(readSecret(SESSION_FILE) || '{}') as Record<string, string>
    return all[key] ?? null
  },
  setItem: (key, value) => {
    const all = JSON.parse(readSecret(SESSION_FILE) || '{}') as Record<string, string>
    all[key] = value
    writeSecret(SESSION_FILE, JSON.stringify(all))
  },
  removeItem: key => {
    const all = JSON.parse(readSecret(SESSION_FILE) || '{}') as Record<string, string>
    delete all[key]
    writeSecret(SESSION_FILE, JSON.stringify(all))
  },
}

export function getClient(): SupabaseClient | null {
  if (client) return client
  const conn = readJson<Connection | null>('connection.json', null)
  if (!conn) return null
  client = createClient(conn.supabaseUrl, conn.anonKey, {
    auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  return client
}

export async function accessToken(): Promise<string | null> {
  const c = getClient()
  if (!c) return null
  const { data } = await c.auth.getSession()
  return data.session?.access_token ?? null
}

/** Returns the YVA OS page to open in the browser */
export function beginSignIn(): string {
  const verifier  = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  const state     = crypto.randomBytes(12).toString('base64url')
  pending = { verifier, state, at: Date.now() }
  return `${CONNECT_URL}?challenge=${challenge}&state=${state}`
}

export function cancelSignIn() { pending = null }

export function isAwaitingCode(): boolean {
  return pending !== null && Date.now() - pending.at < SIGN_IN_TIMEOUT_MS
}

export function parseDeepLink(url: string): { code: string; state: string } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'yvatime:' || u.hostname !== 'auth') return null
    const code = u.searchParams.get('code'), state = u.searchParams.get('state')
    return code && state ? { code, state } : null
  } catch {
    return null
  }
}

export async function redeem(code: string, state?: string) {
  if (!pending || !isAwaitingCode()) throw new Error('Click "Sign in with YVA OS" first, then connect in your browser.')
  if (state !== undefined && state !== pending.state) throw new Error('That sign-in link was for a different attempt. Try again.')
  const res = await fetch(`${API_BASE}/.netlify/functions/desktop-link-redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim(), verifier: pending.verifier }),
  })
  const data = await res.json().catch(() => ({})) as { tokenHash?: string; supabaseUrl?: string; anonKey?: string; error?: string }
  if (!res.ok || !data.tokenHash || !data.supabaseUrl || !data.anonKey) throw new Error(data.error || 'Sign-in failed. Try again.')

  writeJson('connection.json', { supabaseUrl: data.supabaseUrl, anonKey: data.anonKey })
  removeFile(SESSION_FILE)
  client = null
  const { error } = await getClient()!.auth.verifyOtp({ token_hash: data.tokenHash, type: 'magiclink' })
  if (error) throw new Error(error.message)
  pending = null
}

export async function signOut() {
  await client?.auth.signOut({ scope: 'local' }).catch(() => {})
  client = null
  removeFile(SESSION_FILE)
  removeFile('connection.json')
}
