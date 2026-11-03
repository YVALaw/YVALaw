// Run: npm test — Invoices page bulk actions: email / delete plans, summaries, CSV export, the .zip writer
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bulkDeletePlan, bulkEmailPlan, deleteSummary, emailSummary, invoiceBalance, invoiceCsvRows, INVOICE_CSV_HEADERS } from '../src/utils/invoiceBulk.ts'
import { parseCsv, toCsv } from '../src/utils/csv.ts'
import { base64ToBytes, crc32, makeZip, uniqueNames } from '../src/utils/zip.ts'
import type { Invoice } from '../src/data/types.ts'

const inv = (o: Partial<Invoice>): Invoice => ({ id: o.number || 'x', number: 'X', ...o })
const list = [
  inv({ id: '1', number: 'HAL-0001', status: 'sent', clientEmail: 'ap@halavi.com', subtotal: 100 }),
  inv({ id: '2', number: 'HAL-0002', status: 'draft', clientEmail: 'ap@halavi.com', subtotal: 50 }),
  inv({ id: '3', number: 'KL-0001', status: 'overdue', clientEmail: '  ', subtotal: 70 }),
  inv({ id: '4', number: 'HAL-0003', status: 'partial', clientEmail: 'ap@halavi.com', subtotal: 200, amountPaid: 80 }),
  inv({ id: '5', number: 'HAL-0004', status: 'paid', clientEmail: 'ap@halavi.com', subtotal: 90, amountPaid: 90 }),
]

test('email plan: drafts and invoices without an email are skipped', () => {
  const p = bulkEmailPlan(list)
  assert.deepEqual(p.send.map(i => i.id), ['1', '4', '5'])
  assert.deepEqual(p.drafts.map(i => i.id), ['2'])
  assert.deepEqual(p.noEmail.map(i => i.id), ['3'])
})

test('email summary reads like "Emailed 5 · skipped 2 (no email)"', () => {
  assert.equal(emailSummary({ sent: 5, noEmail: 2, drafts: 0, failed: 0 }), 'Emailed 5 · skipped 2 (no email)')
  assert.equal(emailSummary({ sent: 3, noEmail: 0, drafts: 1, failed: 1, notReached: 2 }), 'Emailed 3 · skipped 1 draft (use Send) · 1 failed · 2 not sent (stopped)')
  assert.equal(emailSummary({ sent: 2, noEmail: 0, drafts: 0, failed: 0 }), 'Emailed 2')
})

test('delete plan: invoices with payment rows or an amount paid are kept and named', () => {
  const p = bulkDeletePlan(list, new Set(['1']))
  assert.deepEqual(p.remove.map(i => i.id), ['2', '3'])
  assert.deepEqual(p.paid.map(i => i.id), ['1', '4', '5'])
  assert.equal(deleteSummary(2, p.paid), 'Deleted 2 · kept 3 with payments (HAL-0001, HAL-0003, HAL-0004)')
  assert.equal(deleteSummary(4, []), 'Deleted 4')
})

test('balance: paid → 0, partial → total − paid', () => {
  assert.equal(invoiceBalance(list[3]), 120)
  assert.equal(invoiceBalance(list[4]), 0)
  assert.equal(invoiceBalance(inv({ status: 'sent', subtotal: 10.005, amountPaid: 0 })), 10.01)
})

test('CSV export: the agreed columns, money to the cent, multi-project names, safe quoting', () => {
  const rows = invoiceCsvRows([
    inv({ number: 'HAL-0007', clientName: 'Halavi, "Law"', projectName: 'Intake', billingStart: '2026-10-26', billingEnd: '2026-11-01', date: '2026-11-02', dueDate: '2026-11-09', status: 'partial', subtotal: 2520, amountPaid: 1260 }),
    inv({ number: 'INV-6', clientName: '=HYPERLINK("x")', status: 'paid', subtotal: 90 }),
  ], i => (i.number === 'HAL-0007' ? 'Intake + Demand' : i.projectName || ''))
  assert.deepEqual(rows[0], INVOICE_CSV_HEADERS)
  assert.deepEqual(rows[0], ['Number', 'Client', 'Project', 'Period', 'Date', 'Due date', 'Status', 'Amount (USD)', 'Paid (USD)', 'Balance (USD)'])
  assert.deepEqual(rows[1], ['HAL-0007', 'Halavi, "Law"', 'Intake + Demand', '2026-10-26 – 2026-11-01', '2026-11-02', '2026-11-09', 'Partial', '2520.00', '1260.00', '1260.00'])
  assert.deepEqual(rows[2].slice(6), ['Paid', '90.00', '90.00', '0.00'])   // paid without an amount recorded → paid in full
  const text = toCsv(rows)
  assert.ok(text.startsWith('﻿"Number","Client"'))
  const back = parseCsv(text)
  assert.equal(back[1][1], 'Halavi, "Law"')
  assert.equal(back[2][1], `'=HYPERLINK("x")`)   // a formula is never run by a spreadsheet
  assert.equal(parseCsv(toCsv([['-12.50', '-x', '+1']]))[0].join('|'), `-12.50|'-x|'+1`)
})

test('zip: CRC-32 check value and a readable stored archive', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926)
  const a = new TextEncoder().encode('%PDF-1.4 one'), b = new TextEncoder().encode('%PDF-1.4 two!')
  const z = makeZip([{ name: 'Invoice-A.pdf', data: a }, { name: 'Invoice-A.pdf', data: b }], new Date(2026, 10, 3, 10, 30))
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
  assert.equal(dv.getUint32(0, true), 0x04034b50)                       // first local header
  const end = z.length - 22
  assert.equal(dv.getUint32(end, true), 0x06054b50)                     // end of central directory
  assert.equal(dv.getUint16(end + 10, true), 2)                         // 2 entries
  const cd = dv.getUint32(end + 16, true)
  assert.equal(dv.getUint32(cd, true), 0x02014b50)
  assert.equal(dv.getUint32(cd + 16, true), crc32(a))
  const names: string[] = []
  let at = cd
  for (let i = 0; i < 2; i++) {
    const n = dv.getUint16(at + 28, true)
    names.push(new TextDecoder().decode(z.subarray(at + 46, at + 46 + n)))
    const off = dv.getUint32(at + 42, true), size = dv.getUint32(at + 20, true), ln = dv.getUint16(off + 26, true)
    assert.deepEqual([...z.subarray(off + 30 + ln, off + 30 + ln + size)], [...(i === 0 ? a : b)])
    at += 46 + n
  }
  assert.deepEqual(names, ['Invoice-A.pdf', 'Invoice-A (2).pdf'])     // same number twice → never overwritten
})

test('zip helpers: unique, safe file names and base64 → bytes', () => {
  assert.deepEqual(uniqueNames(['a/b.pdf', 'A-B.pdf', 'x']), ['a-b.pdf', 'A-B (2).pdf', 'x'])
  assert.deepEqual([...base64ToBytes(Buffer.from('hi!').toString('base64'))], [104, 105, 33])
})
