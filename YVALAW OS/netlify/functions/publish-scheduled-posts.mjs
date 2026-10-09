/**
 * publish-scheduled-posts — Netlify Scheduled Function (hourly, see netlify.toml)
 *
 * Marketing-site blog: posts whose publish date is still in the future are left out
 * of the site when it's built (build.js) and their dates are listed in
 * /posts/scheduled.json. When one of those dates has passed, this starts a new deploy
 * through a build hook so the post goes live. Hours with nothing due do nothing, so
 * there are no extra builds.
 *
 * Required env var:
 *   BLOG_BUILD_HOOK_URL — Netlify → Site configuration → Build & deploy →
 *                         Continuous deployment → Build hooks → Add build hook
 */

function text(status, body) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
}

export default async () => {
  const hook = process.env.BLOG_BUILD_HOOK_URL
  if (!hook) return text(200, 'BLOG_BUILD_HOOK_URL is not set; scheduled posts go live with the next deploy instead.')

  const site = process.env.URL || 'https://yvastaffing.agency'
  const res = await fetch(`${site}/posts/scheduled.json?t=${Date.now()}`)
  if (!res.ok) return text(200, `Could not read scheduled.json (${res.status})`)

  const { dates = [] } = await res.json()
  const now = Date.now()
  const due = dates.filter(date => new Date(date).getTime() <= now)
  if (!due.length) return text(200, `Nothing due (${dates.length} scheduled)`)

  const build = await fetch(hook, { method: 'POST' })
  return text(200, `Build triggered for ${due.length} post(s): ${build.status}`)
}
