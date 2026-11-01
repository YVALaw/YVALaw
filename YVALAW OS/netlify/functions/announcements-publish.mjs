/**
 * announcements-publish — Netlify scheduled function (every 10 minutes, schedule set below in `config`)
 *
 * People → Announcements → "Schedule…" saves a post with a future published_at. Employees only see it
 * once that time has passed (RLS); this job notifies them at that moment through
 * public.announcements_publish_due() (supabase/migrate-redesign-people.sql). notifications-dispatch
 * then sends the email / phone push as for every other notification.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

export default async () => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return text(500, 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/announcements_publish_due`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  })
  const body = await res.text()
  if (res.status === 404) return text(200, 'announcements_publish_due not installed yet — run supabase/migrate-redesign-people.sql')
  if (!res.ok) { console.error('announcements-publish', res.status, body); return text(500, body) }
  return text(200, body)
}

export const config = { schedule: '*/10 * * * *' }
