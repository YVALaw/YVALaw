// Runs YVA Time: counting, screenshots, uploads, the offline queue and the UI snapshot.
// Everything is saved on this computer first and uploaded every minute, so a lost
// connection or a crash never loses tracked time (time while the app isn't running
// is never counted). Each upload starts with a check-in that confirms YVA hasn't
// disconnected this computer.
import { app, powerMonitor, shell } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type { Profile, Snapshot, Target } from '../shared/types'
import { Tracker, blockStartOf } from './tracker'
import * as auth from './auth'
import * as api from './api'
import { captureScreens } from './screenshots'
import { reminderDue, type ReminderMemory } from './reminders'
import { dataPath, readJson, writeJson } from './store'
import type { UpdateState } from './updater'
import {
  CONSENT_VERSION, PROFILE_EVERY_MS, SAVE_EVERY_MS, SCREENSHOT_DELETE_MS, SYNC_EVERY_MS,
  TEST_IDLE_FILE, TEST_NO_BROWSER, TEST_SHOT_OFFSET_S, WORK_TYPES, WORKSPACE_URL,
} from './config'

type QueuedShot = { id: string; groupId: string; path: string; file: string; blockStart: number; takenAt: number; monitor: number }
type ShotGroup  = { groupId: string; blockStart: number; takenAt: number; preview: string; paths: string[]; uploaded: string[]; deleting: boolean }

type Saved = {
  tracker: ReturnType<Tracker['serialize']> | null
  profile: Profile | null
  consentAt: number | null
  consentVersion?: number             // missing = notice version 1 (screenshots only)
  consentSynced?: boolean
  reminders?: ReminderMemory
  lastTarget: Target | null
  queue: QueuedShot[]
}

const DAY_MS = 86_400_000
const DISCONNECTED_MESSAGE = 'YVA disconnected this computer from your account. Sign in again to keep tracking — time not uploaded yet stays on this computer.'

