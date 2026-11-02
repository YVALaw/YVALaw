// Email address lists: Invoice CC on clients, Statement CC on employees, and who an email goes To / Cc.
// Pure (no imports) so tests/emailList.test.ts can run it directly.

export type ParsedEmailList = { emails: string[]; invalid: string[] }

const SPLIT_RE = /[,;\n\r\s]+/
// No whitespace anywhere (so no line breaks can reach a mail header), one @, a dot in the domain
const EMAIL_RE = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/

export const isEmail = (value: string): boolean => EMAIL_RE.test(value.trim())

/** "a@x.com, b@y.com; c@z.com" → valid addresses (first spelling kept, duplicates dropped, case-insensitive) + the entries that aren't addresses */
export function parseEmailList(value: string | null | undefined): ParsedEmailList {
  const emails: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const raw of String(value ?? '').split(SPLIT_RE)) {
    const part = raw.trim()
    if (!part) continue
    if (!EMAIL_RE.test(part)) { invalid.push(part); continue }
    const key = part.toLowerCase()
    if (!seen.has(key)) { seen.add(key); emails.push(part) }
  }
  return { emails, invalid }
}

/** ["a@x.com", "b@y.com"] → "a@x.com, b@y.com" */
export function formatEmailList(emails?: readonly (string | null | undefined)[] | null): string {
  return (emails ?? []).filter((e): e is string => !!e && !!e.trim()).map(e => e.trim()).join(', ')
}

/** A stored list (text[] from the database, or an older comma string) → clean addresses */
export function normalizeEmailList(value: unknown): string[] {
  if (Array.isArray(value)) return parseEmailList(value.filter(v => typeof v === 'string').join(',')).emails
  if (typeof value === 'string') return parseEmailList(value).emails
  return []
}

/** The Cc list for an email to `to`: every valid address from the lists, once each, never the To address itself */
export function mergeCc(to: string | null | undefined, ...lists: (readonly (string | null | undefined)[] | null | undefined)[]): string[] {
  const toKeys = new Set(parseEmailList(to ?? '').emails.map(e => e.toLowerCase()))
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    for (const raw of list ?? []) {
      const e = (raw ?? '').trim()
      if (!e || !EMAIL_RE.test(e)) continue
      const key = e.toLowerCase()
      if (toKeys.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
  }
  return out
}

/** "to a@x.com (cc b@y.com, c@z.com)" — for messages and history */
export function recipientsLabel(to: string, cc: readonly string[] = []): string {
  return `${to}${cc.length ? ` (cc ${cc.join(', ')})` : ''}`
}

/** A form value → what a record stores: the list, or undefined when empty (an empty list is never written,
 *  so a database without the column yet — migrate-cc-emails.sql not run — is never sent the key) */
export function emailListForSave(value: string): string[] | undefined {
  const { emails } = parseEmailList(value)
  return emails.length ? emails : undefined
}
