import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyPlan, normalizeRow, planSync, stable, type Row } from '../src/utils/syncPlan.ts'

const inv = (id: string, extra: Record<string, unknown> = {}) =>
  normalizeRow({ id, number: `INV-${id}`, status: 'draft', notes: '', items: [{ hours: 8, rate: 10 }], createdAt: 'x', ...extra })
const base = (...rows: Row[]) => new Map(rows.map(r => [r.id, r]))

test('normalizeRow: snake_case, drops created_at, "" and undefined become null', () => {
  assert.deepEqual(normalizeRow({ id: 'a', clientName: 'X', amountPaid: '', dueDate: undefined, createdAt: 5 }),
    { id: 'a', client_name: 'X', amount_paid: null, due_date: null })
})

test('stable: key order does not matter, nested too', () => {
  assert.equal(stable({ a: 1, b: { c: 2, d: [1, { e: 1, f: 2 }] } }), stable({ b: { d: [1, { f: 2, e: 1 }], c: 2 }, a: 1 }))
  assert.notEqual(stable([1, 2]), stable([2, 1]))
})

test('nothing changed → nothing written', () => {
  const b = base(inv('1'), inv('2'))
  const p = planSync(b, [inv('1'), inv('2')])
  assert.deepEqual(p, { inserts: [], updates: [], deletes: [] })
})

test('only the changed column of the changed record is updated', () => {
  const p = planSync(base(inv('1'), inv('2')), [inv('1'), inv('2', { notes: 'Call client' })])
  assert.deepEqual(p.updates, [{ patch: { notes: 'Call client' }, ids: ['2'] }])
  assert.deepEqual(p.inserts, []); assert.deepEqual(p.deletes, [])
})

test('a record someone else created after the page loaded is NOT deleted', () => {
  // the page loaded 1 and 2; the Sunday job then created 3 (not in this browser's baseline or list)
  const p = planSync(base(inv('1'), inv('2')), [inv('1'), inv('2', { status: 'sent' })])
  assert.deepEqual(p.deletes, [])
})

test('a record the page removed is deleted', () => {
  const p = planSync(base(inv('1'), inv('2')), [inv('1')])
  assert.deepEqual(p.deletes, ['2'])
})

test('someone else\'s change to another column survives (no full-row overwrite)', () => {
  // Stripe marked invoice 1 paid on the server; this page still has status "sent" and only edits the notes.
  const loaded = inv('1', { status: 'sent' })
  const p = planSync(base(loaded), [inv('1', { status: 'sent', notes: 'typo fixed' })])
  assert.deepEqual(p.updates, [{ patch: { notes: 'typo fixed' }, ids: ['1'] }])   // status is not sent → stays "paid"
})

test('new records are inserted without null columns (database defaults apply), grouped by columns', () => {
  const p = planSync(base(inv('1')), [inv('1'), inv('9', { notes: '' }), inv('8', { notes: 'x' })])
  assert.equal(p.inserts.length, 2)
  const nine = p.inserts.flat().find(r => r.id === '9')!
  assert.ok(!('notes' in nine))
  for (const g of p.inserts) assert.ok(g.every(r => Object.keys(r).sort().join() === Object.keys(g[0]).sort().join()))
})

test('the same change on many records is one update', () => {
  const b = base(inv('1'), inv('2'), inv('3'))
  const p = planSync(b, [inv('1', { status: 'paid' }), inv('2', { status: 'paid' }), inv('3', { status: 'sent' })])
  assert.equal(p.updates.length, 2)
  assert.deepEqual(p.updates.find(u => u.patch.status === 'paid')!.ids, ['1', '2'])
})

test('JSON columns compare by value', () => {
  const p = planSync(base(inv('1')), [normalizeRow({ ...inv('1'), items: [{ rate: 10, hours: 8 }] })])
  assert.deepEqual(p.updates, [])
  const q = planSync(base(inv('1')), [normalizeRow({ ...inv('1'), items: [{ rate: 10, hours: 9 }] })])
  assert.deepEqual(q.updates, [{ patch: { items: [{ rate: 10, hours: 9 }] }, ids: ['1'] }])
})

