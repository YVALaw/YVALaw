/**
 * log-portal-activity — Netlify Function
 *
 * Server-side audit writer for client portal events. Portal users can request
 * audit entries only for their own client record; direct activity_log writes
 * remain restricted by RLS.
 */

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  }
}

function enc(value) {
  return encodeURIComponent(String(value ?? ''))
}

async function getUserFromToken(token) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  })
  if (!res.ok) return null
  return res.json()
}

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status}`)
  return res.json()
}

async function supabaseInsert(table, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase INSERT ${table} failed: ${res.status}`)
}

async function supabasePatch(table, filter, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase PATCH ${table} failed: ${res.status}`)
}

function noteForEvent(eventType, user, document) {
  const email = user?.email ? ` (${user.email})` : ''
  if (eventType === 'portal_login') return `Client portal login${email}.`
  if (eventType === 'document_upload') {
    return `Client uploaded document: ${document?.name || 'Unknown document'}${email}.`
  }
  if (eventType === 'document_download') {
    return `Client downloaded document: ${document?.name || 'Unknown document'}${email}.`
  }
  return null
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: 'Missing required env vars' })
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })

  let clientId, eventType, documentId
  try {
    const body = JSON.parse(event.body || '{}')
    clientId = body.clientId
    eventType = body.eventType
    documentId = body.documentId
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const allowedEvents = new Set(['portal_login', 'document_upload', 'document_download'])
  if (!clientId || !allowedEvents.has(eventType)) {
    return json(400, { error: 'clientId and a valid eventType are required' })
  }

  const user = await getUserFromToken(authHeader.slice(7))
  if (!user?.id) return json(401, { error: 'Invalid or expired token' })

  const portalRows = await supabaseGet(
    `client_users?client_id=eq.${enc(clientId)}&auth_id=eq.${enc(user.id)}&select=id`
  )
  const portalUser = Array.isArray(portalRows) ? portalRows[0] : null
  if (!portalUser) return json(403, { error: 'Access denied' })

  let document = null
  if (eventType === 'document_upload' || eventType === 'document_download') {
    if (!documentId) return json(400, { error: 'documentId is required' })
    const docs = await supabaseGet(
      `client_documents?id=eq.${enc(documentId)}&client_id=eq.${enc(clientId)}&select=id,name`
    )
    document = Array.isArray(docs) ? docs[0] : null
    if (!document) return json(404, { error: 'Document not found' })
  }

  const note = noteForEvent(eventType, user, document)
  if (!note) return json(400, { error: 'Unsupported eventType' })

  await supabaseInsert('activity_log', {
    id: crypto.randomUUID(),
    client_id: clientId,
    note,
    created_at: Date.now(),
    type: 'system',
    auto: true,
  })

  if (eventType === 'portal_login') {
    await supabasePatch('client_users', `id=eq.${enc(portalUser.id)}`, {
      last_login_at: new Date().toISOString(),
    })
  }

  return json(200, { ok: true })
}
