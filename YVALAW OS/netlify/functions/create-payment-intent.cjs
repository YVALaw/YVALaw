/**
 * create-payment-intent — the client portal's "Pay" (card or US bank account).
 *
 * POST /.netlify/functions/create-payment-intent   Authorization: Bearer <portal user token>
 * Body: { invoiceId, clientId, amountCents?, savePaymentMethod?: boolean }
 * → { clientSecret, paymentIntentId, amountCents, savedMethods }
 *
 * Rules: only the client's own portal login (staff send a pay link instead); the invoice must belong to that
 * client (client_id, or the name for older invoices) and be payable; the amount is the balance in the database
 * (the browser's figure is only compared); no new payment while a bank payment for it is still clearing; one
 * open PaymentIntent per invoice and login is reused (and updated if the balance or "save" choice changed), so
 * reopening the window or a second tab never creates a second charge. The method is saved for later only when
 * the client ticks the box.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY
 */
const { rest, enc, json } = require('./_lib/supa.cjs')
const { stripe } = require('./_lib/stripe.cjs')
const P = require('./_lib/payments.cjs')
const { portalCaller, ensureCustomer, savedMethods } = require('./_lib/portalBilling.cjs')

const REUSABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action'])
const DAY = 86400_000

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.STRIPE_SECRET_KEY) {
    return json(500, { error: 'Online payments are not set up yet. Please contact YVA.' })
  }
  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON body' }) }
  const { invoiceId, clientId, amountCents } = body
  const save = body.savePaymentMethod === true
  if (!invoiceId || !/^[0-9a-f-]{36}$/i.test(String(invoiceId))) return json(400, { error: 'invoiceId is required' })
  if (amountCents != null && !Number.isInteger(amountCents)) return json(400, { error: 'amountCents must be a whole number' })

  try {
    const who = await portalCaller(event, clientId)
    if (who.error) return who.error
    const { user, row, client } = who

    const inv = (await rest(`invoices?id=eq.${enc(invoiceId)}&select=id,number,client_id,client_name,status,subtotal,amount_paid&limit=1`))?.[0]
    if (!inv) return json(404, { error: 'Invoice not found' })
    if (!P.invoiceBelongsToClient(inv, client)) return json(403, { error: 'Invoice does not belong to this client' })
    if (!P.isPayable(inv)) return json(409, { error: 'This invoice has nothing left to pay.' })
    const cents = P.balanceCents(inv)
    if (amountCents != null && amountCents !== cents) return json(409, { error: 'The balance changed. Refresh the page and try again.' })

    const attempts = await rest(`payment_attempts?invoice_id=eq.${enc(inv.id)}&select=id,status,source,stripe_payment_intent_id,stripe_customer_id,attempted_at,updated_at&order=attempted_at.desc&limit=20`)   // fails closed: no read, no new payment
    const now = Date.now()
    const at = a => Date.parse(a.updated_at || a.attempted_at || 0) || 0
    if (attempts.some(a => a.status === 'processing' && now - at(a) < 14 * DAY)) {
      return json(409, { error: 'A bank payment for this invoice is already on its way (bank payments take about 4 business days). Nothing else is needed.' })
    }

    const customerId = await ensureCustomer(row, user, client)
    const wantSetup = save ? 'off_session' : null

    // Reuse this login's open payment for the invoice (second tab, closed window, changed choice)
    let intent = null
    for (const a of attempts) {
      if (a.source !== 'portal' || a.stripe_customer_id !== customerId || !a.stripe_payment_intent_id || now - at(a) > DAY) continue
      if (!['created', 'requires_payment_method', 'requires_confirmation', 'requires_action'].includes(a.status)) continue
      try {
        const pi = await stripe('GET', `/payment_intents/${enc(a.stripe_payment_intent_id)}`)
        if (!REUSABLE.has(pi.status) || pi.currency !== 'usd' || pi.metadata?.invoiceId !== inv.id) continue
        if (pi.amount !== cents || (pi.setup_future_usage || null) !== wantSetup) {
          intent = await stripe('POST', `/payment_intents/${enc(pi.id)}`, { amount: cents, setup_future_usage: wantSetup || '' })
        } else intent = pi
        break
      } catch { /* can't reuse that one — make a new one below */ }
    }

    if (!intent) {
      intent = await stripe('POST', '/payment_intents', {
        amount: cents,
        currency: 'usd',
        customer: customerId,
        description: `Invoice ${inv.number || inv.id}`,
        receipt_email: user.email || client.email || undefined,
        payment_method_types: ['card', 'us_bank_account'],
        // Instant bank verification (bank login). No micro-deposit fallback in the portal: the client picks another method instead
        payment_method_options: { us_bank_account: { verification_method: 'instant', financial_connections: { permissions: ['payment_method'] } } },
        setup_future_usage: wantSetup || undefined,
        metadata: { invoiceId: inv.id, clientId: client.id, clientUserId: row.id, invoiceNumber: inv.number || '', source: 'portal' },
      }, { idempotencyKey: `pi-${inv.id}-${cents}-${save ? 1 : 0}-${row.id}-${Math.floor(now / 60000)}` })
    }

    try {
      const attempt = { invoice_id: inv.id, client_id: client.id, client_name: client.name || null, invoice_number: inv.number || null,
        stripe_payment_intent_id: intent.id, stripe_customer_id: customerId, amount: cents / 100, currency: 'usd', source: 'portal',
        status: intent.status === 'requires_payment_method' ? 'created' : intent.status, updated_at: new Date().toISOString() }
      const upd = await rest(`payment_attempts?stripe_payment_intent_id=eq.${enc(intent.id)}`, { method: 'PATCH', body: attempt, prefer: 'return=representation' })
      if (!upd?.length) await rest('payment_attempts', { method: 'POST', body: { ...attempt, attempted_at: attempt.updated_at }, prefer: 'return=minimal' })
    } catch (err) { console.warn('create-payment-intent: attempt not recorded —', err.message) }

    return json(200, { clientSecret: intent.client_secret, paymentIntentId: intent.id, amountCents: cents, savedMethods: await savedMethods(customerId) })
  } catch (err) {
    console.error('create-payment-intent:', err.message)
    return json(err.status && err.status < 500 ? 400 : 500, { error: err.name === 'StripeError' ? `Stripe: ${err.message}` : 'Could not start the payment. Please try again.' })
  }
}
