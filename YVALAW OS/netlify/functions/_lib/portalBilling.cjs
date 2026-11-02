/**
 * Client-portal billing helpers shared by create-payment-intent, setup-payment-method, update-autopay-settings
 * and portal-remove-card.
 *
 *   portalCaller(event, clientId)  → { user, row, client } for a signed-in PORTAL user of that client, or
 *                                    { error: json-response }. Staff can't pay or save methods for a client
 *                                    (they send a pay link instead), so preview mode can never charge anyone.
 *   ensureCustomer(row, user, client) → the Stripe customer id for that portal login (created once, saved)
 *   savedMethods(customerId)       → the login's saved cards + US bank accounts (display fields only)
 */
const { rest, enc, callerFromEvent, json } = require('./supa.cjs')
const { stripe } = require('./stripe.cjs')
const { methodSummary } = require('./payments.cjs')

async function portalCaller(event, clientId) {
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(String(clientId))) return { error: json(400, { error: 'clientId is required' }) }
  const user = await callerFromEvent(event)
  if (!user) return { error: json(401, { error: 'Please sign in again.' }) }
  const rows = await rest(`client_users?client_id=eq.${enc(clientId)}&auth_id=eq.${enc(user.id)}&select=*&limit=1`)
  const row = rows?.[0]
  if (!row) return { error: json(403, { error: 'Only the client can do this from their own portal login.' }) }
  const client = (await rest(`clients?id=eq.${enc(clientId)}&select=id,name,company,email&limit=1`))?.[0]
  if (!client) return { error: json(404, { error: 'Client not found' }) }
  return { user, row, client }
}

async function ensureCustomer(row, user, client) {
  if (row.stripe_customer_id) return row.stripe_customer_id
  const customer = await stripe('POST', '/customers', {
    email: user.email || client.email || undefined,
    name: client.company || client.name || undefined,
    metadata: { clientId: client.id, clientUserId: row.id, userId: user.id },
  }, { idempotencyKey: `customer-${row.id}` })
  // Only fill it if still empty, so two tabs can't leave two customers behind
  const saved = await rest(`client_users?id=eq.${enc(row.id)}&stripe_customer_id=is.null`, { method: 'PATCH', body: { stripe_customer_id: customer.id }, prefer: 'return=representation' })
  if (saved?.length) return customer.id
  const again = (await rest(`client_users?id=eq.${enc(row.id)}&select=stripe_customer_id&limit=1`))?.[0]
  return again?.stripe_customer_id || customer.id
}

async function savedMethods(customerId) {
  if (!customerId) return []
  const out = []
  for (const type of ['card', 'us_bank_account']) {
    try {
      const list = await stripe('GET', `/customers/${enc(customerId)}/payment_methods?type=${type}&limit=5`)
      for (const pm of list.data || []) out.push(methodSummary(pm))
    } catch { /* non-fatal: pay with a new method */ }
  }
  return out.filter(Boolean)
}

module.exports = { portalCaller, ensureCustomer, savedMethods }
