// Run: npm test (TZ=America/Santo_Domingo)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleWeek, parseClock, type ScheduleBlock } from '../src/utils/schedule.ts'

const MON = new Date(2026, 9, 26).getTime()                    // Mon Oct 26 2026, 00:00 local
const at = (day: number, h: number, m = 0, s = 0) => new Date(2026, 9, 26 + day, h, m, s).getTime()
/** Continuous work from a to b (ms), split into 10-minute blocks with first/last offsets */
function work(a: number, b: number): ScheduleBlock[] {
  const out: ScheduleBlock[] = []
  for (let bs = Math.floor(a / 600_000) * 600_000; bs < b; bs += 600_000) {
    const from = Math.max(a, bs), to = Math.min(b, bs + 600_000)
    out.push({ blockStart: bs, seconds: (to - from) / 1000, firstOffset: (from - bs) / 1000, lastOffset: (to - bs) / 1000 - 1 })
  }
  return out
}
const NEXT_WEEK = at(7, 12)

test('parseClock reads the formats on employee profiles', () => {
  assert.deepEqual(['9:00 am', '9am', '4:30 PM', '16:30', '12:00 am', '12 pm', 'nine'].map(parseClock), [540, 540, 990, 990, 0, 720, null])
})

test('9–5 week: on time, late, left early, absent, weekend', () => {
  const blocks = [
    ...work(at(0, 8, 58), at(0, 17, 0)),               // Mon on time
    ...work(at(1, 9, 7, 30), at(1, 17, 2)),            // Tue 7 min late
    ...work(at(2, 9, 0), at(2, 16, 20)),               // Wed left 40 min early
    //                                                    Thu nothing → absent
    ...work(at(4, 9, 20), at(4, 15, 0)),               // Fri late and left early
    ...work(at(5, 10, 0), at(5, 12, 0)),               // Sat extra day
  ]
  const w = scheduleWeek(blocks, '9:00 am', '5:00 pm', MON, NEXT_WEEK, 5)
  assert.deepEqual(w.map(d => d.status), ['on-time', 'late', 'left-early', 'absent', 'late-left-early', 'extra-day', 'day-off'])
  assert.equal(w[1].lateMin, 7)
  assert.equal(w[2].earlyMin, 40)
  assert.deepEqual([w[4].lateMin, w[4].earlyMin], [20, 120])
  assert.equal(w[0].seconds, 8 * 3600 + 120)
  assert.equal(w[1].firstAt, at(1, 9, 7, 30))           // to the second (first_offset)
})

test('grace minutes: 5 min late is on time with 5 min grace, 6 is late', () => {
  const w = scheduleWeek([...work(at(0, 9, 5), at(0, 17, 0)), ...work(at(1, 9, 6), at(1, 17, 0))], '9:00 am', '5:00 pm', MON, NEXT_WEEK, 5)
  assert.deepEqual([w[0].status, w[1].status], ['on-time', 'late'])
})

test('today: before the shift, during it, not started yet', () => {
  const now = at(2, 12, 0)                              // Wednesday noon
  const w = scheduleWeek([...work(at(2, 9, 1), now)], '9:00 am', '5:00 pm', MON, now, 5)
  assert.equal(w[2].status, 'in-progress')              // can't judge leaving early yet
  assert.equal(w[3].status, 'upcoming')
  const w2 = scheduleWeek([], '9:00 am', '5:00 pm', MON, now, 5)
  assert.equal(w2[2].status, 'not-started')
  const w3 = scheduleWeek([...work(at(2, 9, 30), now)], '9:00 am', '5:00 pm', MON, now, 5)
  assert.equal(w3[2].status, 'late')                    // late shows during the shift
})

test('overnight shift 4 pm – 12 am counts after midnight on the same work day', () => {
  const blocks = [...work(at(0, 16, 4), at(1, 0, 10)), ...work(at(1, 16, 0), at(1, 23, 0))]
  const w = scheduleWeek(blocks, '4:00 pm', '12:00 am', MON, NEXT_WEEK, 5)
  assert.deepEqual(w.slice(0, 3).map(d => d.status), ['on-time', 'left-early', 'absent'])
  assert.equal(w[0].lastAt, at(1, 0, 10))
  assert.equal(w[1].earlyMin, 60)
})

test('no shift on the profile: just first/last/hours', () => {
  const w = scheduleWeek(work(at(0, 9, 0), at(0, 10, 0)), '', null, MON, NEXT_WEEK, 5)
  assert.deepEqual([w[0].status, w[1].status, w[0].seconds], ['worked', 'none', 3600])
})

test('rows without first/last second (before 0.3) fall back to the block start', () => {
  const w = scheduleWeek([{ blockStart: at(0, 9, 0), seconds: 300, firstOffset: null, lastOffset: null }], '9:00 am', '5:00 pm', MON, NEXT_WEEK, 5)
  assert.deepEqual([w[0].firstAt, w[0].lastAt], [at(0, 9, 0), at(0, 9, 5)])
})

test('work only after the shift ended is "outside shift", not hours late', () => {
  const w = scheduleWeek(work(at(0, 19, 0), at(0, 21, 0)), '9:00 am', '5:00 pm', MON, NEXT_WEEK, 5)
  assert.deepEqual([w[0].status, w[0].lateMin, w[0].seconds], ['outside-shift', 0, 7200])
})
