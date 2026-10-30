import { useEffect, useState } from 'react'
import type { Snapshot, Target } from '../shared/types'
import logo from '../../resources/icon.png'

// ── Formatting ─────────────────────────────────────────────────────────────────

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}
function time(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
const keyOf = (t: Target) => (t.kind === 'project' ? `project:${t.projectId}` : `work:${t.workType}`)

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {
  const [s, setS] = useState<Snapshot | null>(null)
  useEffect(() => {
    void window.yva.getSnapshot().then(setS)
    return window.yva.onSnapshot(setS)
  }, [])

  if (!s) return <div className="center muted">Loading…</div>
  return (
    <div className="app">
      {s.phase === 'signed-out' && <SignIn s={s} />}
      {s.phase === 'loading' && <div className="center muted">Loading your profile…</div>}
      {s.phase === 'ready' && s.profile && (s.consentNeeded ? <Consent /> : <TrackerScreen s={s} />)}
      {s.idleReview && <IdleReview s={s} />}
    </div>
  )
}

// ── Sign in ────────────────────────────────────────────────────────────────────

function SignIn({ s }: { s: Snapshot }) {
  const [code, setCode] = useState('')
  return (
    <div className="signin">
      <img src={logo} alt="" className="signin-logo" />
      <h1>YVA Time</h1>
      <p className="muted">Track your hours with your YVA OS account.</p>
      {!s.awaitingCode ? (
        <button className="btn primary wide" onClick={() => void window.yva.signIn()}>Sign in with YVA OS</button>
      ) : (
        <div className="stack">
          <div className="notice">Your browser opened YVA OS. Click <b>Connect this computer</b> there.</div>
          <label className="label">Didn't come back here? Paste the code from the browser:</label>
          <input className="input" value={code} onChange={e => setCode(e.target.value)} placeholder="Sign-in code" />
          <button className="btn primary wide" disabled={code.trim().length < 20} onClick={() => void window.yva.redeemCode(code)}>Continue</button>
          <button className="btn ghost wide" onClick={() => void window.yva.cancelSignIn()}>Cancel</button>
        </div>
      )}
      {s.message && <div className="message">{s.message}</div>}
    </div>
  )
}

// ── Screenshot notice (client team, first run) ─────────────────────────────────

function Consent() {
  return (
    <div className="page">
      <h2>Before you start</h2>
      <p>YVA Time takes screenshots while you track time for a client:</p>
      <ul className="consent">
        <li>A picture of your screen(s) at a random moment about every 10 minutes — <b>only while the timer is running</b>. Nothing is taken when stopped or on break.</li>
        <li>You'll see each screenshot here and can <b>delete it within 2 minutes</b>. That 10-minute block is then removed from your time.</li>
        <li>Screenshots are seen only by YVA admins — never by clients — and are deleted after 90 days.</li>
        <li>If you stop using your keyboard and mouse for 5 minutes, YVA Time asks whether to keep that time.</li>
      </ul>
      <button className="btn primary wide" onClick={() => void window.yva.acceptConsent()}>I understand — continue</button>
    </div>
  )
}

// ── Main tracker screen ────────────────────────────────────────────────────────

function TrackerScreen({ s }: { s: Snapshot }) {
  const p = s.profile!
  const isYva = p.worksFor === 'yva'
  const options: Target[] = [
    ...p.projects.map(pr => ({ kind: 'project' as const, projectId: pr.id, label: pr.clientName ? `${pr.name} · ${pr.clientName}` : pr.name })),
    ...s.workTypes.map(w => ({ kind: 'work' as const, workType: w, label: w })),
  ]
  const fallback = s.target && options.some(o => keyOf(o) === keyOf(s.target!)) ? s.target : options[0] ?? null
  const [choice, setChoice] = useState<Target | null>(fallback)
  const [note, setNote] = useState(s.note)
  const [menu, setMenu] = useState(false)
  const target = choice && options.some(o => keyOf(o) === keyOf(choice)) ? choice : fallback
  const running = s.status !== 'stopped'

  function pick(key: string) {
    const t = options.find(o => keyOf(o) === key) ?? null
    setChoice(t)
    if (t && running) void window.yva.setTarget(t)
  }

  return (
    <div className="page">
      <header className="header">
        <img src={logo} alt="" className="header-logo" />
        <div className="grow">
          <div className="name">{p.name}</div>
          <span className={`badge ${isYva ? 'badge-yva' : 'badge-client'}`}>{isYva ? 'YVA team' : 'Client team'}</span>
        </div>
        <button className="icon-btn" aria-label="Menu" onClick={() => setMenu(m => !m)}>⋯</button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => { setMenu(false); void window.yva.openWorkspace() }}>Open My workspace</button>
            {p.manualTimeAllowed && <button onClick={() => { setMenu(false); void window.yva.openAddTime() }}>Add missing time</button>}
            <button onClick={() => { setMenu(false); void window.yva.signOut() }}>Sign out</button>
          </div>
        )}
      </header>

      <div className={`status status-${s.status}`}>
        <span className="dot" />
        {s.status === 'running' && 'Tracking'}
        {s.status === 'break' && 'On break'}
        {s.status === 'idle' && `Idle since ${time(s.idleSince ?? Date.now())} — not counting`}
        {s.status === 'stopped' && 'Not tracking'}
      </div>

      <div className="timer">{clock(s.sessionSeconds)}</div>
      <div className="totals"><span>Today <b>{hm(s.todaySeconds)}</b></span><span>This week <b>{hm(s.weekSeconds)}</b></span></div>

      {options.length === 0 ? (
        <div className="notice">You're not assigned to a project yet. Ask YVA to add you.</div>
      ) : (
        <>
          <label className="label">{isYva ? 'Working on' : 'Project'}</label>
          <select className="input" value={target ? keyOf(target) : ''} onChange={e => pick(e.target.value)}>
            {options.map(o => <option key={keyOf(o)} value={keyOf(o)}>{o.label}</option>)}
          </select>
          <label className="label">What are you working on? <span className="muted">(optional)</span></label>
          <input className="input" value={note} maxLength={500} placeholder="e.g. Calling new leads"
            onChange={e => { setNote(e.target.value); if (running) void window.yva.setNote(e.target.value) }} />
        </>
      )}

      <div className="buttons">
        {!running ? (
          <button className="btn primary grow" disabled={!target} onClick={() => target && void window.yva.start(target, note)}>Start</button>
        ) : (
          <>
            <button className="btn stop grow" onClick={() => void window.yva.stop()}>Stop</button>
            {s.status === 'break'
              ? <button className="btn ghost" onClick={() => void window.yva.endBreak()}>Resume</button>
              : <button className="btn ghost" onClick={() => void window.yva.startBreak()}>Break</button>}
          </>
        )}
      </div>

      {!isYva && <ScreenshotCard s={s} />}

      {s.message && <div className="message">{s.message}</div>}
      <footer className="footer">
        {!s.online
          ? `Offline — saving on this computer (${s.pending.blocks + s.pending.screenshots} waiting)`
          : s.lastSavedAt ? `Saved at ${time(s.lastSavedAt)}` : 'Connected'}
      </footer>
    </div>
  )
}

