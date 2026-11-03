// delete-staff-login against a fake Supabase (REST + auth admin)
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { FakeBackend } from './helpers/fakeBackend.ts'

const require = createRequire(import.meta.url)
const fn = require('../netlify/functions/delete-staff-login.cjs')

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const CEO = id(1), CEO2 = id(2), ADM = id(3), NEW = id(4), CLI = id(5), EMP = id(6), REC = id(7), GONE = id(8)
let fb: FakeBackend
let authUsers: Set<string>
let authCalls: { method: string; path: string }[]
let authFail: string | null

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  fb = new FakeBackend().install()
  authUsers = new Set([CEO, CEO2, ADM, NEW, CLI, EMP, REC]); authCalls = []; authFail = null
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const u = new URL(String(input))
    if (u.pathname.startsWith('/auth/v1/admin/users/')) {
      const uid = decodeURIComponent(u.pathname.split('/').pop()!)
      const method = (init.method || 'GET').toUpperCase()
      authCalls.push({ method, path: uid })
      if (authFail && method === 'DELETE') return res(500, { msg: authFail })
      if (!authUsers.has(uid)) return res(404, { msg: 'User not found' })
      if (method === 'DELETE') { authUsers.delete(uid); return res(200, {}) }
      return res(200, { id: uid, email: `${uid.slice(-2)}@auth.x` })
    }
    return inner(input, init)
  }) as typeof fetch
  fb.users = { 'tok-ceo': { id: CEO, email: 'hans@yva.com' }, 'tok-adm': { id: ADM, email: 'paola@yva.com' } }
  fb.db.user_roles = [
    { user_id: CEO, role: 'ceo', email: 'hans@yva.com' }, { user_id: ADM, role: 'admin', email: 'paola@yva.com' },
    { user_id: NEW, role: 'pending', email: 'nicole.v@gmail.com' }, { user_id: CLI, role: 'client', email: 'ap@halavi.com' },
    { user_id: EMP, role: 'employee', email: 'ana@yva.com' }, { user_id: REC, role: 'recruiter', email: 'rec@yva.com' },
  ]
  fb.db.employees = [{ id: 'e1', name: 'Paola Delgado', user_id: ADM }, { id: 'e2', name: 'Ana Pérez', user_id: EMP }]
  fb.db.notification_prefs = [{ user_id: ADM, kind: 'payroll_due', email: true }, { user_id: CEO, kind: 'payroll_due', email: true }]
  fb.db.push_subscriptions = [{ id: 'ps1', user_id: ADM }]
  fb.db.audit_log = [{ id: 1, actor_id: ADM, action: 'update', table_name: 'invoices' }]
})
afterEach(() => fb.restore())

const call = async (token: string | null, body: unknown, method = 'POST') => {
  const r = await fn.handler({ httpMethod: method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) })
  return { status: r.statusCode, body: JSON.parse(r.body) }
}

test('only a signed-in CEO; nothing deleted otherwise', async () => {
  assert.equal((await call(null, { userId: REC })).status, 401)
  assert.equal((await call('tok-bad', { userId: REC })).status, 401)
  const adm = await call('tok-adm', { userId: REC })
  assert.equal(adm.status, 403); assert.match(adm.body.error, /Only the CEO/)
  assert.equal((await call('tok-ceo', { userId: REC }, 'GET')).status, 405)
  assert.equal((await call('tok-ceo', { userId: 'x' })).status, 400)
  assert.equal(authCalls.length, 0)
  assert.equal(fb.db.user_roles.length, 6)
})

