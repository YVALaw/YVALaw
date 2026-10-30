import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseClock, reminderDue } from '../src/main/reminders.ts'

const none = { start: null, end: null }
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi)   // local time

test('reads the shift times people type', () => {
  assert.equal(parseClock('9:00 am'), 540)
  assert.equal(parseClock('9am'), 540)
  assert.equal(parseClock('4:30 PM'), 990)
  assert.equal(parseClock('12:00 am'), 0)
  assert.equal(parseClock('12 pm'), 720)
  assert.equal(parseClock('21:00'), 1260)
  assert.equal(parseClock('13:00 pm'), null)
  assert.equal(parseClock('later'), null)
  assert.equal(parseClock(''), null)
})

test('start reminder: 10–60 min after a weekday shift starts, if not tracking', () => {
  const thu = (h: number, m: number) => at(2026, 10, 29, h, m)       // Thursday
  assert.equal(reminderDue(thu(9, 5), '9:00 am', '5:00 pm', 'stopped', none), null)          // too early
  assert.equal(reminderDue(thu(9, 15), '9:00 am', '5:00 pm', 'stopped', none)?.kind, 'start')
  assert.equal(reminderDue(thu(9, 15), '9:00 am', '5:00 pm', 'running', none), null)         // already tracking
  assert.equal(reminderDue(thu(10, 30), '9:00 am', '5:00 pm', 'stopped', none), null)        // too late to nag
  const r = reminderDue(thu(9, 15), '9:00 am', '5:00 pm', 'stopped', none)!
  assert.equal(reminderDue(thu(9, 20), '9:00 am', '5:00 pm', 'stopped', { start: r.shiftKey, end: null }), null)  // once
})

test('no start reminder on weekends', () => {
  assert.equal(reminderDue(at(2026, 10, 31, 9, 15), '9:00 am', '5:00 pm', 'stopped', none), null)   // Saturday
})

test('end reminder: still tracking 30 min after the shift ended', () => {
  const thu = (h: number, m: number) => at(2026, 10, 29, h, m)
  assert.equal(reminderDue(thu(17, 20), '9:00 am', '5:00 pm', 'running', none), null)
  const r = reminderDue(thu(17, 35), '9:00 am', '5:00 pm', 'running', none)
  assert.equal(r?.kind, 'end'); assert.match(r!.clock, /5:00/)
  assert.equal(reminderDue(thu(17, 35), '9:00 am', '5:00 pm', 'stopped', none), null)
})

test('overnight shift 4 pm – 12 am: end reminder after midnight belongs to the same shift', () => {
  const r = reminderDue(at(2026, 10, 30, 0, 40), '4:00 pm', '12:00 am', 'running', none)
  assert.equal(r?.kind, 'end')
  assert.equal(r?.shiftKey, at(2026, 10, 29, 16, 0).toDateString())
  assert.equal(reminderDue(at(2026, 10, 29, 16, 20), '4:00 pm', '12:00 am', 'stopped', none)?.kind, 'start')
})

test('no shift times on the profile → no reminders', () => {
  assert.equal(reminderDue(at(2026, 10, 29, 9, 15), null, null, 'stopped', none), null)
})
