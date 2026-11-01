import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cachedRead, clearReadCache, writeAwareFetch } from '../src/lib/readCache.ts'

const counter = () => { let n = 0; return { load: async () => { n++; return [n] }, get count() { return n } } }

test('callers asking for the same table at the same time share one request', async () => {
  clearReadCache()
  const c = counter()
  const [a, b, d] = await Promise.all([cachedRead('t1', c.load), cachedRead('t1', c.load), cachedRead('t1', c.load)])
  assert.equal(c.count, 1)
  assert.deepEqual(a, [1]); assert.deepEqual(b, [1]); assert.deepEqual(d, [1])
})

test('each caller gets its own array (pushing into one never changes another)', async () => {
  clearReadCache()
  const c = counter()
  const a = await cachedRead('t2', c.load); a.push(99)
  const b = await cachedRead('t2', c.load)
  assert.deepEqual(b, [1])
})

test('a write clears the shared copy, so the next read fetches again', async () => {
  clearReadCache()
  const c = counter()
  await cachedRead('t3', c.load)
  const orig = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}')) as typeof fetch
  try { await writeAwareFetch('https://x.supabase.co/rest/v1/t3', { method: 'PATCH' }) } finally { globalThis.fetch = orig }
  assert.deepEqual(await cachedRead('t3', c.load), [2])
})

test('GET requests do not clear it', async () => {
  clearReadCache()
  const c = counter()
  await cachedRead('t4', c.load)
  const orig = globalThis.fetch
  globalThis.fetch = (async () => new Response('[]')) as typeof fetch
  try { await writeAwareFetch('https://x.supabase.co/rest/v1/t4', { method: 'GET' }) } finally { globalThis.fetch = orig }
  assert.deepEqual(await cachedRead('t4', c.load), [1])
  assert.equal(c.count, 1)
})

test('a read that started before a write is not reused after it', async () => {
  clearReadCache()
  let n = 0
  const releases: Array<() => void> = []
  const slow = () => new Promise<number[]>(res => { n++; const v = n; releases.push(() => res([v])) })
  const first = cachedRead('t5', slow)
  clearReadCache()                     // a save happened while the read was in flight
  const second = cachedRead('t5', slow) // must start a fresh read
  assert.equal(n, 2)
  releases.forEach(r => r())
  assert.deepEqual(await first, [1]); assert.deepEqual(await second, [2])
  assert.deepEqual(await cachedRead('t5', slow), [2]) // the fresh one is the one kept
})

test('a failed read is not kept', async () => {
  clearReadCache()
  let n = 0
  await assert.rejects(cachedRead('t6', async () => { n++; throw new Error('offline') }))
  assert.deepEqual(await cachedRead('t6', async () => { n++; return [n] }), [2])
})