function startOfDay(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime()
}
function startOfWeek(ms: number): number {           // Monday 00:00, local time
  const d = new Date(startOfDay(ms)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime()
}

export class Controller {
  private tracker = new Tracker({ shotOffsetS: TEST_SHOT_OFFSET_S })
  private phase: Snapshot['phase'] = 'signed-out'
  private profile: Profile | null = null
  private consentAt: number | null = null
  private consentVersion = 0
  private consentSynced = false
  private update: UpdateState = null
  private reminders: ReminderMemory = { start: null, end: null }
  private notify: (title: string, body: string) => void = () => {}
  private lastTarget: Target | null = null
  private queue: QueuedShot[] = []
  private lastShot: ShotGroup | null = null
  private online = true
  private lastSavedAt: number | null = null
  private message: string | null = null
  private syncing = false
  private uploadingShots = false
  private capturing = false
  private listeners = new Set<(s: Snapshot) => void>()
  private timers: NodeJS.Timeout[] = []

  onSnapshot(cb: (s: Snapshot) => void) { this.listeners.add(cb) }
  onNotify(cb: (title: string, body: string) => void) { this.notify = cb }

  async init() {
    const saved = readJson<Saved | null>('state.json', null)
    this.tracker.restore(saved?.tracker ?? null)
    this.profile    = saved?.profile ?? null
    this.consentAt  = saved?.consentAt ?? null
    this.consentVersion = saved?.consentAt ? saved.consentVersion ?? 1 : 0
    this.consentSynced = saved?.consentSynced ?? false
    this.reminders  = saved?.reminders ?? { start: null, end: null }
    this.lastTarget = saved?.lastTarget ?? null
    this.queue      = (saved?.queue ?? []).filter(q => fs.existsSync(q.file))
    if (this.profile) this.tracker.setScreenshots(this.profile.worksFor === 'client')

    this.timers.push(setInterval(() => this.everySecond(), 1000))
    this.timers.push(setInterval(() => void this.sync(), SYNC_EVERY_MS))
    this.timers.push(setInterval(() => this.save(), SAVE_EVERY_MS))
    this.timers.push(setInterval(() => { if (this.phase === 'ready') void this.refreshProfile() }, PROFILE_EVERY_MS))

    if (auth.getClient()) {
      this.phase = this.profile ? 'ready' : 'loading'
      this.emit()
      await this.refreshProfile()
    }
    this.emit()
  }

  /** Quit: stop the timer, save, and give the last upload a few seconds */
  async shutdown() {
    this.timers.forEach(clearInterval)
    if (this.tracker.status !== 'stopped') this.tracker.stop()
    this.save()
    await Promise.race([this.sync(), new Promise(r => setTimeout(r, 4000))])
    this.save()
  }

  // ── Sign-in ────────────────────────────────────────────────────────────────

  async signIn() {
    this.message = null
    const url = auth.beginSignIn()
    if (TEST_NO_BROWSER) fs.writeFileSync(dataPath('last-sign-in-url.txt'), url)
    else await shell.openExternal(url)
    this.emit()
  }

  async cancelSignIn() { auth.cancelSignIn(); this.emit() }

  async redeemCode(code: string, state?: string) {
    this.message = null
    try {
      await auth.redeem(code, state, app.getVersion())
      this.phase = 'loading'
      this.emit()
      await this.refreshProfile()
    } catch (e) {
      this.message = (e as Error).message
    }
    this.emit()
  }

  async handleDeepLink(url: string) {
    const link = auth.parseDeepLink(url)
    if (link) await this.redeemCode(link.code, link.state)
  }

  async signOut() {
    if (this.tracker.status !== 'stopped') this.tracker.stop()
    await Promise.race([this.sync(), new Promise(r => setTimeout(r, 4000))])
    const c = auth.getClient(), device = auth.deviceId()
    if (c && device) await Promise.race([api.markSignedOut(c, device).catch(() => {}), new Promise(r => setTimeout(r, 3000))])
    await auth.signOut()
    this.phase = 'signed-out'
    this.message = null
    this.save()
    this.emit()
  }

  private async toSignedOut(message: string) {
    if (this.tracker.status !== 'stopped') this.tracker.stop()
    this.phase = 'signed-out'
    this.message = message
    this.save()
  }

  /** YVA disconnected this computer: its login was ended on the server, so just forget it */
  private disconnected() {
    if (this.tracker.status !== 'stopped') this.tracker.stop()
    auth.forget()
    this.phase = 'signed-out'
    this.message = DISCONNECTED_MESSAGE
    this.save()
  }

  private consentMissing(): boolean {
    return !!this.profile && this.profile.worksFor === 'client' && (!this.consentAt || this.consentVersion < CONSENT_VERSION)
  }

  setUpdate(u: UpdateState) { this.update = u; this.emit() }

  private async refreshProfile() {
    const token = await auth.accessToken()
    if (!token) { await this.toSignedOut('Please sign in again.'); this.emit(); return }
    try {
      const profile = await api.fetchProfile(token)
      if (this.profile && this.profile.employeeId !== profile.employeeId) this.resetForNewPerson()
      this.profile = profile
      this.tracker.setScreenshots(profile.worksFor === 'client')
      this.phase = 'ready'
      this.online = true
      const rows = await api.loadRecentBlocks(auth.getClient()!, profile.employeeId, Math.min(startOfWeek(Date.now()), Date.now() - 7 * DAY_MS))
      this.tracker.mergeServer(rows)
      this.save()
    } catch (e) {
      if (e instanceof api.SignedOutError) await this.toSignedOut('Please sign in again.')
      else if (e instanceof api.OfflineError) { this.online = false; if (this.profile) this.phase = 'ready' }
      else { this.message = (e as Error).message; if (this.profile) this.phase = 'ready' }
    }
    this.emit()
  }

  /** A different person signed in on this computer: forget the previous person's local data */
  private resetForNewPerson() {
    this.tracker = new Tracker({ shotOffsetS: TEST_SHOT_OFFSET_S })
    for (const q of this.queue) fs.rmSync(q.file, { force: true })
    this.queue = []
    this.lastShot = null
    this.consentAt = null
    this.consentVersion = 0
    this.consentSynced = false
    this.reminders = { start: null, end: null }
    this.lastTarget = null
  }

  // ── Tracking controls ──────────────────────────────────────────────────────

  private allowedTarget(t: Target): boolean {
    if (!this.profile) return false
    if (t.kind === 'project') return this.profile.projects.some(p => p.id === t.projectId)
    return this.profile.worksFor === 'yva' && WORK_TYPES.includes(t.workType)
  }

  async start(target: Target, note: string) {
    this.message = null
    if (this.phase !== 'ready' || !this.profile) return
    if (this.consentMissing()) return
    if (!this.allowedTarget(target)) { this.message = 'Pick one of your projects first.'; this.emit(); return }
    this.tracker.start(target, note.slice(0, 500), Date.now())
    this.lastTarget = target
    this.save(); this.emit()
  }

  async stop() {
    this.tracker.stop()
    this.save(); this.emit()
    void this.sync()
  }

  async setTarget(target: Target) {
    if (!this.allowedTarget(target)) return
    this.tracker.setTarget(target)
    this.lastTarget = target
    this.save(); this.emit()
  }

  async setNote(note: string) { this.tracker.setNote(note.slice(0, 500)); this.emit() }
  async startBreak() { this.tracker.startBreak(); this.save(); this.emit() }
  async endBreak() { this.tracker.endBreak(Date.now()); this.emit() }
  async resolveIdle(keep: boolean) { this.tracker.resolveIdle(keep); this.save(); this.emit() }

  async acceptConsent() {
    this.consentAt = Date.now()
    this.consentVersion = CONSENT_VERSION
    this.consentSynced = false
    this.save(); this.emit()
    void this.sync()                       // records it in YVA OS (retried until it's saved)
  }

  async openWorkspace() { if (!TEST_NO_BROWSER) await shell.openExternal(WORKSPACE_URL) }

  /** Manual time requests live in My workspace (only when Manual Time is on for this person) */
  async openAddTime() {
    if (!this.profile?.manualTimeAllowed) return
    const url = `${WORKSPACE_URL}#manual`
    if (TEST_NO_BROWSER) fs.writeFileSync(dataPath('last-opened-url.txt'), url)
    else await shell.openExternal(url)
  }

  private checkReminders(now: number) {
    if (this.phase !== 'ready' || !this.profile) return
    const due = reminderDue(new Date(now), this.profile.shiftStart, this.profile.shiftEnd, this.tracker.status, this.reminders)
    if (!due) return
    this.reminders = { ...this.reminders, [due.kind]: due.shiftKey }
    this.save()
    if (due.kind === 'start') this.notify('Your shift started', `Your shift started at ${due.clock}. Start tracking in YVA Time?`)
    else this.notify('Still tracking?', `Your shift ended at ${due.clock} and YVA Time is still tracking. Stop it if you're done.`)
  }

  // ── Every second ───────────────────────────────────────────────────────────

  private idleSeconds(): number {
    if (!TEST_IDLE_FILE) return powerMonitor.getSystemIdleTime()
    try { return Number(fs.readFileSync(TEST_IDLE_FILE, 'utf8')) || 0 } catch { return 0 }
  }

  private everySecond() {
    const now = Date.now()
    this.tracker.tick(now, this.idleSeconds())
    if (this.consentAt && !this.consentMissing() && this.tracker.screenshotDue(now)) void this.takeScreenshot(now)
    if (Math.floor(now / 1000) % 60 === 0) this.checkReminders(now)
    this.emit()
  }

  // ── Screenshots ────────────────────────────────────────────────────────────

  private async takeScreenshot(now: number) {
    if (this.capturing || !this.profile) return
    this.capturing = true
    try {
      const shots = await captureScreens()
      if (shots.length === 0) return
      const group: ShotGroup = {
        groupId: crypto.randomUUID(), blockStart: blockStartOf(now), takenAt: now,
        preview: shots[0].preview, paths: [], uploaded: [], deleting: false,
      }
      fs.mkdirSync(dataPath('queue'), { recursive: true })
      for (const s of shots) {
        const id = crypto.randomUUID()
        const path = api.screenshotPath(this.profile.employeeId, now, id, s.monitor)
        const file = dataPath('queue', `${id}.jpg`)
        fs.writeFileSync(file, s.jpeg)
        this.queue.push({ id, groupId: group.groupId, path, file, blockStart: group.blockStart, takenAt: now, monitor: s.monitor })
        group.paths.push(path)
      }
      this.lastShot = group
      this.save()
      void this.uploadScreenshots()
    } catch (e) {
      console.error('screenshot failed', e)
    } finally {
      this.capturing = false
      this.emit()
    }
  }

  private async uploadScreenshots() {
    const c = auth.getClient()
    if (!c || !this.profile || this.uploadingShots) return
    this.uploadingShots = true
    try {
      for (const q of [...this.queue]) {
        if (this.lastShot?.groupId === q.groupId && this.lastShot.deleting) continue
        if (!this.queue.includes(q)) continue
        await api.uploadScreenshot(c, this.profile.employeeId, {
          path: q.path, blockStart: q.blockStart, takenAt: q.takenAt, monitor: q.monitor, jpeg: fs.readFileSync(q.file),
        })
        this.queue = this.queue.filter(x => x.id !== q.id)
        fs.rmSync(q.file, { force: true })
        if (this.lastShot?.groupId === q.groupId) this.lastShot.uploaded.push(q.path)
        this.online = true
      }
    } catch (e) {
      if (e instanceof api.OfflineError) this.online = false
      else console.error('screenshot upload failed (will retry)', e)
    } finally {
      this.uploadingShots = false
      this.save()
      this.emit()
    }
  }

  /** Delete the latest screenshot (within 2 minutes) — its 10-minute block is removed from the time */
  async deleteScreenshot() {
    const g = this.lastShot
    if (!g || Date.now() > g.takenAt + SCREENSHOT_DELETE_MS) {
      this.message = 'Screenshots can only be deleted within 2 minutes.'
      this.emit()
      return
    }
    g.deleting = true
    try {
      while (this.uploadingShots) await new Promise(r => setTimeout(r, 100))
      if (g.uploaded.length) await api.deleteScreenshots(auth.getClient()!, g.uploaded)
      for (const q of this.queue.filter(x => x.groupId === g.groupId)) fs.rmSync(q.file, { force: true })
      this.queue = this.queue.filter(x => x.groupId !== g.groupId)
      this.tracker.removeBlock(g.blockStart, g.uploaded.length > 0)
      this.lastShot = null
      this.message = 'Screenshot deleted. That 10-minute block was removed from your time.'
      void this.sync()
    } catch (e) {
      g.deleting = false
      this.message = e instanceof api.OfflineError ? "You're offline — try again in a moment." : (e as Error).message
    }
    this.save()
    this.emit()
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  async sync() {
    const c = auth.getClient()
    if (this.syncing || !this.profile || !c || this.phase === 'signed-out') return
    this.syncing = true
    try {
      const device = auth.deviceId()
      if (!device) {                         // signed in with 0.2.0, before computers were recorded
        await auth.signOut()
        await this.toSignedOut('YVA Time was updated. Please sign in again — your time is kept on this computer.')
        return
      }
      await api.checkDevice(c, device, app.getVersion())
      const { saved, refused } = await api.upsertBlocks(c, this.profile.employeeId, this.tracker.dirtyRows(), this.profile.worksFor === 'client')
      this.tracker.markSynced(saved)
      for (const r of refused) this.tracker.markRejected(r)
      if (refused.length) this.message = "Some time couldn't be saved (are you still on that project?). Contact YVA."
      this.online = true
      this.lastSavedAt = Date.now()
      if (this.consentAt && !this.consentSynced) {
        await api.recordConsent(c, this.profile.employeeId, app.getVersion(), this.consentVersion)
        this.consentSynced = true
      }
      await this.uploadScreenshots()
    } catch (e) {
      if (e instanceof api.OfflineError) this.online = false
      else if (e instanceof api.DisconnectedError) this.disconnected()
      else if (e instanceof api.SignedOutError) await this.toSignedOut('Your session ended. Sign in again — your time is kept on this computer.')
      else console.error('sync failed (will retry)', e)
    } finally {
      this.syncing = false
      this.save()
      this.emit()
    }
  }

  // ── State ──────────────────────────────────────────────────────────────────

  private save() {
    try {
      writeJson('state.json', {
        tracker: this.tracker.serialize(Date.now()),
        profile: this.profile,
        consentAt: this.consentAt,
        consentVersion: this.consentVersion,
        consentSynced: this.consentSynced,
        reminders: this.reminders,
        lastTarget: this.lastTarget,
        queue: this.queue,
      } satisfies Saved)
    } catch (e) {
      console.error('could not save state', e)
    }
  }

  snapshot(): Snapshot {
    const now = Date.now(), t = this.tracker
    const day = startOfDay(now), week = startOfWeek(now)
    const held = t.heldSeconds()
    const today = t.totalBetween(day, day + DAY_MS)
    const g = this.lastShot
    return {
      phase:          this.phase,
      awaitingCode:   this.phase === 'signed-out' && auth.isAwaitingCode(),
      message:        this.message,
      profile:        this.profile,
      consentNeeded:  this.consentMissing(),
      status:         t.status,
      target:         t.target ?? this.lastTarget,
      note:           t.note,
      sessionSeconds: t.status === 'stopped' ? 0 : t.sessionSeconds + held,
      todaySeconds:   today + held,
      weekSeconds:    t.totalBetween(week, week + 7 * DAY_MS) + held,
      idleSince:      t.idleSince,
      idleReview:     t.idleReview,
      lastShot: g ? { takenAt: g.takenAt, preview: g.preview, screens: g.paths.length, deletableUntil: g.takenAt + SCREENSHOT_DELETE_MS } : null,
      online:         this.online,
      lastSavedAt:    this.lastSavedAt,
      pending:        { blocks: t.dirtyRows().length, screenshots: this.queue.length },
      workTypes:      this.profile?.worksFor === 'yva' ? WORK_TYPES : [],
      todayActivity:  this.profile?.worksFor === 'client' && today > 0 ? Math.round((t.activeBetween(day, day + DAY_MS) / today) * 100) : null,
      update:         this.update,
    }
  }

  private emit() {
    const s = this.snapshot()
    for (const cb of this.listeners) cb(s)
  }
}