test('a staff login: auth user deleted, role row + notification settings gone, profile kept but unlinked, history kept, action logged as the CEO', async () => {
  const r = await call('tok-ceo', { userId: ADM })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body, { ok: true, email: 'paola@yva.com', role: 'admin', unlinkedEmployee: 'Paola Delgado' })
  assert.ok(authCalls.some(c => c.method === 'DELETE' && c.path === ADM))
  assert.ok(!authUsers.has(ADM))
  assert.ok(!fb.db.user_roles.some(r => r.user_id === ADM))
  assert.equal(fb.db.employees.find(e => e.id === 'e1')!.user_id, null)
  assert.equal(fb.db.employees.length, 2, 'employee record kept')
  assert.deepEqual(fb.db.notification_prefs.map(p => p.user_id), [CEO])
  assert.equal(fb.db.push_subscriptions.length, 0)
  assert.equal(fb.db.audit_log.length, 1, 'history untouched')
  const log = fb.restCalls.find(c => c.path.startsWith('rpc/log_action'))!
  assert.ok(log, 'log_action called')
  const b = log.body as Record<string, any>
  assert.equal(b.p_kind, 'staff_login_deleted'); assert.equal(b.p_table, 'user_roles'); assert.equal(b.p_record, ADM)
  assert.match(b.p_label, /paola@yva\.com \(Admin\) — profile Paola Delgado kept/)
  assert.deepEqual(b.p_details, { email: 'paola@yva.com', role: 'admin', employee: 'Paola Delgado', employee_id: 'e1' })
})

test('a pending sign-up can be deleted (no profile to unlink)', async () => {
  const r = await call('tok-ceo', { userId: NEW })
  assert.equal(r.status, 200)
  assert.equal(r.body.unlinkedEmployee, null)
  assert.ok(!fb.db.user_roles.some(r => r.user_id === NEW))
  assert.ok(!authUsers.has(NEW))
})

test('refused: yourself, client and employee logins, unknown logins, the last CEO', async () => {
  const self = await call('tok-ceo', { userId: CEO })
  assert.equal(self.status, 400); assert.match(self.body.error, /your own login/)
  const cli = await call('tok-ceo', { userId: CLI })
  assert.equal(cli.status, 400); assert.match(cli.body.error, /client portal login/)
  const emp = await call('tok-ceo', { userId: EMP })
  assert.equal(emp.status, 400); assert.match(emp.body.error, /employee/)
  const none = await call('tok-ceo', { userId: GONE })
  assert.equal(none.status, 404)
  assert.ok(!authCalls.some(c => c.method === 'DELETE'))
  assert.equal(fb.db.employees.find(e => e.id === 'e2')!.user_id, EMP)
  // With two CEOs, one may delete the other
  fb.users['tok-ceo2'] = { id: CEO2, email: 'ceo2@yva.com' }
  fb.db.user_roles.push({ user_id: CEO2, role: 'ceo', email: 'ceo2@yva.com' })
  const ok = await call('tok-ceo2', { userId: CEO })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.role, 'ceo')
})

test('last-CEO rule: a CEO target with no other CEO row is refused', async () => {
  // The caller passes the role check from a cached row, but by the time we count, only the target is CEO
  let roleReads = 0
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const s = String(input)
    if (s.includes('/rest/v1/user_roles?user_id=eq.' + ADM) && s.includes('select=role&')) { roleReads++; return res(200, [{ role: 'ceo' }]) }
    return inner(input, init)
  }) as typeof fetch
  fb.users['tok-adm'] = { id: ADM, email: 'paola@yva.com' }
  const r = await call('tok-adm', { userId: CEO })
  assert.ok(roleReads >= 1)
  assert.equal(r.status, 400); assert.match(r.body.error, /last CEO/)
  assert.ok(authUsers.has(CEO))
})

test('auth user already gone → clean-up still finishes; other auth errors stop before anything else changes', async () => {
  authUsers.delete(REC)
  const r = await call('tok-ceo', { userId: REC })
  assert.equal(r.status, 200)
  assert.ok(!fb.db.user_roles.some(r => r.user_id === REC))
  authFail = 'Database error deleting user'
  const r2 = await call('tok-ceo', { userId: ADM })
  assert.equal(r2.status, 500); assert.match(r2.body.error, /Database error deleting user/)
  assert.ok(fb.db.user_roles.some(r => r.user_id === ADM), 'role row kept when the sign-in could not be deleted')
  assert.equal(fb.db.employees.find(e => e.id === 'e1')!.user_id, ADM)
})
