import { useEffect, useState, type ReactNode } from 'react'
import StripeStatusCard from './StripeStatusCard'
import { supabase } from '../../lib/supabase'
import { disconnectGmail, initiateGmailAuth } from '../../services/gmail'
import { pushState, type PushState } from '../../services/notifications'
import { Ic, P } from '../Icon'
import { Banner, Field } from '../ui'
import { dateMed } from '../../utils/format'
import type { GmailStatus } from './gmailStatus'

/** The booking link the website's booking form opens (index.html, landing pages) */
export const CALENDLY_URL = 'https://calendly.com/contact-yvastaffing-vuu8/new-meeting'

type Tone = 'ok' | 'warn' | 'bad' | 'off' | 'soon'
const Status = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`set-status set-status--${tone}`}>{children}</span>
const Fact = ({ k, v }: { k: string; v: ReactNode }) => <div className="set-int__fact"><span>{k}</span><span>{v}</span></div>

function newestVersion(versions: string[]): string | null {
  const parse = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0)
  return versions.reduce<string | null>((best, v) => {
    if (!best) return v
    const a = parse(v), b = parse(best)
    for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) ? v : best }
    return best
  }, null)
}

/** Crisp website IDs are UUIDs (Crisp → Settings → Website Settings → Setup & Integrations) */
export const CRISP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CrispSetting = {
  value: string
  saved: string
  loading: boolean
  /** false until migrate-redesign-settings.sql has run */
  ready: boolean
  saving: boolean
  dirty: boolean
  onChange: (v: string) => void
  save: () => Promise<boolean>
}

type Facts = {
  calendlyBooked?: number | null
  devices?: { connected: number; newest: string | null } | null
  push?: { ok: boolean; text: string } | null
  pushHere?: PushState | null
}

