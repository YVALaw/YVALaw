// Repeating expenses: date rules (browser src/utils/recurringExpenses.ts = server _lib/recurringExpenses.cjs)
// and the daily expenses-recurring function against the fake Supabase.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as web from '../src/utils/recurringExpenses.ts'
import { FakeBackend } from './helpers/fakeBackend.ts'

const require = createRequire(import.meta.url)
const server = require('../netlify/functions/_lib/recurringExpenses.cjs')
const dates = (occ: { date: string }[]) => occ.map(o => o.date)
const S = (over: Partial<web.SeriesLike> = {}): web.SeriesLike => ({ id: 's1', date: '2026-01-31', recurrence: 'monthly', ...over })

test('monthly: same day each month, clamped to the month end (Jan 31 → Feb 28 → Mar 31)', () => {
  assert.deepEqual(dates(web.dueOccurrences(S(), '2026-05-31')), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  assert.deepEqual(web.dueOccurrences(S(), '2026-03-31').map(o => o.period), ['2026-02', '2026-03'])
  assert.equal(web.occurrenceDate('2026-01-30', 'monthly', 1), '2026-02-28')
  assert.equal(web.occurrenceDate('2026-01-15', 'monthly', 13), '2027-02-15', 'across a year end')
  assert.equal(web.occurrenceDate('2026-12-31', 'monthly', 2), '2027-02-28')
})

test('leap years: Feb 29 in leap years, Feb 28 otherwise; yearly Feb 29 → Feb 28 → … → Feb 29', () => {
  assert.equal(web.occurrenceDate('2028-01-31', 'monthly', 1), '2028-02-29')
  assert.equal(web.occurrenceDate('2027-01-31', 'monthly', 1), '2027-02-28')
  assert.deepEqual([1, 2, 3, 4].map(n => web.occurrenceDate('2028-02-29', 'yearly', n)), ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
  assert.deepEqual(web.dueOccurrences(S({ date: '2028-02-29', recurrence: 'yearly' }), '2030-03-01').map(o => o.period), ['2029', '2030'])
  assert.equal(web.isIsoDate('2027-02-29'), false)
  assert.equal(web.isIsoDate('2028-02-29'), true)
})

test('weekly: every 7 days across months and years', () => {
  assert.deepEqual(dates(web.dueOccurrences(S({ date: '2026-12-24', recurrence: 'weekly' }), '2027-01-14')), ['2026-12-31', '2027-01-07', '2027-01-14'])
  assert.equal(web.periodKey('2027-01-07', 'weekly'), '2027-01-07')
})

test('start and end bounds: nothing before the start, nothing after today or the end date', () => {
  assert.deepEqual(web.dueOccurrences(S({ date: '2026-06-10' }), '2026-06-09'), [], 'start in the future')
  assert.deepEqual(web.dueOccurrences(S({ date: '2026-06-10' }), '2026-06-10'), [], 'the first entry itself covers the start date')
  assert.deepEqual(dates(web.dueOccurrences(S({ date: '2026-06-10' }), '2026-07-10')), ['2026-07-10'], 'due on the day itself')
  assert.deepEqual(dates(web.dueOccurrences(S({ date: '2026-01-10', recurrenceEnd: '2026-03-10' }), '2026-12-01')), ['2026-02-10', '2026-03-10'], 'end date inclusive')
  assert.deepEqual(dates(web.dueOccurrences(S({ date: '2026-01-10', recurrenceEnd: '2026-03-09' }), '2026-12-01')), ['2026-02-10'])
  assert.deepEqual(web.dueOccurrences(S({ recurrence: null }), '2026-12-01'), [], 'not a series')
  assert.deepEqual(web.dueOccurrences(S({ recurrence: 'daily' }), '2026-12-01'), [], 'unknown frequency')
  assert.deepEqual(web.dueOccurrences(S({ date: '2026-02-30' }), '2026-12-01'), [], 'bad start date')
})

test('no duplicates: copies already added (recurrence_through) are never planned again', () => {
  const first = web.dueOccurrences(S(), '2026-04-15')
  assert.deepEqual(dates(first), ['2026-02-28', '2026-03-31'])
  const after = S({ recurrenceThrough: first[first.length - 1].date })
  assert.deepEqual(web.dueOccurrences(after, '2026-04-15'), [], 'same day again: nothing')
  assert.deepEqual(dates(web.dueOccurrences(after, '2026-04-30')), ['2026-04-30'], 'only the new month')
  // A deleted copy stays deleted: through is past it, so it's not planned again
  assert.deepEqual(web.dueOccurrences(S({ recurrenceThrough: '2026-03-31' }), '2026-03-31'), [])
  // Periods are unique within a plan
  const many = web.dueOccurrences(S({ date: '2020-01-31' }), '2026-11-03', 500)
  assert.equal(new Set(many.map(o => o.period)).size, many.length)
  assert.equal(many.length, 81, "Feb 2020 … Oct 2026")
})

test('caps: at most `max` per series, `maxTotal` per run, oldest first (the rest come next run)', () => {
  const old = S({ date: '2016-01-01' })
  assert.equal(web.dueOccurrences(old, '2026-11-03').length, 60)
  assert.equal(web.dueOccurrences(old, '2026-11-03')[0].date, '2016-02-01')
  const plan = web.planCatchUp([old, S({ id: 's2', date: '2016-01-01' }), S({ id: 's3', date: '2026-10-03' })], '2026-11-03', { maxTotal: 100 })
  assert.deepEqual(plan.map(p => [p.series.id, p.occurrences.length]), [['s1', 60], ['s2', 40]])
  assert.equal(plan[1].through, plan[1].occurrences[39].date)
})

test('next date and active/stopped', () => {
  assert.equal(web.nextOccurrence(S({ recurrenceThrough: '2026-10-31' }), '2026-11-03'), '2026-11-30')
  assert.equal(web.nextOccurrence(S({ recurrenceEnd: '2026-11-15' }), '2026-11-03'), null)
  assert.equal(web.nextOccurrence(S({ date: '2026-12-05' }), '2026-11-03'), '2027-01-05', 'the first entry is the start; the next copy is a month later')
  assert.equal(web.seriesActive(S({ recurrenceEnd: '2026-11-03' }), '2026-11-03'), true, 'stopped today: still today')
  assert.equal(web.seriesActive(S({ recurrenceEnd: '2026-11-02' }), '2026-11-03'), false)
  assert.equal(web.seriesActive(S({ recurrence: null }), '2026-11-03'), false)
})

test('starting a stopped series again skips the stopped months', () => {
  const stopped = S({ date: '2026-01-15', recurrenceEnd: '2026-06-15', recurrenceThrough: '2026-06-15' })
  const through = web.restartThrough(stopped, null, '2026-11-03')
  assert.equal(through, '2026-11-02')
  assert.deepEqual(web.dueOccurrences({ ...stopped, recurrenceEnd: null, recurrenceThrough: through }, '2026-11-15').map(o => o.date), ['2026-11-15'])
  assert.equal(web.restartThrough(stopped, '2026-06-01', '2026-11-03'), undefined, 'end moved earlier: not a restart')
  assert.equal(web.restartThrough(S({ recurrenceEnd: '2026-12-01' }), null, '2026-11-03'), undefined, 'still active: nothing to skip')
  assert.equal(web.restartThrough(undefined, null, '2026-11-03'), undefined, 'new series')
})

test('browser and server rules agree', () => {
  const cases: [web.SeriesLike, string][] = [
    [S(), '2026-11-03'], [S({ date: '2028-02-29', recurrence: 'yearly' }), '2034-03-01'], [S({ date: '2026-12-24', recurrence: 'weekly' }), '2027-03-01'],
    [S({ recurrenceEnd: '2026-05-30' }), '2026-11-03'], [S({ recurrenceThrough: '2026-07-31' }), '2026-11-03'], [S({ date: '2026-08-31', recurrenceThrough: '2026-07-31' }), '2026-11-03'],
    [S({ date: 'bad' }), '2026-11-03'], [S({ recurrence: 'daily' }), '2026-11-03'], [S({ date: '2016-01-01' }), '2026-11-03'],
  ]
  for (const [s, today] of cases) assert.deepEqual(server.dueOccurrences(s, today), web.dueOccurrences(s, today), JSON.stringify(s))
  const rows = cases.map(([s], i) => ({ ...s, id: `s${i}` }))
  assert.deepEqual(server.planCatchUp(rows, '2026-11-03', { maxTotal: 120 }).map((p: { series: { id: string }; through: string }) => [p.series.id, p.through]),
    web.planCatchUp(rows, '2026-11-03', { maxTotal: 120 }).map(p => [p.series.id, p.through]))
  for (const [d, f, n] of [['2026-01-31', 'monthly', 25], ['2024-02-29', 'yearly', 9], ['2026-03-29', 'weekly', 60]] as const)
    assert.equal(server.occurrenceDate(d, f, n), web.occurrenceDate(d, f, n))
})

// ── The daily function ──────────────────────────────────────────────────────
test('expenses-recurring: adds due copies once, remembers the last one, a second run adds nothing', async () => {
  const fb = new FakeBackend().install()
  fb.db = {
    expenses: [
      { id: 'rent', project_id: null, description: 'Office rent', amount: 1450, category: 'Office', date: '2026-08-31', recurrence: 'monthly', recurrence_end: null, recurrence_through: null },
      { id: 'zoom', project_id: null, description: 'Zoom', amount: 15, category: 'Software', date: '2026-10-20', recurrence: 'weekly', recurrence_end: '2026-10-31', recurrence_through: null },
      { id: 'plain', project_id: null, description: 'Lunch', amount: 20, date: '2026-10-01', recurrence: null },
    ],
  }
  try {
    const { _test } = require('../netlify/functions/expenses-recurring.cjs')
    const r1 = await _test.run('2026-11-03')
    assert.deepEqual(r1, { setUp: true, added: 3, series: 2 })
    const copies = fb.table('expenses').filter(r => r.series_id)
    assert.deepEqual(copies.map(r => [r.series_id, r.date, r.series_period, r.amount]).sort(),
      [['rent', '2026-09-30', '2026-09', 1450], ['rent', '2026-10-31', '2026-10', 1450], ['zoom', '2026-10-27', '2026-10-27', 15]])
    assert.equal(copies.every(r => r.description && r.category && !r.recurrence), true, 'copies are plain expenses (not series themselves)')
    assert.equal(fb.table('expenses').find(r => r.id === 'rent')!.recurrence_through, '2026-10-31')
    assert.ok(fb.restCalls.some(c => c.method === 'POST' && c.path.startsWith('expenses?on_conflict=series_id,series_period')), 'insert ignores duplicates on the series key')
    const r2 = await _test.run('2026-11-03')
    assert.deepEqual(r2, { setUp: true, added: 0, series: 0 })
    // A copy from another window already there: ignored, not duplicated
    fb.table('expenses').find(r => r.id === 'rent')!.recurrence_through = '2026-10-31'
    fb.table('expenses').push({ id: 'other-window', series_id: 'rent', series_period: '2026-11', date: '2026-11-30', amount: 1450 })
    const r3 = await _test.run('2026-11-30')
    assert.equal(r3.added, 0)
    assert.equal(fb.table('expenses').filter(r => r.series_id === 'rent' && r.series_period === '2026-11').length, 1)
  } finally { fb.restore() }
})

test('expenses-recurring: before the SQL runs it answers "not set up" instead of failing', async () => {
  const fb = new FakeBackend().install()
  fb.db = {}   // the fake answers "Could not find the table" for unknown tables; use a column error instead
  const orig = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify({ code: '42703', message: 'column expenses.recurrence does not exist' }), { status: 400 })) as typeof fetch
  try {
    const { _test, handler } = require('../netlify/functions/expenses-recurring.cjs')
    assert.deepEqual(await _test.run('2026-11-03'), { setUp: false, added: 0, series: 0 })
    const res = await handler()
    assert.equal(res.statusCode, 200)
    assert.match(res.body, /migrate-expenses-recurring-fees\.sql/)
  } finally { globalThis.fetch = orig; fb.restore() }
})
