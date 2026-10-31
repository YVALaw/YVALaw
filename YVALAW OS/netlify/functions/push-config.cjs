/**
 * push-config — GET. The public Web Push key browsers need to subscribe
 * (created automatically the first time; see _lib/webpush.cjs).
 */
const { json } = require('./_lib/supa.cjs')
const { vapidKeys } = require('./_lib/webpush.cjs')

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })
  try {
    const { publicKey } = await vapidKeys()
    return json(200, { publicKey }, { 'Cache-Control': 'public, max-age=300' })
  } catch (e) {
    console.error('push-config', e)
    return json(500, { error: 'Phone notifications are not set up yet (run supabase/migrate-step1-foundation.sql).' })
  }
}
