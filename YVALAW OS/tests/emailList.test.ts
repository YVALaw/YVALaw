import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emailListForSave, formatEmailList, isEmail, mergeCc, normalizeEmailList, parseEmailList, recipientsLabel } from '../src/utils/emailList.ts'
import { buildMailtoUrl, buildSendRequest, headerSafe } from '../src/utils/mime.ts'

test('CC list: commas, semicolons, spaces and new lines; duplicates (any case) once; bad entries reported', () => {
  const r = parseEmailList(' accounting@toplawassist.com; Owner@Firm.com,\nowner@firm.com  ap@x.co , nope, a@b ,, ')
  assert.deepEqual(r.emails, ['accounting@toplawassist.com', 'Owner@Firm.com', 'ap@x.co'])
  assert.deepEqual(r.invalid, ['nope', 'a@b'])
  assert.deepEqual(parseEmailList('').emails, [])
  assert.deepEqual(parseEmailList(undefined).invalid, [])
})

test('an address with a line break or header characters is never valid', () => {
  assert.equal(isEmail('a@x.com\r\nBcc: evil@x.com'), false)
  assert.equal(isEmail('"Name" <a@x.com>'), false)
  assert.equal(isEmail('a@x.com'), true)
  // split on whitespace, so the injected part is just another (invalid) entry
  assert.deepEqual(parseEmailList('a@x.com\r\nBcc: evil@x.com').invalid, ['Bcc:'])
})

test('form value → stored list: empty is undefined (never sent to a database without the column)', () => {
  assert.equal(emailListForSave('   '), undefined)
  assert.equal(emailListForSave('bad'), undefined)
  assert.deepEqual(emailListForSave('a@x.com, b@y.com'), ['a@x.com', 'b@y.com'])
  assert.equal(formatEmailList(['a@x.com', '', null, ' b@y.com ']), 'a@x.com, b@y.com')
  assert.equal(formatEmailList(undefined), '')
  assert.deepEqual(normalizeEmailList(['a@x.com', 'A@X.com', 7, 'bad']), ['a@x.com'])
  assert.deepEqual(normalizeEmailList('a@x.com,b@y.com'), ['a@x.com', 'b@y.com'])
  assert.deepEqual(normalizeEmailList(null), [])
})

test('Cc = client CC + billing contacts, deduped, never the To address', () => {
  const cc = mergeCc('AP@halavi.com',
    ['accounting@halavi.com', 'ap@halavi.com'],               // client Invoice CC repeats the main address
    ['Accounting@Halavi.com', 'owner@halavi.com', null, 'bad'], // billing contacts (one is the same person)
  )
  assert.deepEqual(cc, ['accounting@halavi.com', 'owner@halavi.com'])
  assert.deepEqual(mergeCc('', ['a@x.com']), ['a@x.com'])
  assert.deepEqual(mergeCc('a@x.com', undefined, null), [])
  assert.equal(recipientsLabel('a@x.com', ['b@y.com', 'c@z.com']), 'a@x.com (cc b@y.com, c@z.com)')
  assert.equal(recipientsLabel('a@x.com'), 'a@x.com')
})

test('send-email request: To/Cc lists, subject on one line, PDF bytes kept exactly', () => {
  const pdfBytes = Buffer.from('%PDF-1.7\n%âãÏÓ\nbinary\x00\x01\xff', 'latin1')
  const req = buildSendRequest('ap@halavi.com', 'Invoice HAL-0042 — YVA Staffing', 'Hi Halavi,\nGracias — ñ',
    [{ name: 'Invoice-HAL-0042.pdf', mimeType: 'application/pdf', base64: pdfBytes.toString('base64') }], ['accounting@halavi.com', 'owner@halavi.com'])
  assert.deepEqual(req.to, ['ap@halavi.com'])
  assert.deepEqual(req.cc, ['accounting@halavi.com', 'owner@halavi.com'])
  assert.equal(req.subject, 'Invoice HAL-0042 — YVA Staffing')
  assert.equal(req.text, 'Hi Halavi,\nGracias — ñ')
  assert.equal(req.attachments.length, 1)
  assert.equal(req.attachments[0].name, 'Invoice-HAL-0042.pdf')
  assert.equal(req.attachments[0].contentType, 'application/pdf')
  assert.deepEqual(Buffer.from(req.attachments[0].base64, 'base64'), pdfBytes)
})

test('send-email request: header injection removed from addresses, subject, file names and types', () => {
  const req = buildSendRequest('b@y.com\r\nBcc: spy@evil.com', 'Hi\r\nBcc: spy3@evil.com', 'x',
    [{ name: '../a"\r\nX-Evil: 1.pdf', mimeType: 'application/pdf\r\nX-Evil: 2', base64: 'AA\r\nAA' }], ['c@z.com\nBcc: spy2@evil.com'])
  assert.ok(!req.subject.includes('\n') && !req.subject.includes('\r'))
  assert.ok(req.to.every(a => !/[\r\n]/.test(a)) && req.cc.every(a => !/[\r\n]/.test(a)))
  assert.ok(!/[\r\n"/]/.test(req.attachments[0].name))
  assert.ok(!/[\r\n]/.test(req.attachments[0].contentType))
  assert.equal(req.attachments[0].base64, 'AAAA')
  assert.equal(headerSafe('a\r\nb'), 'a b')
  // text attachments are UTF-8 encoded
  const t = buildSendRequest('a@x.com', 's', 'b', [{ name: 'n.txt', mimeType: 'text/plain', content: 'ñ' }])
  assert.equal(Buffer.from(t.attachments[0].base64, 'base64').toString('utf8'), 'ñ')
})

test('mailto fallback carries the Cc (percent-encoded, never "+")', () => {
  const url = buildMailtoUrl('ap@halavi.com', 'Invoice HAL-1', 'Line 1\nLine 2 & more', ['accounting@halavi.com', 'o@h.com'])
  assert.ok(url.startsWith('mailto:ap@halavi.com?'))
  assert.ok(url.includes('cc=accounting%40halavi.com%2Co%40h.com'))
  assert.ok(url.includes('subject=Invoice%20HAL-1'))
  assert.ok(!url.includes('+'))
  assert.ok(!buildMailtoUrl('a@x.com', 's', 'b').includes('cc='))
})