test('columns the page leaves out are never written (e.g. employee login link)', () => {
  const emp = normalizeRow({ id: 'e1', name: 'Ana', userId: 'u1' })
  const fromPage = normalizeRow({ id: 'e1', name: 'Ana P.' })                 // saveEmployees strips userId
  assert.deepEqual(planSync(base(emp), [fromPage]).updates, [{ patch: { name: 'Ana P.' }, ids: ['e1'] }])
})

test('scope: the general-expenses page can only delete general expenses', () => {
  const general = normalizeRow({ id: 'g1', projectId: null, amount: 5 })
  const project = normalizeRow({ id: 'p1', projectId: 'proj', amount: 9 })
  const p = planSync(base(general, project), [], r => r.project_id == null)
  assert.deepEqual(p.deletes, ['g1'])
})

test('never loaded the table → only inserts, never deletes', () => {
  const p = planSync(null, [inv('1')])
  assert.equal(p.inserts.flat().length, 1); assert.deepEqual(p.deletes, [])
})

test('duplicate ids in a list are written once', () => {
  const p = planSync(null, [inv('1'), inv('1', { notes: 'dup' })])
  assert.equal(p.inserts.flat().length, 1)
})

test('applyPlan: the baseline follows what was written', () => {
  const b = base(inv('1'), inv('2'))
  const rows = [inv('1', { notes: 'n' }), inv('3')]
  const p = planSync(b, rows)
  applyPlan(b, p, rows)
  assert.deepEqual([...b.keys()].sort(), ['1', '3'])
  assert.equal(b.get('1')!.notes, 'n')
  assert.equal(b.get('3')!.notes, null)                     // full normalized row kept, nulls included
  assert.deepEqual(planSync(b, rows), { inserts: [], updates: [], deletes: [] })
})

// ── LoadTracker: a save only deletes rows the page had ──
import { LoadTracker } from '../src/utils/syncPlan.ts'

test('stale page: invoices created later (and loaded elsewhere) are not deleted', () => {
  const t = new LoadTracker()
  const pageList = [{ id: '1' }, { id: '2' }]
  t.record('invoices', pageList)                                     // Invoices page loads at 9:00
  t.record('invoices', [{ id: '1' }, { id: '2' }, { id: 'new' }])    // Shell refreshes at 9:05: the Sunday job's invoice
  const next = pageList.filter(i => i.id !== '2')                    // the page deletes invoice 2
  const del = t.deletable('invoices', next)!
  assert.ok(del.has('2') && !del.has('new'))
  const b = new Map([['1', { id: '1' }], ['2', { id: '2' }], ['new', { id: 'new' }]] as [string, Row][])
  assert.deepEqual(planSync(b, next.map(r => normalizeRow(r)), undefined, del).deletes, ['2'])
})

test('after a save, the next save follows the saved list', () => {
  const t = new LoadTracker()
  const loaded = [{ id: '1' }, { id: '2' }]
  t.record('clients', loaded)
  const added = [...loaded, { id: '3' }]
  t.record('clients', added)                                          // successful save
  assert.deepEqual([...t.deletable('clients', added.filter(c => c.id !== '3'))!], ['1', '2', '3'])
})

test('every row rebuilt (bulk edit) → oldest load that holds them all', () => {
  const t = new LoadTracker()
  t.record('invoices', [{ id: '1' }, { id: '2' }])
  t.record('invoices', [{ id: '1' }, { id: '2' }, { id: 'late' }])
  const rebuilt = [{ id: '1', status: 'paid' }, { id: '2', status: 'paid' }]
  assert.ok(!t.deletable('invoices', rebuilt)!.has('late'))
})

test('tables are tracked separately; never-loaded table → null', () => {
  const t = new LoadTracker()
  const exp = [{ id: 'e1' }]
  t.record('expenses', exp)
  assert.equal(t.deletable('clients', exp), null)
})

test('emptied list (deleted the last row) → only rows every remembered load had', () => {
  const t = new LoadTracker()
  t.record('tasks', [{ id: 't1' }])
  assert.deepEqual([...t.deletable('tasks', [])!], ['t1'])
  t.record('tasks', [{ id: 't1' }, { id: 't2' }])          // another screen later sees a colleague's new task
  assert.deepEqual([...t.deletable('tasks', [])!], ['t1'])  // t2 is never deleted by the stale page
})

