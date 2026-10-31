/**
 * Shared server helpers for Netlify functions: Supabase REST with the service role,
 * caller verification, roles and permissions. (This folder has no index file, so
 * Netlify does not deploy it as a function.)
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const STAFF_ROLES = ['ceo', 'admin', 'accounting', 'recruiter', 'lead_gen']

function env() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return { url: url.replace(/\/$/, ''), key }
}

const enc = v => encodeURIComponent(String(v ?? ''))

/** PostgREST call as the service role. Returns parsed JSON (or null for empty bodies). */
async function rest(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const { url, key } = env()
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`, apikey: key, Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try { const j = JSON.parse(text); detail = j.message || j.error || text } catch { /* keep text */ }
    const err = new Error(`Supabase ${method} ${path.split('?')[0]} failed (${res.status}): ${String(detail).slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return text ? JSON.parse(text) : null
}

/** Call a public SQL function (RPC) as the service role */
function rpc(name, args = {}) {
  return rest(`rpc/${name}`, { method: 'POST', body: args })
}

/** Auth admin API */
async function authAdmin(path, { method = 'GET', body } = {}) {
  const { url, key } = env()
  const res = await fetch(`${url}/auth/v1/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Supabase auth admin ${path.split('/')[0]} failed (${res.status}): ${data.msg || data.message || ''}`)
  return data
}

/** The logged-in user behind a request's Bearer token (verified by Supabase), or null */
async function callerFromEvent(event) {
  const h = event.headers || {}
  const auth = h.authorization || h.Authorization || ''
  if (!auth.startsWith('Bearer ')) return null
  const { url, key } = env()
  const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } })
  if (!res.ok) return null
  const user = await res.json().catch(() => null)
  return user && user.id ? user : null
}

async function roleOf(userId) {
  const rows = await rest(`user_roles?user_id=eq.${enc(userId)}&select=role&limit=1`)
  return rows[0]?.role || null
}

/** Same rule as private.has_permission(): CEO always; other staff roles only if granted */
async function hasPermission(userId, permission) {
  const role = await roleOf(userId)
  if (role === 'ceo') return true
  if (!STAFF_ROLES.includes(role)) return false
  const rows = await rest(`role_permissions?role=eq.${enc(role)}&permission=eq.${enc(permission)}&select=role`).catch(() => [])
  return rows.length > 0
}

/** User ids of everyone holding a permission (CEO + roles granted it) */
async function usersWithPermission(permission) {
  const granted = await rest(`role_permissions?permission=eq.${enc(permission)}&select=role`).catch(() => [])
  const roles = ['ceo', ...granted.map(r => r.role)]
  const rows = await rest(`user_roles?role=in.(${roles.map(enc).join(',')})&select=user_id`)
  return [...new Set(rows.map(r => r.user_id))]
}

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://yvastaffing.agency',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  }
}

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://yvastaffing.agency/os/').replace(/\/*$/, '/')

module.exports = { STAFF_ROLES, APP_URL, enc, rest, rpc, authAdmin, callerFromEvent, roleOf, hasPermission, usersWithPermission, json }
