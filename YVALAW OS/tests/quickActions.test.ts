// Clients quick actions, Team CSV export, Team board drag & drop (2026-11): the pure parts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, parseCsv, toCsv } from '../src/utils/csv.ts'
import { TEAM_CSV_HEADER, teamCsvFileName, teamCsvRows } from '../src/utils/teamCsv.ts'
import { applyTeamDrop, changedProjectIds, dropChoices } from '../src/utils/teamAssign.ts'
import { oldestOpenInvoice, soleRunningProject, telHref } from '../src/utils/clientQuickActions.ts'
import type { Client, Employee, Invoice, Project } from '../src/data/types.ts'

test('CSV writer: quoting, doubled quotes, line breaks, edge spaces', () => {
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a, b'), '"a, b"')
  assert.equal(csvCell('he said "hi"'), '"he said ""hi"""')
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"')
  assert.equal(csvCell(' padded'), '" padded"')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(12.5), '12.5')
})

test('CSV writer: formulas are neutralised, numbers and phone numbers are not', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`)
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(csvCell('+cmd|calc'), "'+cmd|calc")
  assert.equal(csvCell('-2+3+cmd'), "'-2+3+cmd")
  assert.equal(csvCell('+1 (617) 555-0188'), '+1 (617) 555-0188')
  assert.equal(csvCell('-12.5'), '-12.5')
})

test('CSV writer: round-trips through the reader (BOM, CRLF, accents)', () => {
  const rows = [['Name', 'Notes'], ['Ana Pérez', 'x, "y"\nz'], ['José', '']]
  const text = toCsv(rows)
  assert.ok(text.startsWith('﻿'))
  assert.ok(text.endsWith('\r\n'))
  assert.deepEqual(parseCsv(text), [['Name', 'Notes'], ['Ana Pérez', 'x, "y"\nz'], ['José', '']])
  assert.ok(!toCsv(rows, { bom: false }).startsWith('﻿'))
})

const clients = [{ id: 'c1', name: 'Halavi Law' }, { id: 'c2', name: 'FoodNet PR' }] as Client[]
const projects = [
  { id: 'p1', name: 'Intake', clientId: 'c1', status: 'active', employeeIds: ['e1', 'e2'] },
  { id: 'p2', name: 'Front desk', clientId: 'c2', status: 'active', employeeIds: ['e1'] },
  { id: 'p3', name: 'Old', clientId: 'c2', status: 'completed', employeeIds: [] },
] as Project[]

test('Team CSV: allow-listed columns only, never pay / bank / notes / attachments', () => {
  const emps = [
    { id: 'e1', name: 'Ana Pérez', employeeNumber: 'YVA26001', email: 'ana@x.com', phone: '+1 809 555 0101', role: 'Intake, bilingual', worksFor: 'client', status: 'Active',
      hireDate: '2025-03-01', location: 'Santo Domingo', payRate: 6.5, premiumPercent: 15, notes: 'SECRET NOTE', ccEmails: ['boss@x.com'],
      attachments: [{ id: 'a', name: 'cedula.pdf', mimeType: 'application/pdf', size: 1, dataUrl: '', uploadedAt: 1 }] },
    { id: 'e3', name: 'Luis', worksFor: 'yva', startYear: 2024 },
  ] as unknown as Employee[]
  const rows = teamCsvRows(emps, projects, clients, e => (e.worksFor === 'yva' ? 'Weekly' : 'Bi-weekly'))
  assert.deepEqual(rows[0], [...TEAM_CSV_HEADER])
  assert.deepEqual(rows[1], ['YVA26001', 'Ana Pérez', 'ana@x.com', '+1 809 555 0101', 'Intake, bilingual', 'Client project', 'Active', 'Front desk (FoodNet PR); Intake (Halavi Law)', '2025-03-01', 'Santo Domingo', 'Bi-weekly'])
  assert.deepEqual(rows[2], ['', 'Luis', '', '', '', 'YVA team', 'Active', '', '2024', '', 'Weekly'])
  const text = toCsv(rows)
  for (const secret of ['6.5', 'SECRET', 'boss@x.com', 'cedula', '15']) assert.ok(!text.includes(secret), `${secret} must not be exported`)
  assert.ok(!TEAM_CSV_HEADER.some(h => /pay rate|rate|bank|paypal|note|attach/i.test(h)))
  assert.equal(teamCsvFileName(new Date(2026, 10, 3)), 'team-2026-11-03.csv')
})

test('Team board: move takes the person off the source lane and onto the target', () => {
  const next = applyTeamDrop(projects, 'e2', 'p1', 'p2', 'move')
  assert.deepEqual(next.find(p => p.id === 'p1')!.employeeIds, ['e1'])
  assert.deepEqual(next.find(p => p.id === 'p2')!.employeeIds, ['e1', 'e2'])
  assert.equal(next[2], projects[2], 'untouched projects keep the same object (not saved)')
  assert.deepEqual(changedProjectIds(projects, next), ['p1', 'p2'])
  assert.deepEqual(projects[0].employeeIds, ['e1', 'e2'], 'input not mutated')
})

test('Team board: "also add" keeps the source; Unassigned removes from the source only; no duplicates', () => {
  const add = applyTeamDrop(projects, 'e2', 'p1', 'p2', 'add')
  assert.deepEqual(add.find(p => p.id === 'p1')!.employeeIds, ['e1', 'e2'])
  assert.deepEqual(add.find(p => p.id === 'p2')!.employeeIds, ['e1', 'e2'])
  assert.deepEqual(changedProjectIds(projects, add), ['p2'])
  const off = applyTeamDrop(projects, 'e1', 'p1', null, 'move')
  assert.deepEqual(off.find(p => p.id === 'p1')!.employeeIds, ['e2'])
  assert.deepEqual(off.find(p => p.id === 'p2')!.employeeIds, ['e1'], 'other projects keep them')
  // e1 already on p2: move from p1 → only leaves p1, never listed twice on p2
  const already = applyTeamDrop(projects, 'e1', 'p1', 'p2', 'move')
  assert.deepEqual(already.find(p => p.id === 'p2')!.employeeIds, ['e1'])
  assert.deepEqual(already.find(p => p.id === 'p1')!.employeeIds, ['e2'])
  // from Unassigned
  const fromNone = applyTeamDrop(projects, 'e9', null, 'p3', 'move')
  assert.deepEqual(fromNone.find(p => p.id === 'p3')!.employeeIds, ['e9'])
  assert.deepEqual(changedProjectIds(projects, fromNone), ['p3'])
  // same lane: nothing changes
  assert.deepEqual(changedProjectIds(projects, applyTeamDrop(projects, 'e1', 'p1', 'p1', 'move')), [])
})

test('Team board: drop choices', () => {
  assert.deepEqual(dropChoices(projects, 'e2', 'p1', 'p2'), { move: true, add: true, remove: false })
  assert.deepEqual(dropChoices(projects, 'e1', 'p1', 'p2'), { move: true, add: false, remove: false }, 'already on the target: only move')
  assert.deepEqual(dropChoices(projects, 'e1', 'p1', null), { move: false, add: false, remove: true })
  assert.deepEqual(dropChoices(projects, 'e9', null, 'p2'), { move: false, add: true, remove: false })
  assert.equal(dropChoices(projects, 'e1', 'p1', 'p1'), null)
  assert.equal(dropChoices(projects, 'e9', null, null), null)
  assert.equal(dropChoices(projects, 'e1', null, 'p2'), null, 'from Unassigned onto a project they are already on')
  assert.equal(dropChoices(projects, 'e1', 'p1', 'nope'), null)
})

test('Client quick actions: oldest open invoice (by client id or name, sent with a balance)', () => {
  const c = { id: 'c1', name: 'Halavi Law' } as Client
  const inv = (o: Partial<Invoice>) => ({ id: o.number, number: 'X', subtotal: 100, ...o }) as Invoice
  const list = [
    inv({ number: 'HAL-3', clientId: 'c1', status: 'sent', date: '2026-10-20' }),
    inv({ number: 'HAL-1', clientName: 'Halavi Law', status: 'overdue', date: '2026-09-01' }),
    inv({ number: 'HAL-0', clientId: 'c1', status: 'draft', date: '2026-08-01' }),
    inv({ number: 'HAL-P', clientId: 'c1', status: 'paid', date: '2026-07-01' }),
    inv({ number: 'HAL-Z', clientId: 'c1', status: 'partial', date: '2026-06-01', amountPaid: 100 }),
    inv({ number: 'FN-1', clientId: 'c2', clientName: 'FoodNet PR', status: 'sent', date: '2026-01-01' }),
  ]
  assert.equal(oldestOpenInvoice(c, list)?.number, 'HAL-1')
  assert.equal(oldestOpenInvoice(c, list.filter(i => i.number !== 'HAL-1'))?.number, 'HAL-3')
  assert.equal(oldestOpenInvoice({ id: 'c3', name: 'Nobody' } as Client, list), null)
})

test('Client quick actions: tel: links and the sole running project', () => {
  assert.equal(telHref('+1 (617) 555-0188'), 'tel:+16175550188')
  assert.equal(telHref('809-555-0101 ext 22'), 'tel:8095550101')
  assert.equal(telHref(''), null)
  assert.equal(telHref('n/a'), null)
  assert.equal(soleRunningProject(projects, 'c1')?.id, 'p1')
  assert.equal(soleRunningProject(projects, 'c2')?.id, 'p2', 'completed projects do not count')
  assert.equal(soleRunningProject([...projects, { id: 'p4', name: 'B', clientId: 'c1' } as Project], 'c1'), null, 'two running → ask')
  assert.equal(soleRunningProject(projects, 'c9'), null)
})