function ScreenshotCard({ s }: { s: Snapshot }) {
  const shot = s.lastShot
  if (!shot) {
    return <div className="shot-empty muted">Screenshots on — taken about every 10 minutes while you track.</div>
  }
  const left = Math.max(0, Math.ceil((shot.deletableUntil - Date.now()) / 1000))
  return (
    <div className="shot">
      <img src={shot.preview} alt="Latest screenshot" />
      <div className="grow">
        <div className="shot-title">Screenshot · {time(shot.takenAt)}</div>
        <div className="muted small">{shot.screens > 1 ? `${shot.screens} screens` : '1 screen'}</div>
        {left > 0 && (
          <button className="btn danger small-btn" onClick={() => void window.yva.deleteScreenshot()}>
            Delete ({Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')})
          </button>
        )}
      </div>
    </div>
  )
}

// ── Back after 5+ minutes away ─────────────────────────────────────────────────

function IdleReview({ s }: { s: Snapshot }) {
  const r = s.idleReview!
  return (
    <div className="overlay">
      <div className="dialog">
        <h3>You were away</h3>
        <p>No keyboard or mouse from <b>{time(r.since)}</b> to <b>{time(r.until)}</b> ({hm(r.seconds)}).</p>
        <p className="muted small">Keep this time only if you were working (for example on a call or reading).</p>
        <div className="buttons">
          <button className="btn primary grow" onClick={() => void window.yva.resolveIdle(true)}>Keep time</button>
          <button className="btn ghost grow" onClick={() => void window.yva.resolveIdle(false)}>Remove</button>
        </div>
      </div>
    </div>
  )
}
