/**
 * application-intake — public POST from careers.html. Puts the application straight into
 * YVA OS → Candidates (stage "applied", source "Careers page") and notifies the hiring team
 * (CEO, Admin, Recruiter). Sent in the background after the EmailJS notification.
 *   { name, email, phone, country, languages, experience, linkedin, message, role, hp }
 */
const crypto = require('node:crypto')
const { rest, enc } = require('./_lib/supa.cjs')
const { notify, dispatchPending } = require('./_lib/notify.cjs')

const ALLOWED = [/^https:\/\/(www\.)?yvastaffing\.agency$/, /^https:\/\/[a-z0-9-]+--yvalaw\.netlify\.app$/, /^https:\/\/yvalaw\.netlify\.app$/, /^http:\/\/localhost(:\d+)?$/]
const hits = new Map()
const reply = (code, body, origin) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': ALLOWED.some(r => r.test(origin || '')) ? origin : 'https://yvastaffing.agency', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }, body: JSON.stringify(body) })
const clip = (v, n) => (v == null ? null : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n) || null)

exports.handler = async function handler(event) {
  const h = event.headers || {}
  const origin = h.origin || h.Origin || ''
  if (event.httpMethod === 'OPTIONS') return reply(200, { ok: true }, origin)
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' }, origin)
  if (!ALLOWED.some(r => r.test(origin))) return reply(403, { error: 'Not allowed' }, origin)
  if ((event.body || '').length > 20000) return reply(413, { error: 'Too large' }, origin)
  let b
  try { b = JSON.parse(event.body || '{}') } catch { return reply(400, { error: 'Invalid' }, origin) }
  if (b.hp) return reply(200, { ok: true }, origin)
  const ip = String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim()
  const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 10 * 60_000)
  if (ip && recent.length >= 5) return reply(429, { error: 'Too many requests' }, origin)
  hits.set(ip, [...recent, now])
  const name = clip(b.name, 200), email = clip(b.email, 254)?.toLowerCase(), role = clip(b.role, 120)
  // Only real web links (a javascript: link would run code when a recruiter clicks it)
  const linkedin = /^https?:\/\/[^\s]+$/i.test(String(b.linkedin || '').trim()) ? clip(b.linkedin, 300) : null
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: 'Name and a valid email are required' }, origin)
  try {
    const hour = new Date(now - 3600_000).toISOString()
    const lastHour = await rest(`candidates?source=eq.Careers%20page&created_at=gt.${enc(hour)}&select=id&limit=41`).catch(() => [])
    if (lastHour.length > 40) return reply(429, { error: 'Too many requests' }, origin)
    const since = new Date(now - 86_400_000).toISOString().slice(0, 10)
    const dup = await rest(`candidates?email=eq.${enc(email)}&applied_at=gte.${since}&select=id,role&limit=5`).catch(() => [])
    if (dup.some(d => (d.role || '') === (role || ''))) return reply(200, { ok: true, duplicate: true }, origin)
    const notes = [
      b.country && `Country: ${clip(b.country, 80)}`, b.languages && `Languages: ${clip(b.languages, 200)}`,
      b.experience && `Experience: ${clip(b.experience, 200)}`, b.message && `Message: ${clip(b.message, 3000)}`,
    ].filter(Boolean).join('\n')
    const base = { id: crypto.randomUUID(), name, email, phone: clip(b.phone, 50), role, source: 'Careers page', stage: 'applied', notes: notes || null }
    try {
      await rest('candidates', { method: 'POST', body: { ...base, linkedin_url: linkedin, applied_at: new Date(now).toISOString().slice(0, 10), updated_at: now } })
    } catch (e) {
      if (e.status !== 400) throw e
      // an older candidates table without some optional columns: keep the essentials (LinkedIn into the notes)
      await rest('candidates', { method: 'POST', body: { ...base, notes: [base.notes, linkedin && `LinkedIn: ${linkedin}`].filter(Boolean).join('\n') || null } })
    }
    const team = await rest('user_roles?role=in.(ceo,admin,recruiter)&select=user_id')
    await notify(team.map(t => t.user_id), { kind: 'application_new', title: `New application: ${name}${role ? ` — ${role}` : ''}`, body: [clip(b.country, 80), clip(b.languages, 200)].filter(Boolean).join(' · ') || null, link: '/candidates' })
    try { await dispatchPending({ limit: 20 }) } catch { /* the 5-minute job catches it */ }
    return reply(200, { ok: true }, origin)
  } catch (e) {
    console.error('application-intake', e)
    return reply(500, { error: 'Could not save' }, origin)
  }
}
