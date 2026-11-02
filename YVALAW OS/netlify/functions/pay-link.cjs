/**
 * pay-link — "Pay now" links in invoice emails (no portal login needed).
 *
 * POST /.netlify/functions/pay-link   Authorization: Bearer <staff token>   Body: { invoiceId }
 *   → { url, expiresAt }   Staff who can send invoices (CEO/Admin/Accounting or invoices.send).
 *     The link names ONE invoice and expires in 60 days (HMAC token, _lib/payments.cjs). It holds no amount.
 *
 * GET https://yvastaffing.agency/pay?t=<token>   (netlify.toml sends /pay here)   — anyone with the link
 *   Checks the token, works out what is still owed from the database and sends the client to a Stripe Checkout
 *   page for exactly that (card or US bank account). Paid / nothing owed / bank payment already clearing /
 *   expired or altered link → a short page instead. An open Checkout page for the same amount is reused, so a
 *   link opened twice (or by an email scanner) never makes two charges. Money is recorded by stripe-webhook.
 *   GET /pay?done=1 → thank-you page.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, optional PAY_LINK_SECRET, PUBLIC_APP_URL
 */
const { rest, enc, json, callerFromEvent, roleOf, hasPermission, APP_URL } = require('./_lib/supa.cjs')
const crypto = require('crypto')
const { stripe } = require('./_lib/stripe.cjs')
const P = require('./_lib/payments.cjs')

