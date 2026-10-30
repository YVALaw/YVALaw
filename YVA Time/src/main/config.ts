// App settings. YVA_* environment variables exist only for local testing.

export const API_BASE      = (process.env.YVA_API_BASE || 'https://yvastaffing.agency').replace(/\/+$/, '')
export const CONNECT_URL   = `${API_BASE}/os/connect-app`
export const WORKSPACE_URL = `${API_BASE}/os/me`
export const PROTOCOL      = 'yvatime'

export const SYNC_EVERY_MS        = Number(process.env.YVA_SYNC_MS) || 60_000
export const SAVE_EVERY_MS        = 10_000
export const SCREENSHOT_DELETE_MS = 2 * 60_000
export const SIGN_IN_TIMEOUT_MS   = 10 * 60_000
export const TEST_SHOT_OFFSET_S   = process.env.YVA_TEST_SHOT_OFFSET ? Number(process.env.YVA_TEST_SHOT_OFFSET) : null
export const TEST_NO_BROWSER      = process.env.YVA_TEST_NO_BROWSER === '1'
export const TEST_IDLE_FILE       = process.env.YVA_TEST_IDLE_FILE || null   // file holding fake idle seconds
export const PROFILE_EVERY_MS     = 30 * 60_000

/** What YVA team members (no client project) can track against */
export const WORK_TYPES = [
  'Recruiting',
  'Sales / lead generation',
  'Admin',
  'Accounting',
  'Training',
  'Meetings',
  'Client support',
]
