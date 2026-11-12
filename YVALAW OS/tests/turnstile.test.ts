// Run: npm test — Cloudflare Turnstile check used by lead-intake / application-intake (_lib/turnstile.cjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { verifyTurnstile, VERIFY_URL } = require('../netlify/functions/_lib/turnstile.cjs')

const cf = (reply: unknown, seen: unknown[] = []) => async (url: string, opts: { body: URLSearchParams }) => {
  seen.push({ url, body: Object.fromEntries(opts.body) })
  if (reply instanceof Error) throw reply
  return { json: async () => reply }
}

test('off until TURNSTILE_SECRET_KEY is set on Netlify', async () => {
  delete process.env.TURNSTILE_SECRET_KEY
  assert.deepEqual(await verifyTurnstile(undefined, '1.1.1.1'), { ok: true, skipped: true })
})

test('with the secret: Cloudflare decides; no token = not a person; Cloudflare down = let through', async () => {
  process.env.TURNSTILE_SECRET_KEY = 'sec'
  try {
    const seen: any[] = []
    assert.equal((await verifyTurnstile('tok', '9.9.9.9', { fetchImpl: cf({ success: true }, seen) })).ok, true)
    assert.equal(seen[0].url, VERIFY_URL)
    assert.deepEqual(seen[0].body, { secret: 'sec', response: 'tok', remoteip: '9.9.9.9' })
    assert.deepEqual(await verifyTurnstile('tok', '', { fetchImpl: cf({ success: false, 'error-codes': ['invalid-input-response'] }) }), { ok: false, reason: 'invalid-input-response' })
    assert.equal((await verifyTurnstile(null, '', { fetchImpl: cf({ success: true }) })).ok, false)
    assert.equal((await verifyTurnstile('x'.repeat(3000), '', { fetchImpl: cf({ success: true }) })).ok, false)
    assert.deepEqual(await verifyTurnstile('tok', '', { fetchImpl: cf(new Error('ECONNRESET')) }), { ok: true, unavailable: true })
  } finally { delete process.env.TURNSTILE_SECRET_KEY }
})
