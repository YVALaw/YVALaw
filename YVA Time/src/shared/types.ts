// Types shared by the main process, the preload bridge and the React UI.

export type Target =
  | { kind: 'project'; projectId: string; label: string }
  | { kind: 'work'; workType: string; label: string }

export type TrackerStatus = 'stopped' | 'running' | 'break' | 'idle'

/** Time the person was away (no keyboard/mouse for 5+ minutes), waiting for Keep/Remove */
export type IdleReview = { seconds: number; since: number; until: number }

export type Profile = {
  employeeId: string
  name: string
  email: string | null
  worksFor: 'client' | 'yva'          // client = screenshots on, yva = YVA team (screenshots off)
  manualTimeAllowed: boolean
  projects: { id: string; name: string; clientName: string | null }[]
}

export type LastShot = {
  takenAt: number
  preview: string                     // small data: URL of the first screen
  screens: number
  deletableUntil: number
}

export type Snapshot = {
  phase: 'signed-out' | 'loading' | 'ready'
  awaitingCode: boolean               // "Sign in with YVA OS" clicked, waiting for the browser
  message: string | null              // errors / notices for the person
  profile: Profile | null
  consentNeeded: boolean
  status: TrackerStatus
  target: Target | null
  note: string
  sessionSeconds: number
  todaySeconds: number
  weekSeconds: number
  idleSince: number | null
  idleReview: IdleReview | null
  lastShot: LastShot | null
  online: boolean
  lastSavedAt: number | null          // last successful upload
  pending: { blocks: number; screenshots: number }
  workTypes: string[]
}

/** The API the preload script exposes to the UI as window.yva */
export type YvaApi = {
  getSnapshot(): Promise<Snapshot>
  onSnapshot(cb: (s: Snapshot) => void): () => void
  signIn(): Promise<void>
  redeemCode(code: string): Promise<void>
  cancelSignIn(): Promise<void>
  signOut(): Promise<void>
  acceptConsent(): Promise<void>
  start(target: Target, note: string): Promise<void>
  stop(): Promise<void>
  setTarget(target: Target): Promise<void>
  setNote(note: string): Promise<void>
  startBreak(): Promise<void>
  endBreak(): Promise<void>
  resolveIdle(keep: boolean): Promise<void>
  deleteScreenshot(): Promise<void>
  openWorkspace(): Promise<void>
}