export default function IntegrationsTab({ clientId, onClientId, saveClientId, gmail, recheck, onGmailChange, notify, crisp }: {
  clientId: string
  onClientId: (v: string) => void
  /** Saves the Client ID if it changed; resolves false when the save failed */
  saveClientId: () => Promise<boolean>
  gmail: GmailStatus
  recheck: () => Promise<void>
  onGmailChange: (s: GmailStatus) => void
  notify: (tone: 'success' | 'danger', text: string) => void
  crisp: CrispSetting
}) {
  const [facts, setFacts] = useState<Facts>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const set = (patch: Facts) => { if (alive) setFacts(f => ({ ...f, ...patch })) }
    // Each read is best-effort: a missing table or a role without access just shows "—"
    void supabase.from('leads').select('id', { count: 'exact', head: true }).eq('calendly_booked', true)
      .then(({ count, error }) => set({ calendlyBooked: error ? undefined : (count ?? 0) }))
    void supabase.from('desktop_devices').select('app_version,signed_out_at,revoked_at')
      .then(({ data, error }) => {
        if (error) return set({ devices: undefined })
        const rows = (data || []) as { app_version: string | null; signed_out_at: string | null; revoked_at: string | null }[]
        set({ devices: { connected: rows.filter(r => !r.signed_out_at && !r.revoked_at).length, newest: newestVersion(rows.map(r => r.app_version || '').filter(Boolean)) } })
      })
    void fetch('/.netlify/functions/push-config')
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        set({ push: res.ok && data?.publicKey ? { ok: true, text: 'Public key published' } : { ok: false, text: data?.error || `Not available (HTTP ${res.status})` } })
      })
      .catch(() => set({ push: { ok: false, text: 'Could not reach the push service.' } }))
    void pushState().then(s => set({ pushHere: s })).catch(() => set({ pushHere: null }))
    return () => { alive = false }
  }, [])

  async function connect() {
    if (!clientId.trim()) return
    setBusy(true)
    // The OAuth callback reads the Client ID back from settings, so it must be saved first
    if (!(await saveClientId())) { setBusy(false); return }
    try { await initiateGmailAuth(clientId.trim()) } catch (e) { setBusy(false); notify('danger', `Could not start the Google sign-in: ${(e as Error).message}`) }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await disconnectGmail()
      onGmailChange({ state: 'off' })
      notify('success', 'Gmail disconnected.')
    } catch (e) {
      notify('danger', (e as Error).message)
    }
    setBusy(false)
  }

  const downloadUrl = (import.meta.env.VITE_YVA_TIME_DOWNLOAD_URL as string | undefined) || ''
  const dash = <span className="soft">—</span>
  const crispOn = !crisp.loading && !!crisp.saved
  const crispBad = !!crisp.value.trim() && !CRISP_ID_RE.test(crisp.value.trim())

  const g = gmail.state
  const gmailPill = g === 'ok' ? <Status tone="ok">Connected</Status>
    : g === 'reconnect' ? <Status tone="warn">Reconnect needed</Status>
    : g === 'problem' ? <Status tone="bad">Connection problem</Status>
    : g === 'checking' ? <Status tone="off">Checking…</Status>
    : <Status tone="off">Not connected</Status>
  const pushHereText: Record<PushState, string> = { on: 'On', off: 'Off', denied: 'Blocked in this browser', unsupported: 'Not supported here', 'needs-install': 'Install the app first (iPhone)' }

  return (
    <div className="set-int-grid">
      {/* ── Gmail ── */}
      <section className="set-int set-int--wide" aria-label="Gmail">
        <div className="set-int__head">
          <span className="set-int__name"><Ic d={P.mail} /> Gmail</span>
          {gmailPill}
        </div>
        <span className="set-int__desc">Sends invoices, reminders and automatic emails as you. Each person connects their own Gmail.</span>

        {g === 'ok' && <div className="set-int__facts"><Fact k="Connected account" v={gmail.email} /></div>}
        {g === 'reconnect' && (
          <Banner tone="warning">
            <strong>Reconnect needed.</strong> {gmail.reason} Connect Gmail again to keep sending from {gmail.email || 'your account'}.
          </Banner>
        )}
        {g === 'problem' && <Banner tone="danger"><strong>Connection problem.</strong> {gmail.reason}</Banner>}

        {(g === 'off' || g === 'reconnect' || g === 'problem') && (
          <div className="set-int__setup">
            <Field label="Google OAuth Client ID" hint={<>From Google Cloud Console → APIs &amp; Services → Credentials → OAuth 2.0 Client ID (Web application). Authorized Redirect URI: <code className="set-code">{window.location.origin}/oauth-callback</code></>}>
              <input className="input" placeholder="123456789-abc123.apps.googleusercontent.com" value={clientId} onChange={e => onClientId(e.target.value)} />
            </Field>
            {g === 'off' && (
              <span className="set-hint">
                <strong>Setup guide:</strong> Go to <strong>console.cloud.google.com</strong> → New Project → Enable <strong>Gmail API</strong> →
                Create <strong>OAuth 2.0 Client ID</strong> (Web application) → add the redirect URI above →
                paste the Client ID here → add the Google client secret to Netlify as <code>GMAIL_CLIENT_SECRET</code> → click Connect.
                All emails (invoices, statements, reminders) will be sent directly via your Gmail.
              </span>
            )}
          </div>
        )}

        <div className="set-actions set-actions--split">
          <div className="set-actions">
            {g === 'off' && <button type="button" className="btn btn--primary" disabled={busy || !clientId.trim()} onClick={() => void connect()}>Connect Gmail →</button>}
            {(g === 'reconnect' || g === 'problem') && <button type="button" className="btn btn--primary" disabled={busy || !clientId.trim()} onClick={() => void connect()}>Reconnect Gmail</button>}
            {(g === 'ok' || g === 'problem' || g === 'reconnect') && <button type="button" className="btn" disabled={busy} onClick={() => void recheck()}><Ic d={P.refresh} size={14} /> Check again</button>}
          </div>
          {(g === 'ok' || g === 'reconnect' || g === 'problem') && (
            <button type="button" className="btn btn--sm btn--ghost btn--danger" disabled={busy} onClick={() => void disconnect()}>Disconnect Gmail</button>
          )}
        </div>
      </section>

      {/* ── Stripe ── */}
      <StripeStatusCard />

      {/* ── Calendly ── */}
      <section className="set-int" aria-label="Calendly">
        <div className="set-int__head">
          <span className="set-int__name"><Ic d={P.calendar} /> Calendly</span>
          <Status tone="ok">On the website</Status>
        </div>
        <span className="set-int__desc">Marks leads as “call booked” when they schedule from the website.</span>
        <div className="set-int__facts">
          <Fact k="Booking link" v={<a href={CALENDLY_URL} target="_blank" rel="noreferrer">Open booking page</a>} />
          <Fact k="Leads with a call booked" v={facts.calendlyBooked == null ? dash : facts.calendlyBooked} />
        </div>
      </section>

      {/* ── YVA Time ── */}
      <section className="set-int" aria-label="YVA Time for Windows">
        <div className="set-int__head">
          <span className="set-int__name"><Ic d={P.time} /> YVA Time for Windows</span>
          {downloadUrl ? <Status tone="ok">Live</Status> : <Status tone="warn">No download link</Status>}
        </div>
        <span className="set-int__desc">Desktop tracker. Installed apps update themselves from GitHub Releases.</span>
        <div className="set-int__facts">
          <Fact k="Newest version in use" v={facts.devices?.newest ?? dash} />
          <Fact k="Computers connected" v={facts.devices ? facts.devices.connected : dash} />
          <Fact k="Download" v={downloadUrl ? <a href={downloadUrl} target="_blank" rel="noreferrer">YVA-Time-Setup.exe</a> : 'Not set'} />
        </div>
        {!downloadUrl && <span className="set-hint">Set <code>VITE_YVA_TIME_DOWNLOAD_URL</code> in Netlify to show the Download button in My workspace.</span>}
      </section>

      {/* ── Web push ── */}
      <section className="set-int" aria-label="Web push">
        <div className="set-int__head">
          <span className="set-int__name"><Ic d={P.bell} /> Web push</span>
          {facts.push == null ? <Status tone="off">Checking…</Status> : facts.push.ok ? <Status tone="ok">On</Status> : <Status tone="bad">Not set up</Status>}
        </div>
        <span className="set-int__desc">Phone notifications for the installed YVA OS app. Each person turns them on under Notifications.</span>
        <div className="set-int__facts">
          <Fact k="Server" v={facts.push?.text ?? dash} />
          <Fact k="This device" v={facts.pushHere ? pushHereText[facts.pushHere] : dash} />
        </div>
      </section>

      {/* ── Crisp ── */}
      <section className="set-int" aria-label="Crisp chat">
        <div className="set-int__head">
          <span className="set-int__name"><Ic d={P.message} /> Crisp chat</span>
          {crisp.loading ? <Status tone="off">Checking…</Status> : crispOn ? <Status tone="ok">Connected</Status> : <Status tone="off">Not set up</Status>}
        </div>
        <span className="set-int__desc">Live chat on the Messages tab of the client portal. Replies come from your Crisp inbox.</span>
        {crispOn && (
          <div className="set-int__facts">
            <Fact k="Website ID" v={<span className="mono">{crisp.saved}</span>} />
            <Fact k="Shown to" v="Signed-in portal clients" />
          </div>
        )}
        {!crisp.ready && <Banner tone="warning">Run <code className="set-code">supabase/migrate-redesign-settings.sql</code> in Supabase first.</Banner>}
        <Field label="Crisp website ID" hint={<>In <a href="https://app.crisp.chat" target="_blank" rel="noreferrer">Crisp</a> → Settings → Website settings → Setup &amp; integrations. Leave empty to turn chat off.</>}
          error={crispBad ? 'A website ID looks like 1a2b3c4d-1234-5678-9abc-1234567890ab.' : undefined}>
          <input className="input mono" placeholder="1a2b3c4d-1234-5678-9abc-1234567890ab" value={crisp.value} spellCheck={false} autoComplete="off"
            disabled={crisp.loading} onChange={e => crisp.onChange(e.target.value)} />
        </Field>
        <div className="set-actions set-actions--split">
          <button type="button" className="btn btn--primary btn--sm" disabled={crisp.loading || !crisp.ready || crisp.saving || !crisp.dirty || crispBad}
            onClick={() => void crisp.save()}>{crisp.saving ? 'Saving…' : 'Save'}</button>
          <a className="set-int__link" href="https://crisp.chat" target="_blank" rel="noreferrer"><Ic d={P.link} size={12} /> crisp.chat</a>
        </div>
      </section>
    </div>
  )
}
