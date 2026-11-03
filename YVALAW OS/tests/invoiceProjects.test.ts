// Run: npm test — one invoice covering several projects of the same client (utils/invoiceProjects.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clientNumberPreview, extraProjectCount, invoiceCoversProject, invoiceProjectIds, isMultiProject, lineBill,
  linesByProject, projectFraction, projectNamesLabel, projectShareOf, projectShares,
} from '../src/utils/invoiceProjects.ts'
import { lineAmount } from '../src/utils/invoiceLines.ts'
import type { Invoice, InvoiceItem } from '../src/data/types.ts'

const single: Invoice = { id: 'a', number: 'IT0003', projectId: 'p1', projectName: 'Intake Team', subtotal: 300,
  items: [{ employeeName: 'Ana', hoursTotal: 10, rate: 12 }, { employeeName: 'Ben', hoursTotal: 15, rate: 12 }] }
const byName: Invoice = { id: 'b', number: 'OLD1', projectId: null, projectName: 'Intake Team', subtotal: 50, items: [] }
const multi: Invoice = { id: 'c', number: 'HAL-0007', projectId: 'p1', projectName: 'Intake Team', projectIds: ['p1', 'p2'], subtotal: 274.5, amountPaid: 100, status: 'partial',
  items: [
    { employeeId: 'e1', employeeName: 'Ana', hoursTotal: 10, rate: 12, billAmount: 120, projectId: 'p1', projectName: 'Intake Team' },
    { employeeId: 'e2', employeeName: 'Ben', hoursTotal: 7.5, rate: 18, billAmount: 135, projectId: 'p2', projectName: 'Demand Desk' },
    { kind: 'item', description: 'Setup', qty: 1, rate: 19.5, employeeName: '', hoursTotal: 0 },   // item line → main project
  ] }

test('single-project invoices: one project, the whole invoice — exactly as before', () => {
  assert.deepEqual(invoiceProjectIds(single), ['p1'])
  assert.equal(isMultiProject(single), false)
  assert.equal(extraProjectCount(single), 0)
  assert.deepEqual(projectShares(single), [{ projectId: 'p1', projectName: 'Intake Team', amount: 300, hours: 25, lines: 2 }])
  assert.equal(projectShareOf(single, { id: 'p1', name: 'Intake Team' })?.amount, 300)
  assert.equal(projectShareOf(single, { id: 'p2', name: 'Demand Desk' }), null)
  assert.equal(projectFraction(single, { id: 'p1' }), 1)
  assert.equal(linesByProject(single).length, 1)
})

test('older invoices matched by project name still count for that project', () => {
  assert.equal(invoiceCoversProject(byName, { id: 'p1', name: 'Intake Team' }), true)
  assert.equal(projectShareOf(byName, { id: 'p1', name: 'Intake Team' })?.amount, 50)
  assert.equal(invoiceCoversProject(byName, { id: 'p1' }), false)   // the portal matches by id only
})

test('multi-project: every project listed, main first, +1 tag, covered by each', () => {
  assert.deepEqual(invoiceProjectIds(multi), ['p1', 'p2'])
  assert.equal(isMultiProject(multi), true)
  assert.equal(extraProjectCount(multi), 1)
  assert.equal(invoiceCoversProject(multi, { id: 'p2', name: 'Demand Desk' }), true)
  assert.equal(invoiceCoversProject(multi, { id: 'p3', name: 'Other' }), false)
  assert.equal(projectNamesLabel(multi), 'Intake Team + Demand Desk')
})

test('multi-project: totals split by line, adding up to the invoice (never counted twice)', () => {
  const sh = projectShares(multi)
  assert.deepEqual(sh.map(s => [s.projectId, s.amount, s.hours, s.lines]), [['p1', 139.5, 10, 2], ['p2', 135, 7.5, 1]])
  assert.equal(sh.reduce((s, x) => s + x.amount, 0), 274.5)
  assert.equal(projectShareOf(multi, { id: 'p2' })?.amount, 135)
  assert.equal(Math.round(projectFraction(multi, { id: 'p2' }) * 1000) / 1000, Math.round(135 / 274.5 * 1000) / 1000)
})

test('a difference between the lines and the stored total stays on the main project', () => {
  const odd = { ...multi, subtotal: 275 }
  const sh = projectShares(odd)
  assert.equal(sh[0].amount, 140)
  assert.equal(sh[1].amount, 135)
})

test('project list without lines on a project, and lines naming a project missing from the list', () => {
  const listed: Invoice = { ...single, projectIds: ['p1', 'p9'] }
  assert.equal(isMultiProject(listed), true)
  assert.deepEqual(projectShares(listed).map(s => s.projectId), ['p1'])   // p9 has no lines → no 0 row
  assert.equal(projectShareOf(listed, { id: 'p9' })?.amount, 0)
  const fromLines: Invoice = { ...multi, projectIds: null }
  assert.deepEqual(invoiceProjectIds(fromLines), ['p1', 'p2'])
  assert.equal(projectShares(fromLines, id => (id === 'p2' ? 'Looked up' : undefined))[1].projectName, 'Demand Desk')
})

test('PDF groups: lines by project in order of first appearance', () => {
  const g = linesByProject(multi)
  assert.deepEqual(g.map(x => [x.projectId, x.projectName, x.items.length]), [['p1', 'Intake Team', 2], ['p2', 'Demand Desk', 1]])
})

test('lineBill agrees with invoiceLines.lineAmount', () => {
  const lines: InvoiceItem[] = [...(multi.items || []), { employeeName: 'X', hoursTotal: 3.5, rate: 10 }, { employeeName: 'Y', hoursTotal: 1, rate: 10, billAmount: 11.5 }]
  for (const l of lines) assert.equal(lineBill(l), lineAmount(l))
})

test('client numbering preview: PREFIX-0001, never below a number already used', () => {
  assert.equal(clientNumberPreview('hal', 3, ['HAL-0001', 'HAL-0002']), 'HAL-0003')
  assert.equal(clientNumberPreview('HAL', 2, ['HAL-0009', 'HALX-0100', 'IT0003']), 'HAL-0010')
  assert.equal(clientNumberPreview('', 5, []), null)
  assert.equal(clientNumberPreview('A.B', null, ['A.B-0004', 'AXB-0099']), 'A.B-0005')
})
