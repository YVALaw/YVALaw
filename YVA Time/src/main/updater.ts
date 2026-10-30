// Automatic updates from GitHub Releases (the yva-time-v* tags built by
// .github/workflows/yva-time-windows.yml). New versions download in the background; the
// app shows "Restart to update", and anything not installed by then installs when the app
// quits. Never restarts on its own while someone is tracking.
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { UPDATE_EVERY_MS } from './config'

export type UpdateState = { version: string; ready: boolean } | null

let state: UpdateState = null
let onChange: (s: UpdateState) => void = () => {}

/** Only the installed Windows app updates itself (not `npm start` or tests) */
export function updatesEnabled(): boolean {
  return app.isPackaged && process.platform === 'win32' && !process.env.YVA_API_BASE
}

export function startUpdates(listener: (s: UpdateState) => void) {
  onChange = listener
  if (!updatesEnabled()) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', info => { state = { version: info.version, ready: false }; onChange(state) })
  autoUpdater.on('update-downloaded', info => { state = { version: info.version, ready: true }; onChange(state) })
  autoUpdater.on('error', e => console.error('update check failed (will retry)', e?.message ?? e))
  const check = () => { autoUpdater.checkForUpdates().catch(() => { /* offline: retry later */ }) }
  setTimeout(check, 30_000)
  setInterval(check, UPDATE_EVERY_MS)
}

export function updateState(): UpdateState {
  return state
}

/** "Restart to update": the caller saves and uploads first, then this quits and installs */
export function installNow() {
  if (state?.ready) autoUpdater.quitAndInstall(true, true)
}
