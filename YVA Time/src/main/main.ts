// YVA Time — Electron main process: window, tray icon, yvatime:// links, start with Windows.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { Controller } from './controller'
import { PROTOCOL } from './config'
import { installNow, startUpdates } from './updater'
import type { Snapshot, Target } from '../shared/types'

if (process.env.YVA_USER_DATA) app.setPath('userData', process.env.YVA_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const controller = new Controller()
  let win: BrowserWindow | null = null
  let tray: Tray | null = null
  let quitting = false
  let lastTrayState = ''

  const resource = (file: string) => path.join(__dirname, '..', 'resources', file)
  const deepLinkIn = (argv: string[]) => argv.find(a => a.startsWith(`${PROTOCOL}://`))

  function createWindow(show: boolean) {
    win = new BrowserWindow({
      width: 380, height: 660, resizable: false, maximizable: false, fullscreenable: false,
      show, title: 'YVA Time', autoHideMenuBar: true, backgroundColor: '#f4f5f7',
      icon: resource('icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    })
    void win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', e => e.preventDefault())
    win.on('close', e => {                       // closing keeps tracking in the tray
      if (!quitting) { e.preventDefault(); win?.hide() }
    })
  }

  function showWindow() {
    if (!win) createWindow(true)
    win!.show()
    win!.focus()
  }

  function updateTray(s: Snapshot) {
    if (!tray) return
    const state = s.status === 'running' ? 'active' : s.status === 'idle' || s.status === 'break' ? 'idle' : 'stopped'
    const key = `${state}|${s.phase}`
    if (key === lastTrayState) return
    lastTrayState = key
    tray.setImage(nativeImage.createFromPath(resource(`tray-${state}.png`)))
    tray.setToolTip(
      s.status === 'running' ? 'YVA Time — tracking' :
      s.status === 'break'   ? 'YVA Time — on break' :
      s.status === 'idle'    ? 'YVA Time — idle' : 'YVA Time — stopped')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open YVA Time', click: showWindow },
      { type: 'separator' },
      { label: 'Stop tracking', enabled: s.status !== 'stopped', click: () => void controller.stop() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]))
  }

  // Only our own page may call the controller
  const fromApp = (e: IpcMainInvokeEvent) => e.senderFrame?.url.startsWith('file://') === true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arguments come from IPC and are coerced in each handler
  const handlers: Record<string, (...args: any[]) => unknown> = {
    getSnapshot:      () => controller.snapshot(),
    signIn:           () => controller.signIn(),
    redeemCode:       (code: string) => controller.redeemCode(String(code)),
    cancelSignIn:     () => controller.cancelSignIn(),
    signOut:          () => controller.signOut(),
    acceptConsent:    () => controller.acceptConsent(),
    start:            (target: Target, note: string) => controller.start(target, String(note ?? '')),
    stop:             () => controller.stop(),
    setTarget:        (target: Target) => controller.setTarget(target),
    setNote:          (note: string) => controller.setNote(String(note ?? '')),
    startBreak:       () => controller.startBreak(),
    endBreak:         () => controller.endBreak(),
    resolveIdle:      (keep: boolean) => controller.resolveIdle(keep === true),
    deleteScreenshot: () => controller.deleteScreenshot(),
    openWorkspace:    () => controller.openWorkspace(),
    openAddTime:      () => controller.openAddTime(),
    installUpdate:    () => installNow(),       // quits (saving + uploading first, below) and installs
  }
  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(`yva:${name}`, (e, ...args: unknown[]) => {
      if (!fromApp(e)) throw new Error('blocked')
      return fn(...args)
    })
  }

  app.on('second-instance', (_e, argv) => {
    const link = deepLinkIn(argv)
    if (link) void controller.handleDeepLink(link)
    showWindow()
  })
  app.on('open-url', (e, url) => { e.preventDefault(); void controller.handleDeepLink(url) })
  app.on('window-all-closed', () => { /* keep running in the tray */ })
  // Stop the timer, save and upload, then quit for real (a normal quit, so a downloaded
  // update installs on the way out)
  app.on('before-quit', e => {
    if (quitting) return
    e.preventDefault()
    quitting = true
    void controller.shutdown().finally(() => app.quit())
  })

  void app.whenReady().then(async () => {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL)
    }
    if (process.platform === 'win32') {
      app.setAppUserModelId('agency.yvastaffing.time')   // same as build.appId; Windows needs it for notifications
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    }
    Menu.setApplicationMenu(null)
    createWindow(!process.argv.includes('--hidden'))
    tray = new Tray(nativeImage.createFromPath(resource('tray-stopped.png')))
    tray.on('click', showWindow)
    controller.onNotify((title, body) => {
      if (!Notification.isSupported()) return
      const n = new Notification({ title, body, icon: resource('icon.png') })
      n.on('click', showWindow)
      n.show()
    })
    controller.onSnapshot(s => {
      if (win && !win.isDestroyed()) win.webContents.send('yva:snapshot', s)
      updateTray(s)
    })
    await controller.init()
    startUpdates(u => controller.setUpdate(u))
    const link = deepLinkIn(process.argv)
    if (link) void controller.handleDeepLink(link)
  })
}
