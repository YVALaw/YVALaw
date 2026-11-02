import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emailListForSave, formatEmailList, isEmail, mergeCc, normalizeEmailList, parseEmailList, recipientsLabel } from '../src/utils/emailList.ts'
import { buildMailtoUrl, buildMimeMessage, headerSafe } from '../src/utils/mime.ts'

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

const decode = (b64: string) => Buffer.from(b64.replace(/\r\n/g, ''), 'base64')

test('Gmail raw message: Cc header, UTF-8 subject, PDF attachment kept byte for byte', () => {
  const pdfBytes = Buffer.from('%PDF-1.7\n%âãÏÓ\nbinary\x00\x01\xff', 'latin1')
  const raw = buildMimeMessage({
    from: 'hans@yva.com', to: 'ap@halavi.com', cc: ['accounting@halavi.com', 'owner@halavi.com'],
    subject: 'Invoice HAL-0042 — YVA Staffing', body: 'Hi Halavi,\nPlease find attached.\nGracias — ñ',
    attachments: [{ name: 'Invoice-HAL-0042.pdf', mimeType: 'application/pdf', base64: pdfBytes.toString('base64') }],
    boundary: 'B',
  })
  const [head] = raw.split('\r\n\r\n')
  const headers = head.split('\r\n')
  assert.ok(headers.includes('To: ap@halavi.com'))
  assert.ok(headers.includes('Cc: accounting@halavi.com, owner@halavi.com'))
  assert.ok(headers.some(h => h.startsWith('Subject: =?UTF-8?B?')))
  assert.ok(headers.includes('Content-Type: multipart/mixed; boundary="B"'))
  const parts = raw.split('--B')
  const text = parts[1].split('\r\n\r\n')
  assert.equal(decode(text[1].trim()).toString('utf8'), 'Hi Halavi,\r\nPlease find attached.\r\nGracias — ñ')
  const att = parts[2]
  assert.ok(att.includes('Content-Type: application/pdf; name="Invoice-HAL-0042.pdf"'))
  assert.ok(att.includes('Content-Disposition: attachment; filename="Invoice-HAL-0042.pdf"'))
  const body = att.split('\r\n\r\n')[1].trim()
  assert.ok(body.split('\r\n').every(l => l.length <= 76))
  assert.deepEqual(decode(body), pdfBytes)
  assert.ok(raw.endsWith('--B--'))
})

test('Gmail raw message: no Cc header without cc; header injection removed everywhere', () => {
  const plain = buildMimeMessage({ from: 'a@x.com', to: 'b@y.com', subject: 'Hi', body: 'x' })
  assert.ok(!/\r\nCc:/.test(plain))
  assert.ok(plain.includes('Content-Type: text/plain; charset=utf-8'))
  const evil = buildMimeMessage({
    from: 'a@x.com', to: 'b@y.com\r\nBcc: spy@evil.com', cc: ['c@z.com\nBcc: spy2@evil.com'],
    subject: 'Hi\r\nBcc: spy3@evil.com', body: 'x',
    attachments: [{ name: 'a"\r\nX-Evil: 1.pdf', mimeType: 'application/pdf\r\nX-Evil: 2', base64: 'AAAA' }], boundary: 'B',
  })
  const headerLines = evil.split('\r\n').filter(l => /^[A-Za-z-]+: /.test(l))
  assert.ok(!headerLines.some(l => /^(Bcc|X-Evil):/i.test(l)), headerLines.join(' | '))
  assert.equal(headerSafe('a\r\nb'), 'a b')
})

test('mailto fallback carries the Cc (percent-encoded, never "+")', () => {
  const url = buildMailtoUrl('ap@halavi.com', 'Invoice HAL-1', 'Line 1\nLine 2 & more', ['accounting@halavi.com', 'o@h.com'])
  assert.ok(url.startsWith('mailto:ap@halavi.com?'))
  assert.ok(url.includes('cc=accounting%40halavi.com%2Co%40h.com'))
  assert.ok(url.includes('subject=Invoice%20HAL-1'))
  assert.ok(!url.includes('+'))
  assert.ok(!buildMailtoUrl('a@x.com', 's', 'b').includes('cc='))
})
