/**
 * purge-old-screenshots — Netlify scheduled function (daily, see netlify.toml)
 *
 * YVA Time screenshots are kept for 90 days (employees are told this in the app's
 * notice). Deletes older screenshot files from the private `screenshots` bucket and
 * their tracker_screenshots rows. Hours (tracker_blocks) are not touched.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const KEEP_DAYS = 90
const BATCH = 100
const MAX_BATCHES = 50          // up to 5,000 per run; the rest goes the next day

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

export default async () => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return text(500, 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const headers = { Authorization: `Bearer ${key}`, apikey: key }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()

  let deleted = 0
  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await fetch(
      `${url}/rest/v1/tracker_screenshots?created_at=lt.${encodeURIComponent(cutoff)}&select=id,storage_path&order=created_at&limit=${BATCH}`,
      { headers: { ...headers, Accept: 'application/json' } },
    )
    if (!res.ok) return text(500, `Could not list old screenshots (${res.status}); deleted ${deleted}`)
    const rows = await res.json()
    if (rows.length === 0) break

    // Files first: a row is only removed once its file is gone
    const rm = await fetch(`${url}/storage/v1/object/screenshots`, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: rows.map(r => r.storage_path) }),
    })
    if (!rm.ok) return text(500, `Could not delete files (${rm.status}); deleted ${deleted}`)

    const ids = rows.map(r => r.id).join(',')
    const del = await fetch(`${url}/rest/v1/tracker_screenshots?id=in.(${ids})`, { method: 'DELETE', headers })
    if (!del.ok) return text(500, `Could not delete rows (${del.status}); deleted ${deleted}`)
    deleted += rows.length
    if (rows.length < BATCH) break
  }
  return text(200, `Deleted ${deleted} screenshot(s) older than ${KEEP_DAYS} days`)
}
