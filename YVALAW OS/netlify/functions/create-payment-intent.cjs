/**
 * create-payment-intent — Netlify Function
 *
 * Creates a Stripe PaymentIntent for a client portal invoice payment.
 * Gets or creates the Stripe Customer for this client and returns their
 * saved cards so returning clients don't re-enter card details.
 *
 * POST /.netlify/functions/create-payment-intent
 * Headers: Authorization: Bearer <user_access_token>
 * Body:    { invoiceId: string, clientId: string, amountCents?: number }
 *
 * Returns: { clientSecret: string, savedMethods: SavedCard[] }
 *
 * Required Netlify env vars:
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key
 *   STRIPE_SECRET_KEY         — Stripe secret key (sk_live_xxx or sk_test_xxx)
 */

const crypto = require('crypto')

const PAYABLE_STATUSES = new Set(['sent', 'viewed', 'overdue', 'partial'])

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Encode a flat/nested object as application/x-www-form-urlencoded for Stripe */
function toForm(obj, prefix) {
  const parts = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (typeof v === 'object' && !Array.isArray(v)) {
      parts.push(...toForm(v, key))
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`)
    }
  }
  return parts
}
function formBody(obj) { return toForm(obj).join('&') }

function centsFromUSD(value) {
  return Math.round((Number(value) || 0) * 100)
}

/** Stripe API request helper */
async function stripe(method, path, body) {
  const key = process.env.STRIPE_SECRET_KEY
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Stripe-Version': '2024-06-20',
    },
  }
  if (body) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    opts.body = formBody(body)
  }
  const res = await fetch(`https://api.stripe.com/v1${path}`, opts)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${method} ${path} failed`)
  return data
}

/** Supabase REST API helper (uses service role key — bypasses RLS) */
async function supabaseGet(path) {
  const url  = process.env.SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res  = await fetch(`${url}/rest/v1/${path}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status}`)
  return res.json()
}

async function supabasePatch(table, filter, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${key}`, apikey: key,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase PATCH ${table} failed: ${res.status}`)
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

async function recordPaymentAttempt(row) {
  try {
    await supabaseInsert('payment_attempts', {
      ...row,
      attempted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('create-payment-intent: payment_attempts insert skipped', err?.message || err)
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST')    return json(405, { error: 'Method not allowed' })

  // ── Env checks ────────────────────────────────────────────────────────────
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return json(500, { error: 'Missing required env vars' })
  }

  // ── Verify caller auth token ──────────────────────────────────────────────
  const authHeader = (event.headers.authorization || event.headers.Authorization || '')
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'Authorization token required' })
  const token = authHeader.slice(7)

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_SERVICE_ROLE_KEY },
  })
  if (!userRes.ok) return json(401, { error: 'Invalid or expired token' })

  const user = await userRes.json()
  if (!user?.id) return json(401, { error: 'Could not identify caller' })

  // ── Parse & validate body ─────────────────────────────────────────────────
  let invoiceId, clientId, amountCents
  try {
    const body = JSON.parse(event.body || '{}')
    invoiceId   = body.invoiceId
    clientId    = body.clientId
    amountCents = body.amountCents
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  if (!invoiceId || !clientId) {
    return json(400, { error: 'invoiceId and clientId are required' })
  }
  if (amountCents != null && typeof amountCents !== 'number') {
    return json(400, { error: 'amountCents must be a number when provided' })
  }

  // ── Verify the client owns this invoice (security check) ──────────────────
  // Confirm the caller is either the client or an internal user
  const clientUserRows = await supabaseGet(
    `client_users?client_id=eq.${clientId}&auth_id=eq.${user.id}&select=id,stripe_customer_id`
  )
  const isClient = Array.isArray(clientUserRows) && clientUserRows.length > 0

  if (!isClient) {
    // Allow internal users (preview mode) — check user_roles
    const roleRows = await supabaseGet(`user_roles?user_id=eq.${user.id}&select=role`)
    const isInternal = Array.isArray(roleRows) && roleRows.length > 0 && roleRows[0].role !== 'client'
    if (!isInternal) return json(403, { error: 'Access denied' })
  }

  // ── Fetch client + invoice and compute payable balance server-side ─────────
  const [clientRows, invoiceRows] = await Promise.all([
    supabaseGet(`clients?id=eq.${clientId}&select=id,name,email`),
    supabaseGet(`invoices?id=eq.${invoiceId}&select=id,number,client_name,status,subtotal,amount_paid`),
  ])
  const client  = Array.isArray(clientRows) ? clientRows[0] : null
  const invoice = Array.isArray(invoiceRows) ? invoiceRows[0] : null

  if (!client)  return json(404, { error: 'Client not found' })
  if (!invoice) return json(404, { error: 'Invoice not found' })

  if (invoice.client_name !== client.name) {
    return json(403, { error: 'Invoice does not belong to this client' })
  }

  const status = String(invoice.status || '').toLowerCase()
  if (!PAYABLE_STATUSES.has(status)) {
    return json(409, { error: 'This invoice is not payable' })
  }

  const serverAmountCents = centsFromUSD(Number(invoice.subtotal) - Number(invoice.amount_paid || 0))
  if (serverAmountCents < 50) {
    return json(409, { error: 'Invoice has no payable balance' })
  }

  if (amountCents != null && amountCents !== serverAmountCents) {
    return json(409, { error: 'Invoice balance changed. Refresh and try again.' })
  }

  // ── Get or create Stripe Customer ─────────────────────────────────────────
  let customerId = isClient ? clientUserRows[0].stripe_customer_id : null

  if (!customerId) {
    const customer = await stripe('POST', '/customers', {
      email:             user.email || client?.email || '',
      name:              client?.name || '',
      'metadata[clientId]': clientId,
      'metadata[userId]':   user.id,
    })
    customerId = customer.id

    // Save stripe_customer_id back to client_users
    if (isClient) {
      await supabasePatch('client_users', `client_id=eq.${clientId}&auth_id=eq.${user.id}`, {
        stripe_customer_id: customerId,
      })
    }
  }

  // ── List saved payment methods ────────────────────────────────────────────
  let savedMethods = []
  try {
    const pmList = await stripe('GET', `/customers/${customerId}/payment_methods?type=card&limit=5`)
    savedMethods = (pmList.data || []).map(pm => ({
      id:       pm.id,
      brand:    pm.card?.brand ?? 'card',
      last4:    pm.card?.last4 ?? '????',
      expMonth: pm.card?.exp_month ?? 0,
      expYear:  pm.card?.exp_year  ?? 0,
    }))
  } catch {
    // Non-fatal — just proceed without saved methods
  }

  // ── Create Payment Intent ─────────────────────────────────────────────────
  const intent = await stripe('POST', '/payment_intents', {
    amount:                    serverAmountCents,
    currency:                  'usd',
    customer:                  customerId,
    'payment_method_types[]':  'card',
    setup_future_usage:        'off_session',   // saves card for future invoices
    'metadata[invoiceId]':     invoiceId,
    'metadata[clientId]':      clientId,
    'metadata[invoiceNumber]': invoice.number || '',
  })

  await recordPaymentAttempt({
    invoice_id:               invoiceId,
    client_id:                clientId,
    client_name:              client.name || null,
    invoice_number:           invoice.number || null,
    stripe_payment_intent_id: intent.id,
    stripe_customer_id:       customerId,
    amount:                   serverAmountCents / 100,
    currency:                 'usd',
    source:                   'portal',
    status:                   intent.status || 'created',
  })

  return json(200, {
    clientSecret: intent.client_secret,
    savedMethods,
  })
}
