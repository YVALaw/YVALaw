import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { billingName } = require('../netlify/functions/_lib/weekclose.cjs')

test('weekly-close invoices are made out to the company, not the contact person', () => {
  assert.equal(billingName({ name: 'Sean Mahbobian-Fard', company: 'Top Law Assist' }), 'Top Law Assist')
  assert.equal(billingName({ name: 'Halavi Law', company: '  ' }), 'Halavi Law')
  assert.equal(billingName({ name: 'Halavi Law' }), 'Halavi Law')
  assert.equal(billingName({ name: '' }), 'Client')
})

test('builder / quick / estimate invoices use the same name rule, and find their client again', async () => {
  const { billingName: bn, clientOfInvoice } = await import('../src/utils/billingName.ts')
  assert.equal(bn({ name: 'Sean Mahbobian-Fard', company: 'Top Law Assist' }), 'Top Law Assist')
  assert.equal(bn({ name: 'Halavi Law', company: null }), 'Halavi Law')
  assert.equal(bn(undefined), '')
  const clients = [{ id: 'c1', name: 'Sean Mahbobian-Fard', company: 'Top Law Assist' }, { id: 'c2', name: 'Halavi Law' }]
  assert.equal(clientOfInvoice(clients, { clientId: 'c2', clientName: 'Whatever' })?.id, 'c2')
  assert.equal(clientOfInvoice(clients, { clientName: 'Top Law Assist' })?.id, 'c1')
  assert.equal(clientOfInvoice(clients, { clientName: 'Sean Mahbobian-Fard' })?.id, 'c1')
  assert.equal(clientOfInvoice(clients, { clientName: 'Nobody' }), undefined)
})
