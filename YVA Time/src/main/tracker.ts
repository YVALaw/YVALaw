// Tracking engine — pure logic, no Electron, unit-tested in test/tracker.test.ts.
//
// Time is kept in 10-minute blocks per target (client project or YVA work type), matching
// public.tracker_blocks. tick() is called about once a second with the system idle time
// (seconds since the last keyboard/mouse input):
//   • input during the second           → the second counts
//   • no input yet (under 5 minutes)    → held aside; counts as soon as input returns
//   • no input for 5+ minutes           → idle: the whole quiet stretch since the last
//                                          input waits for Keep or Remove on return
// Gaps longer than 5 s between ticks (sleep, hibernate) are never counted.
import type { IdleReview, Target, TrackerStatus } from '../shared/types'

export const BLOCK_MS = 600_000
export const BLOCK_SECONDS = 600

export type BlockRow = {
  blockStart: number          // ms since epoch, multiple of BLOCK_MS
  targetKey: string           // 'project:<id>' | 'work:<type>'
  projectId: string | null
  workType: string | null
  seconds: number
  note: string | null
  dirty: boolean              // changed since the last successful upload
  removed: boolean            // the person deleted this block's screenshot
  rejected: boolean           // the server refused it (e.g. no longer on the project)
}

export type TrackerOptions = {
  tentativeAfterS?: number    // seconds without input before a second is held aside (default 1)
  idleAfterS?: number         // default 300
  screenshots?: boolean       // client team only
  random?: () => number
  shotOffsetS?: number | null // fixed screenshot moment (tests)
}

export function targetKey(t: Target): string {
  return t.kind === 'project' ? `project:${t.projectId}` : `work:${t.workType}`
}

export function blockStartOf(ms: number): number {
  return Math.floor(ms / BLOCK_MS) * BLOCK_MS
}

const rowKey = (blockStart: number, key: string) => `${blockStart}|${key}`

function addTo(map: Map<string, number>, key: string, n: number) {
  map.set(key, (map.get(key) ?? 0) + n)
}

function total(map: Map<string, number>): number {
  let s = 0
  for (const n of map.values()) s += n
  return s
}

export class Tracker {
  status: TrackerStatus = 'stopped'
  target: Target | null = null
  note = ''
  sessionSeconds = 0
  idleSince: number | null = null
  idleReview: IdleReview | null = null
  readonly rows = new Map<string, BlockRow>()

  private tentative = new Map<string, number>()   // quiet since the last input, under 5 min
  private awaiting = new Map<string, number>()    // idle time waiting for Keep/Remove
  private removedBlocks = new Set<number>()
  private lastTick: number | null = null
  private carryMs = 0
  private shotPlan = new Map<number, number>()
  private shotTaken = new Set<number>()
  private opts: { tentativeAfterS: number; idleAfterS: number; screenshots: boolean; random: () => number; shotOffsetS: number | null }

  constructor(opts: TrackerOptions = {}) {
    this.opts = {
      tentativeAfterS: opts.tentativeAfterS ?? 1,
      idleAfterS:      opts.idleAfterS ?? 300,
      screenshots:     opts.screenshots ?? false,
      random:          opts.random ?? Math.random,
      shotOffsetS:     opts.shotOffsetS ?? null,
    }
  }

  setScreenshots(on: boolean) { this.opts.screenshots = on }

  // ── Controls ────────────────────────────────────────────────────────────────

  start(target: Target, note: string, now: number) {
    this.target = target
    this.note = note
    this.status = 'running'
    this.sessionSeconds = 0
    this.lastTick = now
    this.carryMs = 0
    this.tentative.clear()
    this.idleSince = null
  }

  setTarget(target: Target) {
    if (this.tentative.size) this.commit(this.tentative)
    this.target = target
  }

  setNote(note: string) { this.note = note }

  /** Clicking Stop is activity, so time held aside for a short pause counts */
  stop() {
    if (this.tentative.size) this.commit(this.tentative)
    this.status = 'stopped'
    this.lastTick = null
    this.idleSince = null
  }

