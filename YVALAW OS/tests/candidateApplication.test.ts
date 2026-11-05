import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitApplication } from '../src/utils/candidateApplication.ts'

test('careers application: answers become fields, the message keeps its lines', () => {
  const r = splitApplication('Country: Dominican Republic\nLanguages: Spanish, English\nExperience: 3 years intake\nMessage: Hello,\nI can start Monday.\n\nThanks')
  assert.deepEqual(r.fields.map(f => f.label), ['Country', 'Languages', 'Experience', 'Message'])
  assert.equal(r.fields[3].value, 'Hello,\nI can start Monday.\n\nThanks')
  assert.equal(r.rest, '')
})

test('notes typed by the team stay notes; plain notes are unchanged', () => {
  assert.deepEqual(splitApplication('Great call, strong Spanish.'), { fields: [], rest: 'Great call, strong Spanish.' })
  assert.deepEqual(splitApplication(undefined), { fields: [], rest: '' })
  const r = splitApplication('Interview Tue 3pm\nCountry: Colombia\nLanguages: Spanish')
  assert.deepEqual(r.fields.map(f => [f.label, f.value]), [['Country', 'Colombia'], ['Languages', 'Spanish']])
  assert.equal(r.rest, 'Interview Tue 3pm')
})

test('a second "Country:" line later in the notes is kept as a note, not a new answer', () => {
  const r = splitApplication('Country: Peru\nLanguages: Spanish\nnote: Country: moved to Chile')
  assert.equal(r.fields.length, 2)
  assert.equal(r.rest, 'note: Country: moved to Chile')
})
