import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clockOffset } from '../src/lib/serverClock.ts'

test('server clock: a PC 4 minutes fast gets a −4 min correction', () => {
  const real = Date.UTC(2026, 10, 4, 22, 0, 0)          // server says 22:00:00 (whole seconds)
  const pc = real + 4 * 60_000                           // this computer reads 22:04
  assert.equal(clockOffset(real, pc - 100, pc + 100), -4 * 60_000 + 500)
})

test('server clock: small differences (Date header has whole seconds) are ignored', () => {
  const t = Date.UTC(2026, 10, 4, 22, 0, 0)
  assert.equal(clockOffset(t, t + 200, t + 900), 0)
  assert.equal(clockOffset(t, t - 1200, t - 1000), 0)
})

test('server clock: a PC that is slow gets a positive correction', () => {
  const real = Date.UTC(2026, 10, 4, 22, 0, 0)
  const pc = real - 3 * 60_000
  assert.equal(clockOffset(real, pc, pc), 3 * 60_000 + 500)
})
