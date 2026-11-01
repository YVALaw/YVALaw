/**
 * lead-intake — public POST from the website booking forms (assets/js/lead-send.js).
 * Saves the lead in YVA OS → Leads (and notifies leads.manage holders through a database trigger).
 *   { name, email, phone, company, website, service, message, source, sms_consent, utm, hp }
 *     → { id, token }        (hp = hidden honeypot field; bots fill it, people don't)
 *   { kind: 'calendly', id, token } → marks that lead "Calendly booked"
 * Same email again within 30 minutes updates the existing lead instead of creating another.
 * Never blocks the visitor: the page sends this in the background after EmailJS.
 */
const crypto = require('node:crypto')
const { rest, enc } = require('./_lib/supa.cjs')

const ALLOWED = [/^https:\/\/(www\.)?yvastaffing\.agency$/, /^https:\/\/[a-z0-9-]+--yvalaw\.netlify\.app$/, /^https:\/\/yvalaw\.netlify\.app$/, /^http:\/\/localhost(:\d+)?$/]
const hits = new Map()   // ip → timestamps (per function instance)

function cors(origin) {
  const ok = ALLOWED.some(r => r.test(origin || ''))
  return { 'Access-Control-Allow-Origin': ok ? origin : 'https://yvastaffing.agency', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
}
const reply = (code, body, origin) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) }, body: JSON.stringify(body) })
const clip = (v, n) => (v == null ? null : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n) || null)
const tokenFor = id => crypto.createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || 'x').update(`lead:${id}`).digest('hex').slice(0, 32)

exports.handler = async function handler(event) {
  const h = event.headers || {}
  const origin = h.origin || h.Origin || ''
  if (event.httpMethod === 'OPTIONS') return reply(200, { ok: true }, origin)
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' }, origin)
  // Browsers always send Origin on a POST; scripts without one (or from other sites) are refused
  if (!ALLOWED.some(r => r.test(origin))) return reply(403, { error: 'Not allowed' }, origin)
  if ((event.body || '').length > 20000) return reply(413, { error: 'Too large' }, origin)
  let b
  try { b = JSON.parse(event.body || '{}') } catch { return reply(400, { error: 'Invalid' }, origin) }

  try {
    if (b.kind === 'calendly') {
      if (!/^[0-9a-f-]{36}$/.test(String(b.id || '')) || b.token !== tokenFor(b.id)) return reply(403, { error: 'Not allowed' }, origin)
      // Only moves an early lead to Meeting (never a lead staff already advanced, won or lost); the token is only accepted for 14 days
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
      const hit = await rest(`leads?id=eq.${b.id}&created_at=gt.${enc(since)}&select=id,stage`)
      if (!hit.length) return reply(200, { ok: true }, origin)
      await rest(`leads?id=eq.${b.id}`, { method: 'PATCH', body: { calendly_booked: true, ...(['new', 'contacted'].includes(hit[0].stage) ? { stage: 'meeting' } : {}) } })
      await rest('lead_activities', { method: 'POST', body: { lead_id: b.id, kind: 'system', body: 'Booked a call on Calendly', created_by: null } }).catch(() => {})
      return reply(200, { ok: true }, origin)
    }
    if (b.hp) return reply(200, { ok: true }, origin)                                 // honeypot: pretend success
    const ip = String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim()
    const now = Date.now(), recent = (hits.get(ip) || []).filter(t => now - t < 10 * 60_000)
    if (ip && recent.length >= 6) return reply(429, { error: 'Too many requests' }, origin)
    hits.set(ip, [...recent, now])
    // Site-wide cap (the per-visitor one resets when Netlify starts a new instance): protects staff
    // phones/inboxes and the Gmail sending quota from a flood of fake leads
    const hour = new Date(now - 3600_000).toISOString()
    const lastHour = await rest(`leads?created_at=gt.${enc(hour)}&select=id&limit=61`)
    if (lastHour.length > 60) return reply(429, { error: 'Too many requests' }, origin)

    const name = clip(b.name, 200) || clip([b.first_name, b.last_name].filter(Boolean).join(' '), 200)
    const email = clip(b.email, 254)?.toLowerCase() || null
    const phone = clip(b.phone, 50)
    if (!name || (!email && !phone)) return reply(400, { error: 'Name and email or phone are required' }, origin)
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: 'Invalid email' }, origin)
    const row = {
      name, email, phone: phone === 'Not provided' ? null : phone,
      company: clip(b.company || b.firm_name, 200), website: clip(b.website, 300), service: clip(b.service, 120),
      message: clip(b.message, 5000), source: clip(b.source, 120) || 'Website', sms_consent: /^(yes|true|on|1)$/i.test(String(b.sms_consent || '')),
      utm: Object.fromEntries(Object.entries(b.utm && typeof b.utm === 'object' ? b.utm : {}).filter(([k]) => /^utm_[a-z]+$|^gclid$|^fbclid$/.test(k)).slice(0, 8).map(([k, v]) => [k, String(v).slice(0, 200)])),
    }
    // Same person within 30 minutes (e.g. EmailJS + backup form): update instead of a duplicate
    if (email) {
      const since = new Date(now - 30 * 60_000).toISOString()
      const [dup] = await rest(`leads?email=eq.${enc(email)}&created_at=gt.${enc(since)}&select=*&order=created_at.desc&limit=1`)
      if (dup) {
        // Never overwrite what's there (anyone could post someone else's email): only fill empty fields,
        // and keep a different message as a note on the lead
        const fill = Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== null && v !== '' && typeof v !== 'object' && typeof v !== 'boolean' && (dup[k] === null || dup[k] === '')))
        if (Object.keys(fill).length) await rest(`leads?id=eq.${dup.id}`, { method: 'PATCH', body: fill })
        if (row.message && dup.message && row.message !== dup.message) {
          await rest('lead_activities', { method: 'POST', body: { lead_id: dup.id, kind: 'system', body: `Sent the form again: ${row.message}`.slice(0, 4000), created_by: null } }).catch(() => {})
        }
        return reply(200, { id: dup.id, token: tokenFor(dup.id) }, origin)
      }
    }
    const [created] = await rest('leads', { method: 'POST', prefer: 'return=representation', body: row })
    // Deliver the "new lead" notification right away (the 5-minute job would catch it otherwise)
    try { await require('./_lib/notify.cjs').dispatchPending({ limit: 20 }) } catch (e) { console.warn('lead-intake: dispatch', e.message) }
    return reply(200, { id: created.id, token: tokenFor(created.id) }, origin)
  } catch (e) {
    console.error('lead-intake', e)
    return reply(500, { error: 'Could not save' }, origin)
  }
}
