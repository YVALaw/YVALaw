// Display helpers shared by the redesigned screens.
export const usd = (n: number | null | undefined, opts: { cents?: boolean } = {}) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: opts.cents === false ? 0 : 2, maximumFractionDigits: opts.cents === false ? 0 : 2 })
export const usdShort = (n: number | null | undefined) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '')}k`
  return usd(v, { cents: false })
}
export const dop = (n: number | null | undefined) => `RD$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
/** seconds → "7h 20m" */
export const hmText = (seconds: number) => { const neg = seconds < 0; const m = Math.round(Math.abs(seconds) / 60); return `${neg ? '−' : ''}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }
/** seconds → "7:20" (Geist Mono in the UI) */
export const hmClock = (seconds: number) => { const m = Math.round(Math.max(0, seconds) / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }
export const initials = (name?: string | null) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
const toDate = (d: string | number | Date) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d))
export const dateShort = (d?: string | number | Date | null) => (d ? toDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')
export const dateMed = (d?: string | number | Date | null) => (d ? toDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
export const weekdayDate = (d?: string | number | Date | null) => (d ? toDate(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '')
export const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d < 7 ? `${d}d ago` : dateShort(ms)
}