const SENDER_ROLES = new Set(['ceo', 'admin', 'accounting'])
const ORIGIN = new URL(APP_URL).origin
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function page(statusCode, title, message, { company = 'YVA Staffing' } = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · ${esc(company)}</title>
<style>body{margin:0;background:#f6f7f9;font-family:Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#1b1e2b}
main{max-width:460px;margin:12vh auto;padding:0 16px}.card{background:#fff;border:1px solid #e6e8ec;border-top:4px solid #facc15;border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 10px}p{font-size:15px;line-height:1.6;color:#374151;margin:0 0 8px}.foot{font-size:12px;color:#6b7280;margin-top:18px}</style></head>
<body><main><div class="card"><h1>${esc(title)}</h1><p>${message}</p><p class="foot">${esc(company)} · payments are processed securely by Stripe</p></div></main></body></html>`
  return { statusCode, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'DENY' }, body: html }
}
const redirect = url => ({ statusCode: 303, headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }, body: '' })
const linkFor = token => `${ORIGIN}/pay?t=${encodeURIComponent(token)}`

async function clientOf(inv) {
  if (inv.client_id) return (await rest(`clients?id=eq.${enc(inv.client_id)}&select=id,name,company,email&limit=1`))?.[0] || null
  if (!inv.client_name) return null
  return (await rest(`clients?name=eq.${enc(inv.client_name)}&select=id,name,company,email&limit=1`))?.[0] || null
}

async function createLink(event) {
  const user = await callerFromEvent(event)
  if (!user) return json(401, { error: 'Please sign in again.' })
  const role = await roleOf(user.id)
  if (!SENDER_ROLES.has(role) && !(await hasPermission(user.id, 'invoices.send'))) return json(403, { error: 'Only staff who send invoices can make pay links.' })
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }
  if (!/^[0-9a-f-]{36}$/i.test(String(body.invoiceId || ''))) return json(400, { error: 'invoiceId is required' })
  const inv = (await rest(`invoices?id=eq.${enc(body.invoiceId)}&select=id,status&limit=1`))?.[0]
  if (!inv) return json(404, { error: 'Invoice not found' })
  // A draft may get its link while it's being sent; the page only takes payment once the invoice is sent
  const token = P.signPayLink(inv.id)
  return json(200, { url: linkFor(token), expiresAt: new Date(Date.now() + P.PAY_LINK_DAYS * 86400_000).toISOString() })
}

async function openLink(event) {
  const q = event.queryStringParameters || {}
  if (q.done) return page(200, 'Thank you!', 'Your payment was received by Stripe. Card payments show as paid right away; bank payments take about 4 business days to clear. You can close this page.')
  const v = P.verifyPayLink(q.t)
  if (!v.ok) {   // checked before touching the database
    return v.reason === 'expired'
      ? page(410, 'This payment link has expired', 'Please reply to the invoice email or sign in to your client portal to pay.')
      : page(400, 'This payment link is not valid', 'Please use the link exactly as it appears in your invoice email, or contact us.')
  }
  const company = (await rest('settings?id=eq.1&select=company_name&limit=1').catch(() => []))?.[0]?.company_name || 'YVA Staffing'
  const inv = (await rest(`invoices?id=eq.${enc(v.invoiceId)}&select=id,number,status,subtotal,amount_paid,client_id,client_name&limit=1`))?.[0]
  if (!inv) return page(404, 'Invoice not found', 'This invoice is no longer available. Please contact us.', { company })
  if (!P.isPayable(inv)) {
    return P.balanceCents(inv) <= 0 || String(inv.status).toLowerCase() === 'paid'
      ? page(200, `Invoice ${inv.number} is paid`, 'There is nothing left to pay. Thank you!', { company })
      : page(409, `Invoice ${inv.number} can't be paid online`, 'Please contact us about this invoice.', { company })
  }
  const cents = P.balanceCents(inv)
  const attempts = await rest(`payment_attempts?invoice_id=eq.${enc(inv.id)}&select=status,source,stripe_checkout_session_id,attempted_at,updated_at&order=attempted_at.desc&limit=20`)   // fails closed
  const now = Date.now()
  const at = a => Date.parse(a.updated_at || a.attempted_at || 0) || 0
  if (attempts.some(a => a.status === 'processing' && now - at(a) < 14 * 86400_000)) {
    return page(200, 'Payment already on its way', `A bank payment for invoice ${esc(inv.number)} is clearing (about 4 business days). Nothing else is needed.`, { company })
  }
  // Reuse an open Checkout page for the same amount
  for (const a of attempts) {
    if (a.source !== 'pay_link' || !a.stripe_checkout_session_id || now - at(a) > 23 * 3600_000) continue
    try {
      const s = await stripe('GET', `/checkout/sessions/${enc(a.stripe_checkout_session_id)}`)
      if (s.status === 'open' && s.amount_total === cents && s.url) return redirect(s.url)
      if (s.status === 'complete' && s.payment_status !== 'unpaid') return page(200, 'Payment already received', `Invoice ${esc(inv.number)} was just paid. Thank you!`, { company })
    } catch { /* make a new one */ }
  }
  const client = await clientOf(inv)
  const md = { invoiceId: inv.id, clientId: client?.id || inv.client_id || '', invoiceNumber: inv.number || '', source: 'pay_link' }
  const params = {
    mode: 'payment',
    payment_method_types: ['card', 'us_bank_account'],
    payment_method_options: { us_bank_account: { verification_method: 'automatic' } },
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `Invoice ${inv.number || ''}`.trim(), description: `${company}${client?.company || client?.name ? ` · ${client.company || client.name}` : ''}` } } }],
    customer_email: client?.email || undefined,
    payment_intent_data: { description: `Invoice ${inv.number || inv.id} (pay link)`, metadata: md },
    metadata: md,
    success_url: `${ORIGIN}/pay?done=1`,
    cancel_url: linkFor(q.t),
  }
  // Same parameters within 10 minutes → the same Checkout page (a double click or a scanner never makes two)
  const paramHash = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 24)
  const session = await stripe('POST', '/checkout/sessions', params, { idempotencyKey: `checkout-${inv.id}-${paramHash}-${Math.floor(now / 600_000)}` })
  if (!session.url) return page(500, 'Something went wrong', 'Please try the link again in a minute, or contact us.', { company })
  if (md.clientId) {
    await rest('payment_attempts', { method: 'POST', prefer: 'return=minimal', body: {
      invoice_id: inv.id, client_id: md.clientId, client_name: client?.name || inv.client_name || null, invoice_number: inv.number || null,
      stripe_checkout_session_id: session.id, amount: cents / 100, currency: 'usd', source: 'pay_link', status: 'created',
      attempted_at: new Date().toISOString(), updated_at: new Date().toISOString() } }).catch(err => console.warn('pay-link: attempt not recorded —', err.message))
  }
  return redirect(session.url)
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.STRIPE_SECRET_KEY) {
    return event.httpMethod === 'GET' ? page(503, 'Online payment is not available', 'Please contact us to pay this invoice.') : json(500, { error: 'Stripe is not set up yet.' })
  }
  try {
    if (event.httpMethod === 'POST') return await createLink(event)
    if (event.httpMethod === 'GET') return await openLink(event)
    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    console.error('pay-link:', err.message)
    return event.httpMethod === 'GET' ? page(500, 'Something went wrong', 'Please try the link again in a minute, or contact us.') : json(500, { error: 'Could not make the pay link.' })
  }
}
