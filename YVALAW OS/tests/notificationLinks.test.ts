import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applicantName, invoiceNumber, isSpecific, leadName, paydayForNotice, weekForNotice } from '../src/lib/notificationLinks.ts'

test('links that already name a record are used as they are; old list-only links are not', () => {
  for (const l of ['/candidates/abc', '/leads?open=1', '/invoice?open=x', '/approvals?open=r1', '/weekly-close?week=2026-10-26', '/payroll?payday=2026-11-06', '/me?s=pay', '/settings?tab=notifications', '/clients/c1'])
    assert.equal(isSpecific(l), true, l)
  for (const l of ['/candidates', '/leads', '/invoice', '/approvals', '/weekly-close', '/payroll', '/settings', '/leads/'])
    assert.equal(isSpecific(l), false, l)
  assert.equal(isSpecific(null), false)
})

test('names and invoice numbers are read back from the titles the server writes', () => {
  assert.equal(applicantName('New application: Ana Pérez — Legal Assistant'), 'Ana Pérez')
  assert.equal(applicantName('New application: Ana Pérez'), 'Ana Pérez')
  assert.equal(leadName('New lead: Joe Smith (Smith Law)'), 'Joe Smith')
  assert.equal(leadName('New lead: Joe Smith'), 'Joe Smith')
  assert.equal(leadName('A lead was assigned to you: Mary (Ann) Lee'), 'Mary (Ann) Lee')
  assert.equal(leadName('Payment received: $20.00'), null)
  assert.equal(invoiceNumber('AutoPay failed: invoice HAL-0007'), 'HAL-0007')
  assert.equal(invoiceNumber('Invoice INV-012 overpaid by $5.00'), 'INV-012')
  assert.equal(invoiceNumber('Payment pi_1 for invoice FNPR0003 was not in USD.'), 'FNPR0003')
  assert.equal(invoiceNumber('Paid by card through Stripe.'), null)
  assert.equal(invoiceNumber('the invoice balance was updated'), null)
})

test('weekly close (Monday) opens the week that just ended; payroll (Wednesday) that Friday', () => {
  const mon = Date.parse('2026-11-02T04:10:00Z')    // Monday 12:10 am Dominican time
  assert.equal(weekForNotice(mon), '2026-10-26')
  const wed = Date.parse('2026-11-04T13:07:00Z')    // Wednesday 9:07 am Dominican time
  assert.equal(paydayForNotice(wed), '2026-11-06')
})
