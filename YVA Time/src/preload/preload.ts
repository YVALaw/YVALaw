// Exposes a small, fixed API to the UI as window.yva (no Node access in the page).
import { contextBridge, ipcRenderer } from 'electron'
import type { Snapshot, Target, YvaApi } from '../shared/types'

const call = (name: string, ...args: unknown[]) => ipcRenderer.invoke(`yva:${name}`, ...args)

const api: YvaApi = {
  getSnapshot:      () => call('getSnapshot') as Promise<Snapshot>,
  onSnapshot: cb => {
    const listener = (_e: unknown, s: Snapshot) => cb(s)
    ipcRenderer.on('yva:snapshot', listener)
    return () => { ipcRenderer.removeListener('yva:snapshot', listener) }
  },
  signIn:           () => call('signIn'),
  redeemCode:       (code: string) => call('redeemCode', code),
  cancelSignIn:     () => call('cancelSignIn'),
  signOut:          () => call('signOut'),
  acceptConsent:    () => call('acceptConsent'),
  start:            (target: Target, note: string) => call('start', target, note),
  stop:             () => call('stop'),
  setTarget:        (target: Target) => call('setTarget', target),
  setNote:          (note: string) => call('setNote', note),
  startBreak:       () => call('startBreak'),
  endBreak:         () => call('endBreak'),
  resolveIdle:      (keep: boolean) => call('resolveIdle', keep),
  deleteScreenshot: () => call('deleteScreenshot'),
  openWorkspace:    () => call('openWorkspace'),
}

contextBridge.exposeInMainWorld('yva', api)
