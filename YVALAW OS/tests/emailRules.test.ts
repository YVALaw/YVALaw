import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { checkEmail, safeFileName, isEmail, addressList, EmailRuleError } = require('../netlify/functions/_lib/emailRules.cjs')

const pdf = (bytes = 10) => ({ name: 'Invoice.pdf', contentType: 'application/pdf', base64: Buffer.alloc(bytes, 7).toString('base64') })
const ok = { to: 'ap@halavi.com', subject: 'Invoice HAL-1', text: 'Hello' }
const fails = (input: object, re: RegExp) => assert.throws(() => checkEmail(input), (e: Error) => e instanceof EmailRuleError && re.test(e.message))

test('a normal invoice email passes and is normalised', () => {
  const m = checkEmail({ ...ok, to: ['AP@halavi.com', 'ap@halavi.com'], cc: 'acct@halavi.com; ap@halavi.com, owner@halavi.com', attachments: [pdf(1000)] })
  assert.deepEqual(m.to, ['AP@halavi.com'])
  assert.deepEqual(m.cc, ['acct@halavi.com', 'owner@halavi.com'])   // the To address is never also Cc'd
  assert.equal(m.attachments[0].size, 1000)
  assert.equal(m.subject, 'Invoice HAL-1')
})

test('recipients: at least one, valid addresses only, at most 10 in total', () => {
  fails({ ...ok, to: '' }, /at least one recipient/)
  fails({ ...ok, to: 'not-an-email' }, /Not a valid email address: not-an-email/)
  fails({ ...ok, cc: ['x@y.com\nBcc: spy@evil.com'] }, /Not a valid email address/)
  fails({ ...ok, to: 'a@b.c' }, /Not a valid email address/)
  fails({ ...ok, cc: Array.from({ length: 10 }, (_, i) => `p${i}@x.com`) }, /Too many recipients \(11\)/)
  assert.equal(checkEmail({ ...ok, cc: Array.from({ length: 9 }, (_, i) => `p${i}@x.com`) }).cc.length, 9)
})

test('subject: required, one line, at most 300 characters; message at most 200 KB', () => {
  fails({ ...ok, subject: '  ' }, /needs a subject/)
  assert.equal(checkEmail({ ...ok, subject: 'Hi\r\nBcc: spy@evil.com' }).subject, 'Hi Bcc: spy@evil.com')
  fails({ ...ok, subject: 'x'.repeat(301) }, /subject is too long/)
  fails({ ...ok, text: 'x'.repeat(200 * 1024 + 1) }, /message is too long/)
})

test('attachments: PDFs only, valid base64, 4.5 MB in total', () => {
  fails({ ...ok, attachments: [{ name: 'a.html', contentType: 'text/html', base64: 'AAAA' }] }, /Only PDF attachments/)
  fails({ ...ok, attachments: [{ name: 'a.pdf', contentType: 'application/pdf', base64: 'not base64!' }] }, /empty or damaged/)
  fails({ ...ok, attachments: [{ name: 'a.pdf', contentType: 'application/pdf', base64: '' }] }, /empty or damaged/)
  fails({ ...ok, attachments: [pdf(3 * 1024 * 1024), pdf(2 * 1024 * 1024)] }, /too large together \(5\.0 MB/)
  assert.equal(checkEmail({ ...ok, attachments: [pdf(2 * 1024 * 1024), pdf(2 * 1024 * 1024)] }).attachments.length, 2)
  assert.equal(checkEmail({ ...ok, attachments: [{ ...pdf(), contentType: 'application/PDF; name=x' }] }).attachments[0].contentType, 'application/pdf')
})

test('file names: no folders, quotes or control characters; extension kept when shortened', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('C:\\temp\\Invoice "A".pdf'), 'Invoice A.pdf')
  assert.equal(safeFileName('a\r\nX-Evil: 1.pdf'), 'aX-Evil 1.pdf')
  assert.equal(safeFileName(''), 'document.pdf')
  assert.equal(safeFileName('..'), 'document.pdf')
  const long = safeFileName('x'.repeat(200) + '.pdf')
  assert.equal(long.length, 120); assert.ok(long.endsWith('.pdf'))
})

test('address helpers', () => {
  assert.ok(isEmail('ana.perez+billing@sub.example.do'))
  assert.ok(!isEmail('a@b')); assert.ok(!isEmail('a b@c.com')); assert.ok(!isEmail('<a@b.com>'))
  assert.deepEqual(addressList(' a@x.com ,, <B@y.com>;a@X.com '), ['a@x.com', 'B@y.com'])
})
