// Small CSV reader (quoted fields, commas and line breaks inside quotes, "" escapes, BOM) and writer (toCsv).

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  const s = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(f => f.trim() !== '')) rows.push(row)
  return rows
}

export type ImportedLead = { name: string; email: string | null; phone: string | null; company: string | null; website: string | null
  service: string | null; message: string | null; source: string | null; created_at: string | null; sms_consent: boolean }

const KEYS: Record<keyof ImportedLead | 'first' | 'last', string[]> = {
  name: ['name', 'fullname', 'yourname', 'contactname'], first: ['firstname', 'first'], last: ['lastname', 'last', 'surname'],
  email: ['email', 'emailaddress', 'youremail', 'mail'], phone: ['phone', 'phonenumber', 'telephone', 'mobile', 'whatsapp'],
  company: ['company', 'firm', 'firmname', 'lawfirm', 'business', 'companyname'], website: ['website', 'site', 'url', 'web'],
  service: ['service', 'services', 'role', 'position', 'interest'], message: ['message', 'notes', 'comments', 'details', 'description'],
  source: ['source', 'page', 'formname', 'form'], created_at: ['createdat', 'created', 'date', 'submittedat', 'submitted', 'timestamp', 'time'],
  sms_consent: ['smsconsent', 'sms'],
}

/** Rows of a CSV (first line = headers) → leads; unknown columns are ignored */
export function csvToLeads(text: string, defaultSource = 'Imported from Netlify Forms'): { leads: ImportedLead[]; columns: string[] } {
  const [head, ...rows] = parseCsv(text)
  if (!head) return { leads: [], columns: [] }
  const norm = head.map(h => h.toLowerCase().replace(/[^a-z]/g, ''))
  const col = (k: keyof typeof KEYS) => norm.findIndex(h => KEYS[k].includes(h))
  const idx = Object.fromEntries((Object.keys(KEYS) as (keyof typeof KEYS)[]).map(k => [k, col(k)])) as Record<keyof typeof KEYS, number>
  const get = (r: string[], k: keyof typeof KEYS) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '')
  const leads = rows.map(r => {
    const name = get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ')
    const when = get(r, 'created_at')
    const t = when ? Date.parse(when) : NaN
    const email = get(r, 'email')
    return {
      name: name || email, email: email || null, phone: get(r, 'phone') || null, company: get(r, 'company') || null,
      website: get(r, 'website') || null, service: get(r, 'service') || null, message: get(r, 'message') || null,
      source: get(r, 'source') || defaultSource, created_at: Number.isFinite(t) ? new Date(t).toISOString() : null,
      sms_consent: /^(yes|true|1|on)$/i.test(get(r, 'sms_consent')),
    }
  }).filter(l => l.name || l.email)
  return { leads, columns: head.filter((_, i) => Object.values(idx).includes(i)) }
}

// ─── Writer ───────────────────────────────────────────────────────────────────

// A cell that starts with = + - @ (or a tab / carriage return) is run as a formula by Excel / Sheets
// ("CSV injection"). Those cells get a leading apostrophe — except plain numbers and phone numbers
// ("+1 617 555 0188", "-12.5"), which can't call anything.
const FORMULA_START = /^[=+\-@\t\r]/
const NUMBER_OR_PHONE = /^[+-]?[\d\s().,-]+$/

/** One cell: quoted when needed (comma, quote, line break, edge spaces), quotes doubled, formulas neutralised */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (FORMULA_START.test(s) && !NUMBER_OR_PHONE.test(s)) s = `'${s}`
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows → CSV text (CRLF line ends). `bom` adds the byte-order mark so Excel reads accents (é, ñ) correctly. */
export function toCsv(rows: readonly (readonly unknown[])[], { bom = true }: { bom?: boolean } = {}): string {
  return (bom ? '﻿' : '') + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Browser only: save rows as a .csv file */
export function downloadCsvFile(filename: string, rows: readonly (readonly unknown[])[]): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
