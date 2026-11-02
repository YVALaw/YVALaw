// A small in-memory stand-in for Supabase (PostgREST + auth) and Stripe, for testing Netlify functions with a
// fake global fetch. Supports the filters the payment functions use: eq, neq, is, in, gte, lte, not.is, or=(…).
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
type Row = Record<string, unknown>
type StripeHandler = (method: string, path: string, form: URLSearchParams, headers: Record<string, string>) => unknown

const META = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function cmp(a: unknown, b: string) {
  const na = Number(a), nb = Number(b)
  return Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' ? na - nb : String(a ?? '').localeCompare(b)
}
function splitTop(s: string) {
  const out: string[] = []; let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}
function matches(row: Row, key: string, expr: string): boolean {
  if (key === 'or') return splitTop(expr.slice(1, -1)).some(part => { const i = part.indexOf('.'); return matches(row, part.slice(0, i), part.slice(i + 1)) })
  if (key === 'and') return splitTop(expr.slice(1, -1)).every(part => { const i = part.indexOf('.'); return matches(row, part.slice(0, i), part.slice(i + 1)) })
  let not = false
  if (expr.startsWith('not.')) { not = true; expr = expr.slice(4) }
  const i = expr.indexOf('.'), op = expr.slice(0, i), val = expr.slice(i + 1)
  const v = row[key]
  let r: boolean
  switch (op) {
    case 'eq': r = String(v) === val; break
    case 'neq': r = String(v) !== val; break
    case 'is': r = val === 'null' ? v == null : String(v) === val; break
    case 'in': r = val.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(v)); break
    case 'gte': r = v != null && cmp(v, val) >= 0; break
    case 'lte': r = v != null && cmp(v, val) <= 0; break
    case 'gt': r = v != null && cmp(v, val) > 0; break
    case 'lt': r = v != null && cmp(v, val) < 0; break
    default: throw new Error(`fake: unsupported filter ${op}`)
  }
  return not ? !r : r
}

export class FakeBackend {
  db: Record<string, Row[]> = {}
  users: Record<string, { id: string; email: string }> = {}     // token → user
  stripeCalls: { method: string; path: string; form: URLSearchParams; headers: Record<string, string> }[] = []
  restCalls: { method: string; path: string; body?: unknown }[] = []
  stripe: StripeHandler = () => { throw new Error('no stripe handler') }
  failInsert: Record<string, string> = {}       // table → error message (once)
  uniques: Record<string, string> = { client_payments: 'external_ref', stripe_events: 'id', payment_attempts: 'stripe_payment_intent_id' }
  private orig = globalThis.fetch

  install() {
    process.env.SUPABASE_URL = 'https://sb.test'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => this.route(String(input), init)) as typeof fetch
    return this
  }
  restore() { globalThis.fetch = this.orig }
  table(name: string) { return (this.db[name] ||= []) }

  private res(status: number, body: unknown) {
    return new Response(body === undefined || body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  private async route(url: string, init: RequestInit) {
    const u = new URL(url)
    const method = (init.method || 'GET').toUpperCase()
    const headers = Object.fromEntries(Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    if (u.host === 'api.stripe.com') {
      const form = new URLSearchParams(typeof init.body === 'string' ? init.body : u.search.slice(1))
      this.stripeCalls.push({ method, path: u.pathname.replace('/v1', '') + (method === 'GET' ? u.search : ''), form, headers })
      try {
        const out = this.stripe(method, u.pathname.replace('/v1', ''), form, headers) as { __status?: number }
        if (out && out.__status) { const { __status, ...rest } = out as Record<string, unknown>; return this.res(__status as number, rest) }
        return this.res(200, out)
      } catch (e) { return this.res(402, { error: { message: (e as Error).message, ...(e as { stripe?: object }).stripe } }) }
    }
    if (u.pathname === '/auth/v1/user') {
      const tok = (headers.authorization || '').replace(/^Bearer /, '')
      const user = this.users[tok]
      return user ? this.res(200, user) : this.res(401, { msg: 'bad token' })
    }
    if (!u.pathname.startsWith('/rest/v1/')) return this.res(404, { message: 'no route' })
    const name = u.pathname.slice(9)
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    this.restCalls.push({ method, path: name + u.search, body })
    if (name.startsWith('rpc/')) return this.res(200, null)
    if (!(name in this.db)) return this.res(404, { message: `Could not find the table 'public.${name}' in the schema cache` })
    const rows = this.table(name)
    const filters = [...u.searchParams].filter(([k]) => !META.has(k))
    const pick = () => rows.filter(r => filters.every(([k, v]) => matches(r, k, v)))
    const prefer = headers.prefer || ''
    const ret = (out: Row[]) => (prefer.includes('return=representation') ? this.res(method === 'POST' ? 201 : 200, out) : this.res(method === 'POST' ? 201 : 204, null))
    if (method === 'GET') {
      let out = pick()
      const order = u.searchParams.get('order')
      if (order) {
        const [k, dir] = order.split(',')[0].split('.')
        out = [...out].sort((a, b) => (dir === 'desc' ? -1 : 1) * String(a[k] ?? '').localeCompare(String(b[k] ?? '')))
      }
      const lim = u.searchParams.get('limit')
      return this.res(200, lim ? out.slice(0, Number(lim)) : out)
    }
    if (method === 'POST') {
      if (this.failInsert[name]) { const m = this.failInsert[name]; delete this.failInsert[name]; return this.res(400, { message: m }) }
      const items = ([] as Row[]).concat(body)
      const key = u.searchParams.get('on_conflict') || this.uniques[name]
      const out: Row[] = []
      for (const it of items) {
        const clash = key && it[key] != null && rows.find(r => String(r[key]) === String(it[key]))
        if (clash) {
          if (prefer.includes('ignore-duplicates')) continue
          return this.res(409, { message: `duplicate key value violates unique constraint (${key})` })
        }
        const row = { id: it.id ?? crypto.randomUUID(), ...it }
        rows.push(row); out.push(row)
      }
      return ret(out)
    }
    if (method === 'PATCH') { const hit = pick(); hit.forEach(r => Object.assign(r, body)); return ret(hit) }
    if (method === 'DELETE') { const hit = new Set(pick()); this.db[name] = rows.filter(r => !hit.has(r)); return ret([...hit]) }
    return this.res(405, null)
  }
}

/** A correctly signed Stripe webhook request for `evt` */
export function signedEvent(evt: object, secret: string, nowSec = Math.floor(Date.now() / 1000)) {
  const crypto = require('crypto') as typeof import('crypto')
  const body = JSON.stringify(evt)
  const sig = crypto.createHmac('sha256', secret).update(`${nowSec}.${body}`).digest('hex')
  return { httpMethod: 'POST', headers: { 'stripe-signature': `t=${nowSec},v1=${sig}` }, body }
}
