import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertOldCrmBackup, hmToHours, invoiceHoursFormat, stableUuid } from '../src/utils/oldCrm.ts'

test('hours.minutes: "39.51" is 39 h 51 min; decimals and h:mm still read right', () => {
  assert.equal(Math.round(hmToHours('39.51') * 1000) / 1000, 39.85)
  assert.equal(hmToHours('8'), 8)
  assert.equal(hmToHours('7:45'), 7.75)
  assert.equal(hmToHours('38.75'), 38.75)        // minutes can't be 75 → it was a decimal
  assert.equal(hmToHours('13.583333'), 13.583333)
})

test('each invoice keeps the format its own total says it used', () => {
  const hm = { date: '2026-10-19', subtotal: 179.33, items: [{ hoursTotal: '39.51', rate: 4.5 }] }       // 39h51m × 4.5 = 179.33
  const dec = { date: '2026-03-02', subtotal: 177.8, items: [{ hoursTotal: '39.51', rate: 4.5 }] }       // 39.51 × 4.5 = 177.80
  const whole = { date: '2026-03-02', subtotal: 180, items: [{ hoursTotal: '40', rate: 4.5 }] }
  assert.equal(invoiceHoursFormat(hm), 'hm')
  assert.equal(invoiceHoursFormat(dec), 'decimal')
  assert.equal(invoiceHoursFormat(whole), 'whole')
  assert.equal(invoiceHoursFormat({ date: '2026-03-02', subtotal: 1, items: [{ hoursTotal: '38.75', rate: 1 }] }), 'decimal')
})

test('old short ids become the same UUID every time; UUIDs are kept', async () => {
  const a = await stableUuid('mn2vlzpdbm0oxl')
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(await stableUuid('mn2vlzpdbm0oxl'), a)
  assert.equal(await stableUuid('E246B709-1B91-45C5-ABB6-E9EE5310566B'), 'e246b709-1b91-45c5-abb6-e9ee5310566b')
})

test('a backup converts with its links intact, statuses fixed and totals untouched', async () => {
  const b = {
    employees: [{ id: 'emp1', name: 'Ana', employeeNumber: 'YVA26004', status: 'Active', attachments: null, hireYear: '2024' },
                { id: 'emp2', name: 'Luis', employeeNumber: 'YVA26004', status: 'Active' }],
    clients: [{ id: 'cli1', name: 'Halavi Law' }],
    projects: [{ id: 'prj1', name: 'VA', clientId: 'cli1', employeeIds: ['emp1'], billingModel: 'Hourly', assignments: [{ employeeId: 'emp1', billRate: 5 }] }],
    invoices: [{ id: 'inv1', number: 'HLVA0001', date: '2026-10-19', clientName: 'halavi law', projectId: 'prj1', status: 'Paid', subtotal: 187.01,
      items: [{ employeeId: 'emp1', employeeName: 'Ana', hoursTotal: '39.51', rate: 4.5, premiumHours: 11.386, regularHours: 28.464, premiumPercent: 15, billAmount: 187.01,
                daily: { '2026-10-19': '8.00', '2026-10-21': '7.51' } }],
      employeePayments: { emp1: { status: 'paid' } } },
      { id: 'inv2', number: 'X1', date: '2026-01-01', clientName: 'Gone Co', status: 'sent', subtotal: 10, items: [{ employeeId: 'oldguy', employeeName: 'Oven', hoursTotal: '2', rate: 5 }] }],
    candidates: [{ id: 'k1', name: 'Pia', attachments: [{ id: 'a', name: 'cv.pdf', mimeType: 'application/pdf', size: 3, dataUrl: 'data:application/pdf;base64,AAA=', uploadedAt: 1 },
      { id: 'b', name: 'v.mkv', mimeType: 'video/x', size: 9, dataUrl: 'https://old.supabase.co', storageUrl: 'https://old.supabase.co/storage/v1/object/public/attachments/x.mkv', uploadedAt: 1 }] }],
    invoiceCounter: 7,
  }
  const c = await convertOldCrmBackup(b, 'new.supabase.co')
  const emp1 = await stableUuid('emp1'), cli1 = await stableUuid('cli1'), prj1 = await stableUuid('prj1')
  assert.equal(c.employees[0].id, emp1)
  assert.equal(c.employees[0].startYear, '2024')
  assert.deepEqual(c.employees[0].attachments, [])
  assert.equal(c.projects[0].clientId, cli1)
  assert.deepEqual(c.projects[0].employeeIds, [emp1])
  assert.equal(c.projects[0].billingModel, 'hourly')
  assert.equal((c.projects[0].assignments as { employeeId: string }[])[0].employeeId, emp1)
  const inv = c.invoices[0] as any
  assert.equal(inv.status, 'paid'); assert.equal(inv.clientId, cli1); assert.equal(inv.projectId, prj1)
  assert.equal(inv.subtotal, 187.01)
  assert.equal(inv.items[0].hoursTotal, 39.85)
  assert.equal(inv.items[0].billAmount, 187.01)
  assert.deepEqual(inv.items[0].daily, { '2026-10-19': '8:00', '2026-10-21': '7:51' })
  assert.equal(inv.items[0].employeeId, emp1)
  assert.deepEqual(Object.keys(inv.employeePayments), [emp1])
  assert.equal(c.summary.statusesFixed, 1)
  assert.deepEqual(c.summary.formerStaff, ['Oven'])
  assert.deepEqual(c.summary.invoicesWithoutClient, ['X1'])
  assert.deepEqual(c.summary.duplicateEmployeeNumbers, ['YVA26004'])
  assert.deepEqual(c.files.map(f => f.kind), ['inline', 'copy'])
  assert.equal((c.candidates[0].attachments as any[])[1].dataUrl, '')       // the junk "dataUrl" of linked files is cleared
  assert.equal(c.employeeCounter, Number(String(new Date().getFullYear()).slice(2)) === 26 ? 5 : null)
  assert.equal(c.invoiceCounter, 7)
  const again = await convertOldCrmBackup(b, 'new.supabase.co')
  assert.equal(again.invoices[0].id, c.invoices[0].id)
})
