// Run: npm test — fixed-price item lines (estimate → invoice) vs hours lines
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hourLines, isItemLine, itemLineLabel, itemLinesFromEstimate, itemLinesSubtotal, lineAmount, makeItemLine } from '../src/utils/invoiceLines.ts'
import { payrollFromInvoiceItem } from '../src/utils/payroll.ts'
import type { Employee, InvoiceItem } from '../src/data/types.ts'

const hoursLine: InvoiceItem = { employeeId: 'e1', employeeName: 'Ana', hoursTotal: 7 + 20 / 60, rate: 12, basePayRate: 5, totalPay: 36.67, regularHours: 7 + 20 / 60, premiumHours: 0 }
const legacyLine: InvoiceItem = { employeeName: 'Ben', hoursTotal: 10, rate: 10 }   // no kind, no stored pay
const ana = { id: 'e1', name: 'Ana', payRate: 5 } as Employee

test('estimate lines become item lines; subtotal = Σ qty × price; blank rows skipped', () => {
  const items = itemLinesFromEstimate([
    { description: 'Onboarding and setup', qty: 1, unitPrice: 450 },
    { description: 'Demand package', qty: 3, unitPrice: 199.99 },
    { description: 'Half-day training', qty: 0.5, unitPrice: 300 },
    { description: '', qty: 0, unitPrice: 0 },
  ])
  assert.equal(items.length, 3)
  assert.ok(items.every(isItemLine))
  assert.ok(items.every(it => it.hoursTotal === 0 && it.employeeName === '' && !it.employeeId), 'item lines carry no hours and no employee')
  assert.equal(itemLinesSubtotal(items), 450 + 599.97 + 150)
  assert.equal(lineAmount(items[1]), 3 * 199.99)
  assert.equal(itemLineLabel(items[1]), 'Demand package · 3 × $199.99')
  assert.equal(itemLineLabel(makeItemLine('', 1, 1250)), 'Item · 1 × $1,250.00')
})

test('hours lines keep their old math; item subtotal ignores them', () => {
  assert.equal(isItemLine(legacyLine), false)
  assert.equal(isItemLine({ ...legacyLine, kind: 'hours' }), false)
  assert.equal(lineAmount(legacyLine), 100)
  const mixed = [hoursLine, makeItemLine('Setup', 2, 150), legacyLine]
  assert.equal(itemLinesSubtotal(mixed), 300)
  assert.equal(mixed.reduce((s, it) => s + lineAmount(it), 0), (7 + 20 / 60) * 12 + 300 + 100)
})

test('hours and payroll sums skip item lines', () => {
  const item = makeItemLine('Setup fee', 4, 250)
  const mixed = [hoursLine, item, legacyLine]
  assert.deepEqual(hourLines(mixed), [hoursLine, legacyLine])
  assert.deepEqual(hourLines(undefined), [])
  const hours = hourLines(mixed).reduce((s, it) => s + it.hoursTotal, 0)
  assert.equal(hours, 7 + 20 / 60 + 10)
  // Even when an item line reaches payroll code directly it pays nothing (the qty is not hours)
  const p = payrollFromInvoiceItem({ ...item, qty: 40, hoursTotal: 40 } as InvoiceItem, ana)
  assert.equal(p.totalPay, 0); assert.equal(p.totalHours, 0)
  assert.equal(payrollFromInvoiceItem(item, ana).totalPay, 0)
  // Hours lines are unchanged
  assert.equal(payrollFromInvoiceItem(hoursLine, ana).totalPay, 36.67)
  assert.equal(payrollFromInvoiceItem(legacyLine, { id: 'e2', name: 'Ben', payRate: 4 } as Employee).totalPay, 40)
  const pay = mixed.reduce((s, it) => s + payrollFromInvoiceItem(it, ana).totalPay, 0)
  assert.equal(Math.round(pay * 100) / 100, 36.67 + 50)
})

test('hours lines with a stored bill amount (night premium) use it as the line amount', () => {
  const it = { employeeName: 'Frankely', hoursTotal: 39.85, rate: 4.5, regularHours: 28.464, premiumHours: 11.386, premiumPercent: 15, billAmount: 187.01 }
  assert.equal(lineAmount(it), 187.01)
  assert.equal(lineAmount({ employeeName: 'A', hoursTotal: 10, rate: 5 }), 50)
})
