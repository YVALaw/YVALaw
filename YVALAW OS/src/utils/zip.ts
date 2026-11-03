// A tiny .zip writer (no compression — "stored" entries) for bundling the invoice PDFs of a bulk download into one
// file. PDFs are already compressed, so storing them costs almost nothing and keeps this ~60 lines with no library.
// Pure (no imports): the unit tests run it directly under node.

let crcTable: Uint32Array | null = null
function table(): Uint32Array {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  return crcTable
}

/** CRC-32 (the checksum every zip entry carries) */
export function crc32(bytes: Uint8Array): number {
  const t = table()
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/** "Invoice-HAL-0001.pdf" twice → "Invoice-HAL-0001.pdf", "Invoice-HAL-0001 (2).pdf" */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map(raw => {
    const name = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'file'
    const key = name.toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n === 1) return name
    const dot = name.lastIndexOf('.')
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
  })
}

/** Files → the bytes of a .zip (stored entries, UTF-8 names, today's date) */
export function makeZip(files: { name: string; data: Uint8Array }[], when: Date = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const names = uniqueNames(files.map(f => f.name))
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)
  const dosDate = ((Math.max(when.getFullYear(), 1980) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  files.forEach((f, i) => {
    const name = enc.encode(names[i])
    const crc = crc32(f.data), size = f.data.length
    const head = new DataView(new ArrayBuffer(30))
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true)   // version, flags: UTF-8 names
    head.setUint16(8, 0, true); head.setUint16(10, dosTime, true); head.setUint16(12, dosDate, true)     // method 0 = stored
    head.setUint32(14, crc, true); head.setUint32(18, size, true); head.setUint32(22, size, true)
    head.setUint16(26, name.length, true); head.setUint16(28, 0, true)
    const local = concat([new Uint8Array(head.buffer), name, f.data])
    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true)
    cen.setUint32(16, crc, true); cen.setUint32(20, size, true); cen.setUint32(24, size, true)
    cen.setUint16(28, name.length, true); cen.setUint16(30, 0, true); cen.setUint16(32, 0, true)
    cen.setUint16(34, 0, true); cen.setUint16(36, 0, true); cen.setUint32(38, 0, true); cen.setUint32(42, offset, true)
    centrals.push(concat([new Uint8Array(cen.buffer), name]))
    locals.push(local)
    offset += local.length
  })
  const central = concat(centrals)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, central.length, true); end.setUint32(16, offset, true)
  return concat([...locals, central, new Uint8Array(end.buffer)])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** base64 (a PDF attachment from utils/pdf.ts) → bytes */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
