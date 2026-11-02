import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { sendOutlookMessage } from '../../services/email'
import { pushState, type PushState } from '../../services/notifications'
import { Ic, P } from '../Icon'
import { Banner, Field } from '../ui'
import { dateMed } from '../../utils/format'
import type { EmailStatusView } from './emailStatus'

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
  stripeLast?: { at: string; amount: number } | null
  calendlyBooked?: number | null
  devices?: { connected: number; newest: string | null } | null
  push?: { ok: boolean; text: string } | null
  pushHere?: PushState | null
}

export default function IntegrationsTab({ email, recheck, notify, crisp }: {
  email: EmailStatusView
  recheck: () => Promise<void>
  notify: (tone: 'success' | 'danger', text: string) => void
  crisp: CrispSetting
}) {
  const [facts, setFacts] = useState<Facts>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const set = (patch: Facts) => { if (alive) setFacts(f => ({ ...f, ...patch })) }
    // Each read is best-effort: a missing table or a role without access just shows "—"
    void supabase.from('client_payments').select('created_at,amount').eq('source', 'stripe').order('created_at', { ascending: false }).limit(1)
      .then(({ data, error }) => set({ stripeLast: error ? undefined : (data?.[0] ? { at: data[0].created_at as string, amount: Number(data[0].amount) || 0 } : null) }))
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

  /** A real email from the company mailbox to the signed-in person's own login address */
  async function sendTest() {
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('Your login has no email address.')
      const r = await sendOutlookMessage(user.email, 'YVA OS test email',
        `This is a test email from YVA OS.\n\nIf you can read it, invoices, statements and automatic emails will be sent from ${email.mailbox || 'the company mailbox'}.\n\n— YVA OS`)
      notify('success', `Test email sent from ${r.from} to ${user.email}. Check that inbox (and its junk folder).`)
    } catch (e) {
      notify('danger', `Test email not sent: ${(e as Error).message}`)
    }
    setBusy(false)
  }

  const pk = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) || ''
  const stripeMode = pk.startsWith('pk_live') ? 'Live' : pk.startsWith('pk_test') ? 'Test mode' : pk ? 'Configured' : ''
  const downloadUrl = (import.meta.env.VITE_YVA_TIME_DOWNLOAD_URL as string | undefined) || ''
  const dash = <span className="soft">—</span>
  const crispOn = !crisp.loading && !!crisp.saved
  const crispBad = !!crisp.value.trim() && !CRISP_ID_RE.test(crisp.value.trim())

  const e = email.state
  const emailPill = e === 'ok' ? <Status tone="ok">Connected</Status>
    : e === 'problem' ? <Status tone="bad">Problem</Status>
    : e === 'checking' ? <Status tone="off">Checking…</Status>
    : <Status tone="off">Not set up</Status>
  const pushHereText: Record<PushState, string> = { on: 'On', off: 'Off', denied: 'Blocked in this browser', unsupported: 'Not supported here', 'needs-install': 'Install the app first (iPhone)' }

  return (
    <div className="set-int-grid">
      {/* ── Email sending (Outlook) ── */}
      <section className="set-int set-int--wide" aria-label="Email sending">
        <div className="set-int__head">
          <span className="set-int__name"><Ic d={P.mail} /> Email sending · Outlook</span>
          {emailPill}
        </div>
        <span className="set-int__desc">Invoices, reminders, statements and automatic emails go out from one company mailbox (Microsoft 365). A copy of each lands in that mailbox's Sent Items.</span>

        {(e === 'ok' || e === 'problem' || (e === 'off' && email.mailbox)) && (
          <div className="set-int__facts"><Fact k="Sends from" v={email.mailbox || '—'} /></div>
        )}
        {e === 'problem' && <Banner tone="danger"><strong>Can't send right now.</strong> {email.reason}</Banner>}
        {e === 'off' && (
          <span className="set-hint">
            <strong>Not set up yet.</strong> {email.missing?.length ? <>Missing on Netlify: {email.missing.map((m, i) => <span key={m}>{i ? ', ' : ''}<code>{m}</code></span>)}. </> : null}
            Follow <strong>SETUP-AFTER-BUILD.md → 3. Email from Outlook</strong>: register an app in Microsoft Entra with the Mail.Send permission,
            add its four values to Netlify, redeploy, and limit the app to the company mailbox. Until then, emails open in your own email app instead.
          </span>
        )}

        <div className="set-actions">
          {e === 'ok' && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void sendTest()}><Ic d={P.mail} size={14} /> {busy ? 'Sending…' : 'Send test email to me'}</button>}
          <button type="button" className="btn" disabled={busy || e === 'checking'} onClick={() => void recheck()}><Ic d={P.refresh} size={14} /> Check again</button>
        </div>
      </section>

      {/* ── Stripe ── */}
      <section className="set-int" aria-label="Stripe">
        <div className="set-int__head">
          <span className="set-int__name"><Ic d={P.card} /> Stripe</span>
          {pk ? <Status tone="ok">{stripeMode === 'Configured' ? 'Connected' : `Connected · ${stripeMode}`}</Status> : <Status tone="off">Not set up</Status>}
        </div>
        <span className="set-int__desc">Card payments and AutoPay in the client portal. The webhook marks invoices paid.</span>
        <div className="set-int__facts">
          <Fact k="Publishable key" v={pk ? `Set (${stripeMode.toLowerCase()})` : 'Missing'} />
          <Fact k="Webhook" v="Set on the server" />
          <Fact k="Last card payment" v={facts.stripeLast === undefined ? dash : facts.stripeLast ? `$${facts.stripeLast.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} · ${dateMed(facts.stripeLast.at)}` : 'None yet'} />
        </div>
        <span className="set-hint">
          {pk ? 'Keys and the webhook secret (STRIPE_WEBHOOK_SECRET) live in Netlify; they are never shown here.'
            : <>Add <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in Netlify and redeploy to turn on card payments.</>}
        </span>
      </section>

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