test('a record the page did not touch is never written back, even after another screen loaded a newer copy', () => {
  const t = new LoadTracker()
  const pageList = [{ id: '1', status: 'sent', notes: '' }, { id: '2', status: 'draft', notes: '' }]
  t.record('invoices', pageList)                                                 // Invoices page loads
  const newer = new Map([['1', normalizeRow({ id: '1', status: 'paid', notes: '' })], ['2', normalizeRow({ id: '2', status: 'draft', notes: '' })]] as [string, Row][])
  t.record('invoices', [{ id: '1', status: 'paid', notes: '' }, { id: '2', status: 'draft', notes: '' }])   // the dashboard reloads: Stripe marked #1 paid
  const next = pageList.map(i => (i.id === '2' ? { ...i, notes: 'call client' } : i))                       // the page edits only #2
  const plan = planSync(t.baseline('invoices', next, newer), next.map(r => normalizeRow(r)), undefined, t.deletable('invoices', next) ?? undefined)
  assert.deepEqual(plan.updates, [{ patch: { notes: 'call client' }, ids: ['2'] }])   // #1 stays "paid"
  assert.deepEqual(plan.deletes, [])
})

test('a field changed in place on the loaded object is still saved (compared with the loaded copy)', () => {
  const t = new LoadTracker()
  const list = [{ id: '1', status: 'sent' }]
  t.record('invoices', list)
  list[0].status = 'paid'                                                         // mutated in place
  const plan = planSync(t.baseline('invoices', list, null), list.map(r => normalizeRow(r)), undefined, t.deletable('invoices', list) ?? undefined)
  assert.deepEqual(plan.updates, [{ patch: { status: 'paid' }, ids: ['1'] }])
})

// Helper: plan a save the way storage.ts does, then record it
function save(t: LoadTracker, table: string, items: object[], fallback: Map<string, Row> | null = null) {
  const rows = items.map(r => normalizeRow(r as Record<string, unknown>))
  const plan = planSync(t.baseline(table, items, fallback), rows, undefined, t.deletable(table, items) ?? undefined)
  t.recordSave(table, items, plan)
  return plan
}

test('a stale copy edited inside a fresh list only writes its own change (no undoing a payment)', () => {
  const t = new LoadTracker()
  const pageList = [{ id: 'I1', status: 'sent', amountPaid: 0, notes: '' }]
  t.record('invoices', pageList)                                   // Invoices page loads
  const editing = pageList[0]
  const fresh = [{ id: 'I1', status: 'paid', amountPaid: 500, notes: '' }]
  t.record('invoices', fresh)                                      // builder reloads just before saving: paid meanwhile
  const inv = { ...editing, notes: 'typo fixed' }                  // built from the stale copy
  const plan = save(t, 'invoices', fresh.map(i => (i.id === inv.id ? inv : i)))
  assert.deepEqual(plan.updates, [{ patch: { notes: 'typo fixed' }, ids: ['I1'] }])
})

test('changing a field back to its original value is saved (copied rows, two saves)', () => {
  const t = new LoadTracker()
  const loaded = [{ id: 'e1', active: true }]
  t.record('employees', loaded)
  const off = loaded.map(e => ({ ...e, active: false }))
  assert.deepEqual(save(t, 'employees', off.map(e => ({ ...e }))).updates, [{ patch: { active: false }, ids: ['e1'] }])
  const on = off.map(e => ({ ...e, active: true }))                 // page still holds the pre-save copy
  assert.deepEqual(save(t, 'employees', on.map(e => ({ ...e }))).updates, [{ patch: { active: true }, ids: ['e1'] }])
})

test('rows rebuilt from scratch (no tag) still save a change back', () => {
  const t = new LoadTracker()
  t.record('invoice_templates', [{ id: 'x', name: 'A' }])
  assert.deepEqual(save(t, 'invoice_templates', [{ id: 'x', name: 'B' }]).updates, [{ patch: { name: 'B' }, ids: ['x'] }])
  assert.deepEqual(save(t, 'invoice_templates', [{ id: 'x', name: 'A' }]).updates, [{ patch: { name: 'A' }, ids: ['x'] }])
})

test('the load tag never reaches the database row', () => {
  const t = new LoadTracker()
  const list = [{ id: '1', a: 1 }]
  t.record('x', list)
  assert.deepEqual(Object.keys(normalizeRow({ ...list[0] })), ['id', 'a'])
  assert.equal(JSON.stringify({ ...list[0] }), '{"id":"1","a":1}')
})
