// "Install YVA OS app": Chrome/Edge/Android fire beforeinstallprompt (kept here); iPhone uses Share → Add to Home Screen.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as InstallEvent })
  window.addEventListener('appinstalled', () => { deferred = null })
}
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)
export const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
export const canPromptInstall = () => !!deferred
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  await deferred.prompt()
  const r = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }))
  deferred = null
  return r.outcome === 'accepted'
}