  startBreak() {
    if (this.status !== 'running' && this.status !== 'idle') return
    if (this.tentative.size) this.commit(this.tentative)
    this.status = 'break'
    this.lastTick = null
  }

  endBreak(now: number) {
    if (this.status !== 'break') return
    this.status = 'running'
    this.lastTick = now
    this.carryMs = 0
  }

  resolveIdle(keep: boolean) {
    if (keep) this.commit(this.awaiting)
    else this.awaiting.clear()
    this.idleReview = null
  }

  // ── Counting ────────────────────────────────────────────────────────────────

  tick(now: number, idleSeconds: number) {
    if (this.status !== 'running' && this.status !== 'idle') return
    const last = this.lastTick ?? now
    this.lastTick = now
    const delta = now - last
    if (delta <= 0 || delta > 5000) { this.carryMs = 0; return }
    this.carryMs += delta
    while (this.carryMs >= 1000) {
      this.carryMs -= 1000
      this.countSecond(now - this.carryMs - 1000, idleSeconds)   // file each second under its start
    }
  }

  /** Seconds held aside since the last input (shown live, saved once input returns) */
  heldSeconds(): number {
    return total(this.tentative)
  }

  private countSecond(at: number, idleSeconds: number) {
    if (!this.target) return
    const bs = blockStartOf(at)
    const removed = this.removedBlocks.has(bs)     // still track idle state, just don't count
    const key = rowKey(bs, targetKey(this.target))

    if (idleSeconds >= this.opts.idleAfterS) {
      if (this.status !== 'idle') {
        this.status = 'idle'
        this.idleSince = at - idleSeconds * 1000
        for (const [k, n] of this.tentative) addTo(this.awaiting, k, n)
        this.tentative.clear()
      }
      if (!removed) addTo(this.awaiting, key, 1)
      return
    }
    if (idleSeconds >= this.opts.tentativeAfterS) {
      if (!removed) addTo(this.tentative, key, 1)
      return
    }
    if (this.status === 'idle') {
      // Back after 5+ minutes away: ask whether to keep that time (if any was held)
      this.status = 'running'
      const seconds = total(this.awaiting)
      if (seconds > 0) {
        this.idleReview = { seconds, since: this.idleReview?.since ?? this.idleSince ?? at, until: at }
      }
      this.idleSince = null
    }
    if (this.tentative.size) this.commit(this.tentative)
    if (!removed) this.addSeconds(key, 1)
  }

  private commit(map: Map<string, number>) {
    for (const [key, n] of map) this.addSeconds(key, n)
    map.clear()
  }

  private addSeconds(key: string, n: number) {
    const cut = key.indexOf('|')
    const bs = Number(key.slice(0, cut))
    const tk = key.slice(cut + 1)
    if (this.removedBlocks.has(bs)) return
    const add = Math.min(n, BLOCK_SECONDS - this.blockTotal(bs))
    if (add <= 0) return
    let row = this.rows.get(key)
    if (!row) {
      row = {
        blockStart: bs, targetKey: tk,
        projectId: tk.startsWith('project:') ? tk.slice(8) : null,
        workType:  tk.startsWith('work:') ? tk.slice(5) : null,
        seconds: 0, note: null, dirty: true, removed: false, rejected: false,
      }
      this.rows.set(key, row)
    }
    row.seconds += add
    row.note = this.note.trim() || null
    row.dirty = true
    this.sessionSeconds += add
  }

  blockTotal(blockStart: number): number {
    let s = 0
    for (const r of this.rows.values()) if (r.blockStart === blockStart && !r.removed) s += r.seconds
    return s
  }

  /** Seconds counted between from (inclusive) and to (exclusive), excluding removed/refused blocks */
  totalBetween(from: number, to: number): number {
    let s = 0
    for (const r of this.rows.values()) {
      if (r.blockStart >= from && r.blockStart < to && !r.removed && !r.rejected) s += r.seconds
    }
    return s
  }

  // ── Screenshots (client team) ──────────────────────────────────────────────

