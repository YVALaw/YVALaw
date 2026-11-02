// The /os security policy in the root netlify.toml: no inline scripts except the print windows' one-liners (allowed by
// hash, so changing one of those lines without updating its hash would silently break printing).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8')
const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)![1]
const directive = (name: string) => csp.split(';').map(s => s.trim()).find(s => s.startsWith(`${name} `)) ?? ''

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [] })
}

test('script-src has no unsafe-inline and allows every inline print script by hash', () => {
  const scriptSrc = directive('script-src')
  assert.ok(scriptSrc && !scriptSrc.includes("'unsafe-inline'"), scriptSrc)
  const src = files(fileURLToPath(new URL('../src', import.meta.url))).map(p => readFileSync(p, 'utf8')).join('\n')
  const inline = [...src.matchAll(/<script>([^<]*)<\/script>/g)].map(m => m[1])
  assert.ok(inline.length >= 3, 'the print windows have their auto-print scripts')
  for (const body of new Set(inline)) {
    const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`
    assert.ok(scriptSrc.includes(hash), `inline script "${body}" needs ${hash} in netlify.toml`)
  }
})

test('data goes only to this Supabase project, Stripe and Crisp', () => {
  const connect = directive('connect-src')
  assert.ok(!connect.includes('*.supabase.co'), 'pin the project host')
  assert.match(connect, /https:\/\/[a-z0-9]+\.supabase\.co wss:\/\/[a-z0-9]+\.supabase\.co/)
  assert.equal(directive('frame-ancestors'), "frame-ancestors 'none'")
  assert.equal(directive('object-src'), "object-src 'none'")
})
