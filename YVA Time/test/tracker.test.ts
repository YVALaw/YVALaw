// Unit tests for the tracking engine: node --experimental-strip-types --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Tracker, BLOCK_MS, blockStartOf } from '../src/main/tracker.ts'
import type { Target } from '../src/shared/types.ts'

const P1: Target = { kind: 'project', projectId: 'p1', label: 'Intake' }
const P2: Target = { kind: 'project', projectId: 'p2', label: 'Demand' }
const T0 = Date.UTC(2026, 9, 30, 13, 0, 0)          // 13:00:00, a block boundary

/** Advance the tracker second by second with a given idle time for each second */
function run(t: Tracker, from: number, seconds: number, idle: (i: number) => number = () => 0): number {
  let now = from
  for (let i = 0; i < seconds; i++) { now += 1000; t.tick(now, idle(i)) }
  return now
}

test('counts active seconds into the 10-minute block of the current project', () => {
  const t = new Tracker(); t.start(P1, 'calls', T0)
  run(t, T0, 90)
  assert.equal(t.totalBetween(T0, T0 + BLOCK_MS), 90)
  const [row] = t.dirtyRows()
  assert.equal(row.targetKey, 'project:p1'); assert.equal(row.blockStart, T0); assert.equal(row.note, 'calls')
})

test('splits time across blocks and projects', () => {
  const t = new Tracker(); t.start(P1, '', T0 + 540_000)      // 13:09:00
  let now = run(t, T0 + 540_000, 120)                          // until 13:11:00
  t.setTarget(P2); now = run(t, now, 30)
  const rows = t.dirtyRows().map(r => `${(r.blockStart - T0) / 60000}:${r.targetKey}=${r.seconds}`).sort()
  assert.deepEqual(rows, ['0:project:p1=60', '10:project:p1=60', '10:project:p2=30'])
})

test('never counts sleep/hibernate gaps', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  let now = run(t, T0, 10)
  now += 3_600_000; t.tick(now, 0)                              // laptop slept an hour
  run(t, now, 10)
  assert.equal(t.totalBetween(0, Infinity), 20)
})

test('a short pause (under 5 min without input) still counts once input returns', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  const now = run(t, T0, 240, i => (i < 60 ? 0 : i - 59))       // after 1 min, quiet for 3 min
  assert.equal(t.totalBetween(0, Infinity), 60)                 // quiet minutes held aside…
  assert.equal(t.heldSeconds(), 180)                            // …but shown live
  run(t, now, 1, () => 0)                                       // mouse moves
  assert.equal(t.totalBetween(0, Infinity), 241)
  assert.equal(t.idleReview, null)
})

test('5+ minutes away: becomes idle, then asks Keep/Remove on return', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  let now = run(t, T0, 60)                                      // 60 s active
  now = run(t, now, 600, i => i + 1)                            // 10 min with no input
  assert.equal(t.status, 'idle')
  assert.equal(t.totalBetween(0, Infinity), 60)
  now = run(t, now, 5, () => 0)                                 // back
  assert.equal(t.status, 'running')
  assert.ok(t.idleReview && t.idleReview.seconds === 600)
  assert.equal(t.totalBetween(0, Infinity), 65)                 // new active time counts right away
  t.resolveIdle(false)
  assert.equal(t.totalBetween(0, Infinity), 65)
  assert.equal(t.idleReview, null)
})

test('Keep adds the idle time back', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  let now = run(t, T0, 30)
  now = run(t, now, 400, i => i + 1)
  run(t, now, 1, () => 0)
  t.resolveIdle(true)
  assert.equal(t.totalBetween(0, Infinity), 431)
})

test('break pauses counting', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  let now = run(t, T0, 30)
  t.startBreak(); now = run(t, now, 300)
  t.endBreak(now); run(t, now, 30)
  assert.equal(t.totalBetween(0, Infinity), 60)
})

test('a block never holds more than 600 seconds', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  t.mergeServer([{ blockStart: T0, targetKey: 'project:p2', seconds: 590, status: 'tracked', note: null }])
  run(t, T0, 60)
  assert.equal(t.blockTotal(T0), 600)
})

test('one screenshot per block, at the planned moment, only while running', () => {
  const t = new Tracker({ screenshots: true, random: () => 0.5 })  // offset 20 + 280 = 300 s
  t.start(P1, '', T0)
  assert.equal(t.screenshotDue(T0 + 299_000), false)
  assert.equal(t.screenshotDue(T0 + 300_000), true)
  assert.equal(t.screenshotDue(T0 + 400_000), false)             // already taken in this block
  t.startBreak()
  assert.equal(t.screenshotDue(T0 + BLOCK_MS + 400_000), false)  // on break
  t.endBreak(T0 + BLOCK_MS + 400_000)
  assert.equal(t.screenshotDue(T0 + BLOCK_MS + 400_000), true)
})

test('YVA team (screenshots off) never asks for a screenshot', () => {
  const t = new Tracker({ screenshots: false }); t.start(P1, '', T0)
  assert.equal(t.screenshotDue(T0 + 590_000), false)
})

test('deleting a screenshot removes the whole block, including later seconds', () => {
  const t = new Tracker({ screenshots: true, shotOffsetS: 10 }); t.start(P1, '', T0)
  let now = run(t, T0, 120)
  t.removeBlock(blockStartOf(now), false)
  now = run(t, now, 60)                                          // still in the same block
  assert.equal(t.totalBetween(0, Infinity), 0)
  const [row] = t.dirtyRows()
  assert.equal(row.seconds, 0); assert.equal(row.removed, true)   // zero uploaded for that block
  t.tick(T0 + BLOCK_MS, 0)                                        // clock jumped ahead: resync
  run(t, T0 + BLOCK_MS, 10)                                       // next block counts again
  assert.equal(t.totalBetween(0, Infinity), 10)
})

test('idle is still detected inside a removed block (no question when nothing was held)', () => {
  const t = new Tracker({ screenshots: true, shotOffsetS: 5 }); t.start(P1, '', T0)
  let now = run(t, T0, 30)
  t.removeBlock(blockStartOf(now), true)
  now = run(t, now, 360, i => i + 1)
  assert.equal(t.status, 'idle')
  run(t, now, 2, () => 0)
  assert.equal(t.status, 'running')
  assert.equal(t.idleReview, null)
})

test('upload bookkeeping: rows changed during an upload stay dirty', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  let now = run(t, T0, 10)
  const sent = t.dirtyRows()
  now = run(t, now, 5)                                            // more time while uploading
  t.markSynced(sent)
  assert.equal(t.dirtyRows().length, 1)
  t.markSynced(t.dirtyRows())
  assert.equal(t.dirtyRows().length, 0)
})

test('server rows merge without losing local time', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  run(t, T0, 100)
  t.mergeServer([
    { blockStart: T0, targetKey: 'project:p1', seconds: 40, status: 'tracked', note: null },   // older copy
    { blockStart: T0 - BLOCK_MS, targetKey: 'work:Admin', seconds: 300, status: 'tracked', note: null },
  ])
  assert.equal(t.totalBetween(T0, T0 + BLOCK_MS), 100)
  assert.equal(t.totalBetween(0, Infinity), 400)
})

test('state survives a restart', () => {
  const t = new Tracker(); t.start(P1, '', T0)
  const now = run(t, T0, 50)
  const t2 = new Tracker(); t2.restore(JSON.parse(JSON.stringify(t.serialize(now))))
  assert.equal(t2.totalBetween(0, Infinity), 50)
  assert.equal(t2.status, 'stopped')
  assert.equal(t2.dirtyRows().length, 1)
})