  /** True once per 10-minute block, at a random moment, while the timer is running */
  screenshotDue(now: number): boolean {
    if (!this.opts.screenshots || this.status !== 'running') return false
    const bs = blockStartOf(now)
    if (this.shotTaken.has(bs) || this.removedBlocks.has(bs)) return false
    let offset = this.shotPlan.get(bs)
    if (offset === undefined) {
      offset = this.opts.shotOffsetS ?? 20 + Math.floor(this.opts.random() * 560)
      this.shotPlan.set(bs, offset)
    }
    if (now - bs < offset * 1000) return false
    this.shotTaken.add(bs)
    return true
  }

  /**
   * The person deleted the screenshot of this block: the whole block stops counting.
   * remoteRemoved = the server already marked it removed (screenshot was uploaded);
   * otherwise its rows are zeroed and uploaded so the server drops that time too.
   */
  removeBlock(blockStart: number, remoteRemoved: boolean) {
    this.removedBlocks.add(blockStart)
    for (const map of [this.tentative, this.awaiting]) {
      for (const k of [...map.keys()]) if (k.startsWith(`${blockStart}|`)) map.delete(k)
    }
    for (const r of this.rows.values()) {
      if (r.blockStart !== blockStart || r.removed) continue
      this.sessionSeconds = Math.max(0, this.sessionSeconds - r.seconds)
      r.removed = true
      if (remoteRemoved) {
        r.dirty = false
      } else {
        r.seconds = 0
        r.dirty = true
      }
    }
  }

  // ── Upload bookkeeping ─────────────────────────────────────────────────────

  dirtyRows(): BlockRow[] {
    return [...this.rows.values()].filter(r => r.dirty && !r.rejected).map(r => ({ ...r }))
  }

  /** Mark rows uploaded — only if they didn't change while the upload was in flight */
  markSynced(sent: BlockRow[]) {
    for (const s of sent) {
      const r = this.rows.get(rowKey(s.blockStart, s.targetKey))
      if (r && r.seconds === s.seconds && r.removed === s.removed) r.dirty = false
    }
  }

  markRejected(row: BlockRow) {
    const r = this.rows.get(rowKey(row.blockStart, row.targetKey))
    if (r) { r.rejected = true; r.dirty = false }
  }

  /** Merge rows from the server (after a restart or on another computer) */
  mergeServer(rows: { blockStart: number; targetKey: string; seconds: number; status: string; note: string | null }[]) {
    for (const s of rows) {
      const key = rowKey(s.blockStart, s.targetKey)
      if (s.status === 'removed') {
        this.removedBlocks.add(s.blockStart)
        const local = this.rows.get(key)
        if (local) { local.removed = true; local.dirty = false }
        continue
      }
      const local = this.rows.get(key)
      if (local) {
        if (s.seconds >= local.seconds) { local.seconds = s.seconds; local.dirty = false }
      } else {
        this.rows.set(key, {
          blockStart: s.blockStart, targetKey: s.targetKey,
          projectId: s.targetKey.startsWith('project:') ? s.targetKey.slice(8) : null,
          workType:  s.targetKey.startsWith('work:') ? s.targetKey.slice(5) : null,
          seconds: s.seconds, note: s.note, dirty: false, removed: false, rejected: false,
        })
      }
    }
  }

  // ── Persistence (survives restarts; time between a crash and restart is not counted) ──

  serialize(now: number) {
    const keepFrom = now - 8 * 86_400_000
    return {
      rows: [...this.rows.values()].filter(r => r.blockStart >= keepFrom || r.dirty),
      removedBlocks: [...this.removedBlocks].filter(b => b >= keepFrom),
      shotTaken: [...this.shotTaken].filter(b => b >= now - BLOCK_MS * 2),
    }
  }

  restore(data: ReturnType<Tracker['serialize']> | null) {
    if (!data) return
    for (const r of data.rows ?? []) this.rows.set(rowKey(r.blockStart, r.targetKey), { ...r })
    for (const b of data.removedBlocks ?? []) this.removedBlocks.add(b)
    for (const b of data.shotTaken ?? []) this.shotTaken.add(b)
  }
}
