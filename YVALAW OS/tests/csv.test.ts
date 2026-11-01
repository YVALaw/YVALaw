import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvToLeads, parseCsv } from '../src/utils/csv.ts'

test('CSV: quotes, commas and line breaks inside fields', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","line1\nline2"\r\n"he said ""hi""",z\n'), [['a', 'b'], ['x, y', 'line1\nline2'], ['he said "hi"', 'z']])
})

test('Netlify Forms export → leads (header names matched loosely)', () => {
  const csv = '﻿Name,Email,Phone,Company,Service,Message,Sms Consent,Source,Created At,ip\n' +
    'Maria Gómez,Maria@Law.com,305-1,Gómez Law,Legal Intake,"Need 2, maybe 3",Yes,Home page,2026-09-14 15:20:00 UTC,1.1.1.1\n' +
    ',,,,,,,,,\n'
  const { leads, columns } = csvToLeads(csv)
  assert.equal(leads.length, 1)
  assert.equal(leads[0].name, 'Maria Gómez'); assert.equal(leads[0].email, 'Maria@Law.com'); assert.equal(leads[0].message, 'Need 2, maybe 3')
  assert.equal(leads[0].sms_consent, true); assert.equal(leads[0].source, 'Home page'); assert.ok(leads[0].created_at?.startsWith('2026-09-14'))
  assert.ok(!columns.includes('ip'))
  const first = csvToLeads('First Name,Last Name,Email Address\nAna,Pérez,a@x.com\n').leads[0]
  assert.equal(first.name, 'Ana Pérez'); assert.equal(first.source, 'Imported from Netlify Forms')
})
