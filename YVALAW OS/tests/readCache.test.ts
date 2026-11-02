import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { cachedRead, clearReadCache, writeAwareFetch, applyVersions, registerVersionSource, checkForChanges, pageChanged, onTeamChange, setLiveConnected, depsOf, changeStampsActive, LIST_MS, __resetForTests, type VersionRow } from '../src/lib/readCache.ts'

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

test('read-only database functions keep the shared copy; other function calls clear it', async () => {
  clearReadCache()
  const c = counter()
  await cachedRead('t7', c.load)
  const orig = globalThis.fetch
  globalThis.fetch = (async () => new Response('[]')) as typeof fetch
  try {
    await writeAwareFetch('https://x.supabase.co/rest/v1/rpc/placement_bill_rates', { method: 'POST', body: '{}' })
    assert.deepEqual(await cachedRead('t7', c.load), [1])
    await writeAwareFetch('https://x.supabase.co/rest/v1/rpc/payroll_mark_paid', { method: 'POST', body: '{}' })
    assert.deepEqual(await cachedRead('t7', c.load), [2])
  } finally { globalThis.fetch = orig }
})

// ── kept database responses (writeAwareFetch) ──
function fakeNet(handler?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = []
  const orig = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(`${init?.method || 'GET'} ${url}`)
    return handler ? handler(url, init) : new Response(JSON.stringify([{ n: calls.length }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = orig } }
}
const H = { headers: { authorization: 'Bearer a', accept: 'application/json' } }
const DB = 'https://x.supabase.co/rest/v1/'

test('the same read is answered from memory (one network call)', async () => {
  clearReadCache(); const net = fakeNet()
  try {
    const a = await (await writeAwareFetch(`${DB}employees?select=*`, { method: 'GET', ...H })).json()
    const b = await (await writeAwareFetch(`${DB}employees?select=*`, { method: 'GET', ...H })).json()
    assert.equal(net.calls.length, 1); assert.deepEqual(a, b)
  } finally { net.restore() }
})

test('a write through the client makes the next read go to the database', async () => {
  clearReadCache(); const net = fakeNet()
  try {
    await writeAwareFetch(`${DB}clients?select=*`, { method: 'GET', ...H })
    await writeAwareFetch(`${DB}clients?id=eq.1`, { method: 'PATCH', ...H, body: '{}' })
    await writeAwareFetch(`${DB}clients?select=*`, { method: 'GET', ...H })
    assert.deepEqual(net.calls.map(c => c.split(' ')[0]), ['GET', 'PATCH', 'GET'])
  } finally { net.restore() }
})

test('live reads are never kept: "since a moment ago", notifications, counters', async () => {
  clearReadCache(); const net = fakeNet()
  try {
    const since = new Date(Date.now() - 3 * 60_000).toISOString()
    for (let i = 0; i < 2; i++) {
      await writeAwareFetch(`${DB}tracker_blocks?select=employee_id&updated_at=gte.${encodeURIComponent(since)}`, { method: 'GET', ...H })
      await writeAwareFetch(`${DB}notifications?select=*`, { method: 'GET', ...H })
      await writeAwareFetch(`${DB}counters?select=value&key=eq.invoice`, { method: 'GET', ...H })
    }
    assert.equal(net.calls.length, 6)
    // a date range in the past IS kept (a week of blocks for approvals)
    await writeAwareFetch(`${DB}tracker_blocks?block_start=gte.2026-01-05T04:00:00.000Z`, { method: 'GET', ...H })
    await writeAwareFetch(`${DB}tracker_blocks?block_start=gte.2026-01-05T04:00:00.000Z`, { method: 'GET', ...H })
    assert.equal(net.calls.length, 7)
  } finally { net.restore() }
})

test('a refused read is not kept and the caller gets the real answer', async () => {
  clearReadCache(); let fail = true
  const net = fakeNet(() => fail ? new Response('{"message":"denied"}', { status: 403 }) : new Response('[]', { status: 200 }))
  try {
    const r = await writeAwareFetch(`${DB}payroll_runs?select=*`, { method: 'GET', ...H })
    assert.equal(r.status, 403)
    fail = false
    const r2 = await writeAwareFetch(`${DB}payroll_runs?select=*`, { method: 'GET', ...H })
    assert.equal(r2.status, 200)
  } finally { net.restore() }
})

test('a read that overlaps a save is not kept (the save may have changed it)', async () => {
  clearReadCache()
  let release: (r: Response) => void = () => {}
  let slowOnce = true
  const net = fakeNet((url, init) => {
    if ((init?.method || 'GET') === 'GET' && url.includes('slow') && slowOnce) { slowOnce = false; return new Promise<Response>(res => { release = res }) }
    return new Response('[]', { status: 200 })
  })
  try {
    const pending = writeAwareFetch(`${DB}invoices?slow=1`, { method: 'GET', ...H })
    await writeAwareFetch(`${DB}invoices?id=eq.1`, { method: 'PATCH', ...H, body: '{}' })
    release(new Response('[{"old":true}]', { status: 200 }))
    await pending
    await writeAwareFetch(`${DB}invoices?slow=1`, { method: 'GET', ...H }).catch(() => null)
    assert.equal(net.calls.filter(c => c.includes('slow')).length, 2)
  } finally { net.restore() }
})

test('different sign-ins never share kept answers', async () => {
  clearReadCache(); const net = fakeNet()
  try {
    await writeAwareFetch(`${DB}clients?select=*`, { method: 'GET', headers: { authorization: 'Bearer a' } })
    await writeAwareFetch(`${DB}clients?select=*`, { method: 'GET', headers: { authorization: 'Bearer b' } })
    assert.equal(net.calls.length, 2)
  } finally { net.restore() }
})

// ── change stamps (supabase/migrate-live-updates.sql + services/liveUpdates.ts) ──
const V = (t: Record<string, number>): VersionRow[] => Object.entries(t).map(([table_name, version]) => ({ table_name, version }))
const get = (path: string) => writeAwareFetch(`${DB}${path}`, { method: 'GET', ...H })

test('the tables a read depends on include embedded ones', () => {
  assert.deepEqual(depsOf(new URL(`${DB}invoices?select=*,clients(name),proj:projects!invoices_project_id_fkey(name)`)), ['invoices', 'clients', 'projects'])
  assert.deepEqual(depsOf(new URL(`${DB}employees?select=id,name`)), ['employees'])
})

test('with change stamps, a read is kept past one minute until its table changes', async () => {
  __resetForTests(); const net = fakeNet()
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-02T12:00:00Z') })
  try {
    applyVersions(V({ employees: 3, clients: 1 }), { complete: true })
    assert.equal(changeStampsActive(), true)
    await get('employees?select=*')
    mock.timers.tick(LIST_MS * 10)        // ten minutes, nobody saved
    await get('employees?select=*')
    assert.equal(net.calls.length, 1)
    applyVersions(V({ clients: 2 }))      // another table changed: still kept
    await get('employees?select=*')
    assert.equal(net.calls.length, 1)
    applyVersions(V({ employees: 4 }))    // a teammate saved an employee
    await get('employees?select=*')
    assert.equal(net.calls.length, 2)
  } finally { mock.timers.reset(); net.restore() }
})

test('a read with an embedded table is dropped when the embedded table changes', async () => {
  __resetForTests(); const net = fakeNet()
  try {
    applyVersions(V({ invoices: 1, clients: 1 }), { complete: true })
    await get('invoices?select=*,clients(name)')
    applyVersions(V({ clients: 2 }))
    await get('invoices?select=*,clients(name)')
    assert.equal(net.calls.length, 2)
  } finally { net.restore() }
})

test('without stamps (script not run yet) reads are kept one minute, as before', async () => {
  __resetForTests(); const net = fakeNet()
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-02T12:00:00Z') })
  try {
    await get('clients?select=*')
    mock.timers.tick(LIST_MS - 1000); await get('clients?select=*')
    assert.equal(net.calls.length, 1)
    mock.timers.tick(2000); await get('clients?select=*')
    assert.equal(net.calls.length, 2)
    // a table that has no stamp also stays on the one-minute rule when others have stamps
    applyVersions(V({ clients: 1 }), { complete: true })
    await get('tracker_blocks?select=*&block_start=gte.2026-01-05T04:00:00.000Z')
    mock.timers.tick(LIST_MS + 1000)
    await get('tracker_blocks?select=*&block_start=gte.2026-01-05T04:00:00.000Z')
    assert.equal(net.calls.filter(c => c.includes('tracker_blocks')).length, 2)
  } finally { mock.timers.reset(); net.restore() }
})

test('a read made before the stamps were known is not kept until-changed', async () => {
  __resetForTests(); const net = fakeNet()
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-02T12:00:00Z') })
  try {
    await get('projects?select=*')                       // stamps unknown yet
    applyVersions(V({ projects: 7 }), { complete: true }) // first check arrives (it may include a change made since)
    mock.timers.tick(LIST_MS + 1000)
    await get('projects?select=*')
    assert.equal(net.calls.length, 2)
  } finally { mock.timers.reset(); net.restore() }
})

test('a read whose table changes while it is in flight is not kept', async () => {
  __resetForTests()
  applyVersions(V({ leads: 1 }), { complete: true })
  let release: (r: Response) => void = () => {}
  let first = true
  const net = fakeNet(() => first ? (first = false, new Promise<Response>(res => { release = res })) : new Response('[]', { status: 200 }))
  try {
    const pending = get('leads?select=*')
    await new Promise(r => setTimeout(r, 0))
    applyVersions(V({ leads: 2 }))
    release(new Response('[{"old":true}]', { status: 200 }))
    await pending
    await get('leads?select=*')
    assert.equal(net.calls.length, 2)
  } finally { net.restore() }
})

test('a teammate change to a table the page shows is reported; other tables and own saves are not', async () => {
  __resetForTests(); const net = fakeNet()
  const seen: string[][] = []
  const off = onTeamChange(t => seen.push(t))
  try {
    applyVersions(V({ clients: 1, employees: 1, invoices: 1 }), { complete: true })
    pageChanged()
    await get('clients?select=*')
    applyVersions(V({ employees: 2 }))     // not on this page
    assert.equal(seen.length, 0)
    applyVersions(V({ clients: 2 }))       // on this page, someone else
    assert.deepEqual(seen, [['clients']])
    await writeAwareFetch(`${DB}clients?id=eq.1`, { method: 'PATCH', ...H, body: '{}' })
    applyVersions(V({ clients: 3 }))       // our own save coming back
    assert.equal(seen.length, 1)
    pageChanged()                          // another page: clients no longer on screen
    applyVersions(V({ invoices: 2 }))
    assert.equal(seen.length, 1)
  } finally { off(); net.restore() }
})

test('opening a page checks for changes when the live connection is down, at most every 10 seconds', async () => {
  __resetForTests()
  let reads = 0
  registerVersionSource(async () => { reads++; return V({ clients: reads }) })
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-02T12:00:00Z') })
  try {
    pageChanged(); await new Promise(r => setImmediate(r))
    pageChanged(); await new Promise(r => setImmediate(r))
    assert.equal(reads, 1)
    mock.timers.tick(11_000)
    pageChanged(); await new Promise(r => setImmediate(r))
    assert.equal(reads, 2)
    setLiveConnected(true)                 // pushed live: page switches cost nothing
    mock.timers.tick(60_000)
    pageChanged(); await new Promise(r => setImmediate(r))
    assert.equal(reads, 2)
    // a failing check (script not run) leaves stamps unknown
    __resetForTests()
    registerVersionSource(async () => null)
    await checkForChanges(0)
    assert.equal(changeStampsActive(), false)
  } finally { mock.timers.reset() }
})

test('the change numbers themselves are never kept', async () => {
  __resetForTests(); const net = fakeNet()
  try {
    await get('data_versions?select=table_name,version'); await get('data_versions?select=table_name,version')
    assert.equal(net.calls.length, 2)
  } finally { net.restore() }
})
