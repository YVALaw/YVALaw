/**
 * run-autopay — Netlify Scheduled Function
 *
 * Charges due unpaid invoices for client portal users who explicitly enabled
 * AutoPay. This uses saved Stripe payment method IDs only; raw card data never
 * touches LawOS.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY
 */

const PAYABLE_STATUSES = new Set(['sent', 'viewed', 'overdue', 'partial'])

function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
function centsFromUSD(value) { return Math.round((Number(value) || 0) * 100) }
function enc(value) { return encodeURIComponent(String(value ?? '')) }

async function stripe(method, path, body, opts = {}) {
  const key = process.env.STRIPE_SECRET_KEY
  const headers = {
    Authorization: `Bearer ${key}`,
    'Stripe-Version': '2024-06-20',
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  const req = { method, headers }
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    req.body = formBody(body)
  }

  const res = await fetch(`https://api.stripe.com/v1${path}`, req)
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe ${method} ${path} failed`)
    err.stripeError = data?.error
    err.paymentIntent = data?.error?.payment_intent
    throw err
  }
  return data
}

async function supabaseGet(path) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${path}`, {
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
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Supabase PATCH ${table} failed: ${res.status}`)
}

async function supabasePatchRows(table, filter, body) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return []
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

async function recordPaymentAttempt(row) {
  try {
    const now = new Date().toISOString()
    const body = { ...row, updated_at: now }
    if (row.stripe_payment_intent_id) {
      const updated = await supabasePatchRows(
        'payment_attempts',
        `stripe_payment_intent_id=eq.${enc(row.stripe_payment_intent_id)}`,
        body
      )
      if (Array.isArray(updated) && updated.length > 0) return
    }
    await supabaseInsert('payment_attempts', {
      ...body,
      attempted_at: row.attempted_at || now,
    })
  } catch (err) {
    console.warn('run-autopay: payment_attempts write skipped', err?.message || err)
  }
}

function isDue(invoice, today) {
  if (!invoice.due_date) return true
  return String(invoice.due_date).slice(0, 10) <= today
}

async function loadDueInvoices(clientName, today) {
  const rows = await supabaseGet(
    `invoices?client_name=eq.${enc(clientName)}&status=in.(sent,viewed,overdue,partial)&select=id,number,status,subtotal,amount_paid,due_date,client_name`
  )
  return (Array.isArray(rows) ? rows : []).filter(inv => {
    const status = String(inv.status || '').toLowerCase()
    const balanceCents = centsFromUSD(Number(inv.subtotal) - Number(inv.amount_paid || 0))
    return PAYABLE_STATUSES.has(status) && balanceCents >= 50 && isDue(inv, today)
  })
}

export default async function handler() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
    return json(500, { error: 'Missing required env vars' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const summary = { checkedClients: 0, charged: 0, skipped: 0, failed: 0, errors: [] }

  const autopayRows = await supabaseGet(
    'client_users?auto_pay_enabled=eq.true&default_payment_method_id=not.is.null&stripe_customer_id=not.is.null&select=client_id,stripe_customer_id,default_payment_method_id'
  )

  for (const billing of Array.isArray(autopayRows) ? autopayRows : []) {
    summary.checkedClients += 1
    try {
      const clientRows = await supabaseGet(`clients?id=eq.${billing.client_id}&select=id,name,email`)
      const client = Array.isArray(clientRows) ? clientRows[0] : null
      if (!client?.name) { summary.skipped += 1; continue }

      const invoices = await loadDueInvoices(client.name, today)
      if (invoices.length === 0) { summary.skipped += 1; continue }

      for (const invoice of invoices) {
        const amountCents = centsFromUSD(Number(invoice.subtotal) - Number(invoice.amount_paid || 0))
        let intent = null

        try {
          intent = await stripe('POST', '/payment_intents', {
            amount:                    amountCents,
            currency:                  'usd',
            customer:                  billing.stripe_customer_id,
            payment_method:            billing.default_payment_method_id,
            off_session:               'true',
            confirm:                   'true',
            'metadata[invoiceId]':     invoice.id,
            'metadata[clientId]':      billing.client_id,
            'metadata[invoiceNumber]': invoice.number || '',
            'metadata[autoPay]':       'true',
          }, {
            idempotencyKey: `autopay-${invoice.id}-${amountCents}`,
          })

          if (intent.status !== 'succeeded') {
            throw new Error(`Unexpected Stripe status: ${intent.status}`)
          }
        } catch (stripeErr) {
          const stripeIntent = stripeErr?.paymentIntent || stripeErr?.stripeError?.payment_intent || intent
          await recordPaymentAttempt({
            invoice_id:               invoice.id,
            client_id:                billing.client_id,
            client_name:              client.name || null,
            invoice_number:           invoice.number || null,
            stripe_payment_intent_id: stripeIntent?.id || null,
            stripe_customer_id:       billing.stripe_customer_id,
            stripe_payment_method_id: billing.default_payment_method_id,
            amount:                   amountCents / 100,
            currency:                 stripeIntent?.currency || 'usd',
            source:                   'autopay',
            status:                   'failed',
            failure_reason:           stripeErr instanceof Error ? stripeErr.message : 'AutoPay charge failed',
          })
          summary.failed += 1
          summary.errors.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            error: stripeErr instanceof Error ? stripeErr.message : 'AutoPay charge failed',
          })
          continue
        }

        await recordPaymentAttempt({
          invoice_id:               invoice.id,
          client_id:                billing.client_id,
          client_name:              client.name || null,
          invoice_number:           invoice.number || null,
          stripe_payment_intent_id: intent.id,
          stripe_customer_id:       billing.stripe_customer_id,
          stripe_payment_method_id: billing.default_payment_method_id,
          amount:                   amountCents / 100,
          currency:                 intent.currency || 'usd',
          source:                   'autopay',
          status:                   'succeeded',
          failure_reason:           null,
        })

        try {
          await supabasePatch('invoices', `id=eq.${invoice.id}`, {
            status: 'paid',
            amount_paid: Number(invoice.subtotal) || amountCents / 100,
          })
          summary.charged += 1
        } catch (invoiceErr) {
          summary.failed += 1
          summary.errors.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            error: invoiceErr instanceof Error ? invoiceErr.message : 'AutoPay invoice update failed',
          })
        }
      }
    } catch (clientErr) {
      summary.failed += 1
      summary.errors.push({
        clientId: billing.client_id,
        error: clientErr instanceof Error ? clientErr.message : 'AutoPay client processing failed',
      })
    }
  }

  return json(200, summary)
}
