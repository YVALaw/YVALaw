import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AppSettings } from '../data/types'
import { loadInvoices, loadSettings, loadUserRoles, saveSettings, settingsHaveBrandingColumns, type UserRoleRow } from '../services/storage'
import { deleteFile, uploadFile } from '../services/fileStorage'
import { usePermission, useRole } from '../context/RoleContext'
import NotificationSettings from '../components/NotificationSettings'
import HistoryList from '../components/HistoryList'
import IntegrationsTab from '../components/settings/IntegrationsTab'
import DataTab from '../components/settings/DataTab'
import TeamAccessTab from '../components/settings/TeamAccessTab'
import { useEmailStatus, type EmailStatusView } from '../components/settings/emailStatus'
import { Banner, Field, PageHeader, Skel } from '../components/ui'
import { Ic, P } from '../components/Icon'
import { STAFF_KINDS } from '../lib/notifications'
import { can } from '../lib/roles'

type InfoDolarBhdResponse = {
  provider: string
  entity: string
  buy: number
  sell: number
  timestamp?: string
  sourceUrl: string
}

type SettingsTab = 'company' | 'email' | 'integrations' | 'currency' | 'notifications' | 'data' | 'team' | 'history'

const ALL_TABS: { id: SettingsTab; label: string; ceoOnly?: boolean }[] = [
  { id: 'company',       label: 'Company' },
  { id: 'email',         label: 'Email' },
  { id: 'integrations',  label: 'Integrations' },
  { id: 'currency',      label: 'Currency' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'data',          label: 'Data' },
  { id: 'team',          label: 'Team access', ceoOnly: true },
  { id: 'history',       label: 'History' },
]
/** Old / alternative names other screens may link with (?tab=access) */
const TAB_ALIASES: Record<string, SettingsTab> = { access: 'team', 'team-access': 'team', permissions: 'team', gmail: 'integrations', outlook: 'integrations' }

const PLACEHOLDERS = ['{clientName}', '{invoiceNumber}', '{amount}', '{period}', '{dueDate}', '{companyName}', '{employeeName}']
const TEMPLATES: { key: 'invoiceEmailTemplate' | 'statementEmailTemplate' | 'reminderEmailTemplate'; label: string; sub: string; placeholder: string }[] = [
  { key: 'invoiceEmailTemplate', label: 'Invoice email', sub: 'Sent when emailing an invoice to a client',
    placeholder: `Hi {clientName},\n\nPlease find attached invoice {invoiceNumber} for {amount}.\n\nBilling period: {period}\n{dueDate}\nPlease don't hesitate to reach out with any questions.\n\n{companyName}` },
  { key: 'statementEmailTemplate', label: 'Employee statement email', sub: 'Sent from the Statements panel in Team page',
    placeholder: `Hi {employeeName},\n\nHere is your earnings summary for the period {period}.\n\nTotal Hours: ...\nTotal Earned: ...\n\nPlease reach out if you have any questions.\n\n{companyName}` },
  { key: 'reminderEmailTemplate', label: 'Payment reminder email', sub: 'Sent via Remind button on overdue/unpaid invoices',
    placeholder: `Hi {clientName},\n\nThis is a friendly reminder that invoice {invoiceNumber} for {amount} is past due.\n\nOriginal due date: {dueDate}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n{companyName}` },
]
const DAYS: [string, string][] = [['', 'Off'], ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']]

// Form values are strings while typing (number inputs that re-render a parsed number eat the decimal point)
type Form = {
  companyName: string; companyEmail: string; companyPhone: string; companyAddress: string; monthlyGoal: string; reminderDay: string
  companyWebsite: string; invoiceFooter: string
  emailSignature: string; invoiceEmailTemplate: string; statementEmailTemplate: string; reminderEmailTemplate: string
  usdToDop: string; crispWebsiteId: string
}
const toForm = (s: AppSettings): Form => ({
  companyName: s.companyName ?? '', companyEmail: s.companyEmail ?? '', companyPhone: s.companyPhone ?? '', companyAddress: s.companyAddress ?? '',
  monthlyGoal: s.monthlyGoal != null ? String(s.monthlyGoal) : '', reminderDay: s.reminderDay != null ? String(s.reminderDay) : '',
  emailSignature: s.emailSignature ?? '', invoiceEmailTemplate: s.invoiceEmailTemplate ?? '', statementEmailTemplate: s.statementEmailTemplate ?? '',
  reminderEmailTemplate: s.reminderEmailTemplate ?? '', usdToDop: s.usdToDop ? String(s.usdToDop) : '',
  companyWebsite: s.companyWebsite ?? '', invoiceFooter: s.invoiceFooter ?? '', crispWebsiteId: s.crispWebsiteId ?? '',
})
const COMPANY_FIELDS = ['companyName', 'companyWebsite', 'companyEmail', 'companyPhone', 'companyAddress', 'monthlyGoal', 'reminderDay', 'invoiceFooter'] as const
/** Company logo upload: images only (no SVG — it could carry script), up to 2 MB */
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const LOGO_MAX = 2 * 1024 * 1024
const EMAIL_FIELDS = ['emailSignature', 'invoiceEmailTemplate', 'statementEmailTemplate', 'reminderEmailTemplate'] as const
type FormKey = keyof Form

function fromForm(f: Form, keys: readonly FormKey[]): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  for (const k of keys) {
    const v = f[k]
    if (k === 'monthlyGoal') out.monthlyGoal = parseFloat(v) || undefined
    else if (k === 'reminderDay') out.reminderDay = v === '' ? undefined : Number(v)
    else if (k === 'usdToDop') out.usdToDop = parseFloat(v) || 0
    else if (k === 'invoiceEmailTemplate' || k === 'statementEmailTemplate' || k === 'reminderEmailTemplate') out[k] = v.trim() ? v : undefined
    else if (k === 'companyWebsite' || k === 'crispWebsiteId') out[k] = v.trim() || undefined
    else if (k === 'invoiceFooter') out.invoiceFooter = v.trim() ? v : undefined
    else (out as Record<string, unknown>)[k] = v
  }
  return out
}
const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))

export default function SettingsPage() {
  const { role: currentRole, loading: roleLoading, userId } = useRole()
  const allowed = usePermission()
  const isCeo = !roleLoading && can.manageRoles(currentRole)
  const TABS = ALL_TABS.filter(t => (!t.ceoOnly || isCeo) && (t.id !== 'history' || allowed('history.view')))
  const [params, setParams] = useSearchParams()
  const raw = (params.get('tab') || '').toLowerCase()
  const requested = (TAB_ALIASES[raw] ?? raw) as SettingsTab
  // Until the role (and its permissions) have loaded, a linked CEO/permission tab is simply not shown yet
  const activeTab: SettingsTab = TABS.some(t => t.id === requested) ? requested : 'company'

  const [saved, setSaved] = useState<AppSettings | null>(null)
  const [form, setForm] = useState<Form>(toForm({ usdToDop: 0 }))
  const [saving, setSaving] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const bannerTimer = useRef<number>()
  const [fetchingRate, setFetchingRate] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const [rateSourceMeta, setRateSourceMeta] = useState<InfoDolarBhdResponse | null>(null)
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(typeof Notification !== 'undefined' ? Notification.permission : 'default')
  const [userRoles, setUserRoles] = useState<(UserRoleRow & { created_at?: string })[] | null>(null)
  const email = useEmailStatus()
  const logoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadSettings().then(s => { setSaved(s); setForm(toForm(s)) })
  }, [])

  // CEO: the people list (also feeds the "waiting" count on the tab)
  useEffect(() => {
    if (isCeo && (activeTab === 'team' || userRoles === null)) void loadUserRoles().then(setUserRoles)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isCeo])

  useEffect(() => () => window.clearTimeout(bannerTimer.current), [])

  // Phones: the tab row scrolls sideways — keep the open tab in view (also when opened from a link)
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>('.set-nav__tab--on')
    const nav = navRef.current
    if (el && nav && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, el.offsetLeft - nav.clientWidth / 2 + el.offsetWidth / 2)
  }, [activeTab, TABS.length])

  function notify(tone: 'success' | 'danger', text: string) {
    window.clearTimeout(bannerTimer.current)
    setBanner({ tone, text })
    if (tone === 'success') bannerTimer.current = window.setTimeout(() => setBanner(null), 4000)
  }

  function setTab(id: SettingsTab) {
    setParams(id === 'company' ? {} : { tab: id }, { replace: true })
  }

  const set = (k: FormKey) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const dirty = (keys: readonly FormKey[]) => !!saved && keys.some(k => norm(fromForm(form, [k])[k as keyof AppSettings]) !== norm(saved[k as keyof AppSettings]))

  /** Saves part of the settings row. saveSettings() doesn't report errors, so the row is read back to confirm. */
  async function save(patch: Partial<AppSettings>, what: string, okText = 'Saved.'): Promise<boolean> {
    if (!saved) return false
    const next = { ...saved, ...patch }
    setSaving(what)
    try {
      await saveSettings(next)
      const back = await loadSettings()
      const ok = (Object.keys(patch) as (keyof AppSettings)[]).every(k => norm(back[k]) === norm(next[k]))
      if (!ok) throw new Error('not saved')
      setSaved(next)
      notify('success', okText)
      return true
    } catch {
      notify('danger', "Couldn't save your changes. Check your connection and try again.")
      return false
    } finally { setSaving(null) }
  }

  async function pickLogo(file: File | undefined) {
    if (logoInput.current) logoInput.current.value = ''
    if (!file || !saved) return
    if (!LOGO_TYPES.includes(file.type)) { notify('danger', 'Pick a PNG, JPG, WebP or GIF image for the logo.'); return }
    if (file.size > LOGO_MAX) { notify('danger', `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the logo can be up to 2 MB.`); return }
    setSaving('logo')
    let up: { storageUrl: string; storagePath: string }
    try {
      up = await uploadFile(file, 'company')
    } catch {
      setSaving(null)
      notify('danger', "Couldn't upload the logo. Check your connection and try again.")
      return
    }
    const old = saved.companyLogoPath
    const ok = await save({ companyLogoUrl: up.storageUrl, companyLogoPath: up.storagePath }, 'logo', 'Logo updated. New invoices and statements use it.')
    // The replaced file (or this upload, if the setting couldn't be saved) is removed; a failed delete only leaves a stray file
    const stale = ok ? old : up.storagePath
    if (stale && stale.startsWith('company/')) void deleteFile(stale).catch(() => {})
  }

  async function resetLogo() {
    if (!saved?.companyLogoUrl) return
    const old = saved.companyLogoPath
    if (await save({ companyLogoUrl: undefined, companyLogoPath: undefined }, 'logo', 'Back to the default YVA logo.') && old && old.startsWith('company/')) {
      void deleteFile(old).catch(() => {})
    }
  }

  async function handleFetchRate() {
    setFetchingRate(true)
    setFetchMsg(null)
    let payload: InfoDolarBhdResponse | null = null
    try {
      const res = await fetch('/.netlify/functions/infodolar-bhd')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFetchingRate(false)
        setFetchMsg(data?.error || 'Could not auto-fetch from InfoDolar BHD.')
        return
      }
      payload = data as InfoDolarBhdResponse
    } catch {
      setFetchingRate(false)
      setFetchMsg('Could not auto-fetch from InfoDolar BHD. Try again or enter the rate manually.')
      return
    }
    setFetchingRate(false)
    if (payload?.sell) {
      setForm(f => ({ ...f, usdToDop: String(payload!.sell) }))
      setRateSourceMeta(payload)
      if (await save({ usdToDop: payload.sell }, 'rate', 'Exchange rate saved.')) {
        setFetchMsg(`Rate updated from ${payload.entity} via ${payload.provider}: RD$${payload.sell} / $1 USD`)
      }
    } else {
      setFetchMsg('Could not auto-fetch from InfoDolar BHD. Try again or enter the rate manually.')
    }
  }

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return
    const perm = await Notification.requestPermission()
    setNotifPerm(perm)
    if (perm === 'granted') checkAndNotify()
  }

  function checkAndNotify() {
    void loadInvoices().then(invoices => {
      const overdue = invoices.filter(i => (i.status || '').toLowerCase() === 'overdue')
      const drafts  = invoices.filter(i => (i.status || '').toLowerCase() === 'draft')
      const icon = `${window.location.origin}${import.meta.env.BASE_URL}yva-logo.png`
      if (overdue.length > 0) {
        new Notification('YVA OS — Overdue Invoices', {
          body: `${overdue.length} invoice${overdue.length > 1 ? 's are' : ' is'} overdue. Open the Invoices pipeline to review.`, icon,
        })
      }
      if (drafts.length > 0) {
        new Notification('YVA OS — Draft Invoices', {
          body: `${drafts.length} draft invoice${drafts.length > 1 ? 's are' : ' is'} ready to send to clients.`, icon,
        })
      }
      if (overdue.length === 0 && drafts.length === 0) {
        new Notification('YVA OS', { body: 'All clear — no pending actions.', icon })
      }
    })
  }

  const pendingCount = userRoles?.filter(u => u.role === 'pending').length ?? 0
  const saveRow = (keys: readonly FormKey[], what: string, label = 'Save') => (
    <div className="set-actions">
      <button type="button" className="btn btn--primary" disabled={!saved || saving === what || !dirty(keys)}
        onClick={() => void save(fromForm(form, keys), what)}>{saving === what ? 'Saving…' : label}</button>
      {dirty(keys) && <span className="set-unsaved">Unsaved changes</span>}
    </div>
  )
  const loadingCard = <section className="set-card"><Skel w={140} h={18} /><Skel h={42} /><Skel h={42} /><Skel w={90} h={40} /></section>
  const emailPill = (s: EmailStatusView) => s.state === 'ok' ? <span className="set-status set-status--ok">Sending from {s.mailbox}</span>
    : s.state === 'problem' ? <span className="set-status set-status--bad">Can't send right now</span>
    : s.state === 'checking' ? <span className="set-status set-status--off">Checking…</span>
    : <span className="set-status set-status--off">Not set up</span>

  return (
    <div className="page">
      <PageHeader title="Settings" sub="Company, access, integrations and notifications" />
      {banner && <Banner tone={banner.tone} onClose={() => setBanner(null)}>{banner.text}</Banner>}

      <div className="set-layout">
        <nav ref={navRef} className="set-nav" aria-label="Settings sections" role="tablist">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id}
              className={`set-nav__tab${activeTab === t.id ? ' set-nav__tab--on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {t.ceoOnly && <span className="set-nav__ceo">CEO</span>}
              {t.id === 'team' && pendingCount > 0 && <span className="set-nav__count" aria-label={`${pendingCount} waiting`}>{pendingCount}</span>}
            </button>
          ))}
        </nav>

        <div className="set-main" role="tabpanel" aria-label={TABS.find(t => t.id === activeTab)?.label}>
          {/* ── Company ── */}
          {activeTab === 'company' && (!saved ? loadingCard : (
            <section className="set-card" aria-label="Company">
              <h2 className="set-card__title">Company</h2>
              {!settingsHaveBrandingColumns() && (
                <Banner tone="warning">Run <code className="set-code">supabase/migrate-redesign-settings.sql</code> in Supabase to save the logo, website and invoice footer.</Banner>
              )}
              <div className="set-logo-row">
                <img className="set-logo" src={saved.companyLogoUrl || `${import.meta.env.BASE_URL}yva-logo.png`} alt="Company logo" />
                <div className="set-logo-side">
                  <div className="set-actions">
                    <button type="button" className="btn btn--sm" disabled={saving === 'logo'} onClick={() => logoInput.current?.click()}>
                      <Ic d={P.upload} size={14} /> {saving === 'logo' ? 'Uploading…' : 'Change logo'}
                    </button>
                    {saved.companyLogoUrl && (
                      <button type="button" className="btn btn--sm btn--ghost" disabled={saving === 'logo'} onClick={() => void resetLogo()}>Use default</button>
                    )}
                  </div>
                  <span className="set-hint">
                    {saved.companyLogoUrl ? 'Your logo is used on invoices and earnings statements.' : 'Default YVA logo.'} PNG, JPG, WebP or GIF, up to 2 MB.
                    The app icon and notifications keep the YVA logo.
                  </span>
                </div>
                <input ref={logoInput} type="file" className="sr-only" accept={LOGO_TYPES.join(',')} aria-label="Upload company logo"
                  onChange={e => void pickLogo(e.target.files?.[0])} />
              </div>
              <div className="form-grid">
                <Field label="Company name" hint="Shown on invoice PDF exports">
                  <input className="input" value={form.companyName} onChange={set('companyName')} placeholder="YVA Staffing" />
                </Field>
                <Field label="Website" hint="Shown under your contact details on invoices">
                  <input className="input" inputMode="url" autoComplete="url" value={form.companyWebsite} onChange={set('companyWebsite')} placeholder="yvastaffing.agency" />
                </Field>
                <Field label="Email" hint="Pre-filled in email drafts & invoices">
                  <input className="input" type="email" value={form.companyEmail} onChange={set('companyEmail')} placeholder="Contact@yvastaffing.net" />
                </Field>
                <Field label="Phone" hint="Shown on invoice PDFs">
                  <input className="input" value={form.companyPhone} onChange={set('companyPhone')} placeholder="+1 (717) 281-8676" />
                </Field>
                <Field label="Address" hint="Shown on invoice PDFs" full>
                  <input className="input" value={form.companyAddress} onChange={set('companyAddress')} placeholder="Santo Domingo, Dominican Republic" />
                </Field>
                <Field label="Monthly revenue goal ($)" hint="Shown as the goal line on the Home chart">
                  <input className="input" type="number" min="0" step="100" inputMode="decimal" value={form.monthlyGoal} onChange={set('monthlyGoal')} placeholder="10000" />
                </Field>
                <Field label="Weekly invoice reminder" hint="When YVA OS is opened on this day, a browser notification lists unpaid invoices (turn on browser notifications under Notifications)">
                  <select className="select" value={form.reminderDay} onChange={set('reminderDay')}>
                    {DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Invoice footer" hint="Printed at the bottom of every invoice (e.g. a thank-you note or payment instructions)" full>
                  <textarea className="textarea" rows={2} maxLength={500} value={form.invoiceFooter} onChange={set('invoiceFooter')} placeholder="Thank you for choosing YVA Staffing." />
                </Field>
              </div>
              {saveRow(COMPANY_FIELDS, 'company')}
            </section>
          ))}

          {/* ── Email ── */}
          {activeTab === 'email' && (!saved ? loadingCard : (
            <section className="set-card" aria-label="Email">
              <div className="set-email-line">
                <div className="set-card__titles">
                  <h2 className="set-card__title">Email</h2>
                  <span className="set-card__sub">Invoices, reminders and statements are sent from the company Outlook mailbox</span>
                </div>
                <div className="set-actions">
                  {emailPill(email.status)}
                  {email.status.state !== 'ok' && email.status.state !== 'checking' && (
                    <button type="button" className="link" onClick={() => setTab('integrations')}>Set up in Integrations →</button>
                  )}
                </div>
              </div>
              <Field label="Email signature" hint="Appended to all email invoice drafts">
                <textarea className="textarea" rows={3} value={form.emailSignature} onChange={set('emailSignature')}
                  placeholder={'Best regards,\nYVA Staffing Team\nyvastaffing.net'} />
              </Field>
              <div className="set-placeholders">
                <span>Placeholders you can use:</span>
                {PLACEHOLDERS.map(p => <code key={p} className="set-code">{p}</code>)}
              </div>
              {TEMPLATES.map(t => (
                <div key={t.key} className="set-tpl">
                  <div className="set-tpl__head">
                    <div className="set-card__titles">
                      <span className="field__label">{t.label}</span>
                      <span className="field__hint">{t.sub}</span>
                    </div>
                    {form[t.key] && <button type="button" className="btn btn--xs btn--ghost" onClick={() => setForm(f => ({ ...f, [t.key]: '' }))}>Reset to default</button>}
                  </div>
                  <textarea className="textarea" rows={6} aria-label={t.label} value={form[t.key]} onChange={set(t.key)} placeholder={t.placeholder} />
                </div>
              ))}
              {saveRow(EMAIL_FIELDS, 'email')}
            </section>
          ))}

          {/* ── Integrations ── */}
          {activeTab === 'integrations' && (
            <IntegrationsTab
              email={email.status}
              recheck={email.recheck}
              notify={notify}
              crisp={{
                value: form.crispWebsiteId,
                saved: saved?.crispWebsiteId ?? '',
                loading: !saved,
                ready: !saved || settingsHaveBrandingColumns(),
                saving: saving === 'crisp',
                dirty: dirty(['crispWebsiteId']),
                onChange: v => setForm(f => ({ ...f, crispWebsiteId: v })),
                save: () => save(fromForm(form, ['crispWebsiteId']), 'crisp', form.crispWebsiteId.trim() ? 'Crisp chat is on in the client portal.' : 'Crisp chat turned off.'),
              }}
            />
          )}

          {/* ── Currency ── */}
          {activeTab === 'currency' && (!saved ? loadingCard : (
            <section className="set-card set-card--narrow" aria-label="Currency">
              <h2 className="set-card__title">Currency</h2>
              <div className="set-rate-pair">
                <Field label="Billing currency">
                  <input className="input" value="USD" readOnly aria-readonly />
                </Field>
                <Field label="USD → DOP (BHD sell)">
                  <input className="input" type="number" step="0.01" inputMode="decimal" value={form.usdToDop} onChange={set('usdToDop')} placeholder="59.50" />
                </Field>
              </div>
              <span className="set-hint">
                Auto-fetched from InfoDolar using Banco BHD sell rate. Click Fill from BHD or enter manually. Used on internal reports;
                payroll uses BHD's buy rate on each payday. DOP is never shown to clients.
              </span>
              <div className="set-actions">
                <button type="button" className="btn" onClick={() => void handleFetchRate()} disabled={fetchingRate || saving === 'rate'}>
                  <Ic d={P.refresh} size={14} /> {fetchingRate ? 'Fetching…' : 'Fill from BHD'}
                </button>
                {saveRow(['usdToDop'], 'rate', 'Save rate')}
              </div>
              {fetchMsg && <Banner tone={fetchMsg.startsWith('Could') ? 'danger' : 'success'}>{fetchMsg}</Banner>}
              {rateSourceMeta && (
                <span className="set-hint">
                  Source: <strong>{rateSourceMeta.entity}</strong> via {rateSourceMeta.provider}
                  {typeof rateSourceMeta.buy === 'number' ? ` · Buy RD$${rateSourceMeta.buy}` : ''}
                  {typeof rateSourceMeta.sell === 'number' ? ` · Sell RD$${rateSourceMeta.sell}` : ''}
                  {rateSourceMeta.timestamp ? ` · ${rateSourceMeta.timestamp}` : ''}
                  {' · '}
                  <a href={rateSourceMeta.sourceUrl} target="_blank" rel="noreferrer">Open source</a>
                </span>
              )}
              {saved.usdToDop > 0 && (
                <Banner tone="info">Active rate: $1 USD = RD${saved.usdToDop} · DOP amounts shown on internal invoice cards and payslips</Banner>
              )}
            </section>
          ))}

          {/* ── Notifications ── */}
          {activeTab === 'notifications' && (
            <>
              <section className="set-card" aria-label="My notifications">
                <div className="set-card__titles">
                  <h2 className="set-card__title">My notifications</h2>
                  <span className="set-card__sub">The bell is always on. Phone push needs the installed app.</span>
                </div>
                <NotificationSettings kinds={STAFF_KINDS} />
              </section>
              <section className="set-card" aria-label="Browser notifications">
                <div className="set-card__head">
                  <div className="set-card__titles">
                    <h2 className="set-card__title">Browser notifications</h2>
                    <span className="set-card__sub">
                      {notifPerm === 'granted'
                        ? 'Enabled. Click to send a test check for overdue & draft invoices.'
                        : notifPerm === 'denied'
                        ? 'Blocked by browser — enable in browser site settings.'
                        : 'Allow YVA OS to send reminders for overdue & draft invoices.'}
                    </span>
                  </div>
                  {notifPerm === 'granted'
                    ? <button type="button" className="btn btn--sm" onClick={checkAndNotify}>Check Now</button>
                    : <button type="button" className="btn btn--primary btn--sm" onClick={() => void requestNotifications()} disabled={notifPerm === 'denied'}>Enable</button>}
                </div>
                <span className="set-hint">The weekly invoice reminder day is set under Company.</span>
              </section>
            </>
          )}

          {/* ── Data ── */}
          {activeTab === 'data' && <DataTab isCeo={isCeo} canImportLeads={allowed('leads.manage')} />}

          {/* ── Team access (CEO) ── */}
          {activeTab === 'team' && isCeo && (
            <TeamAccessTab users={userRoles} setUsers={setUserRoles} meId={userId} notify={notify} />
          )}

          {/* ── History ── */}
          {activeTab === 'history' && allowed('history.view') && (
            <section className="set-card set-card--flush" aria-label="Change history">
              <div className="set-card__head">
                <div className="set-card__titles">
                  <h2 className="set-card__title">Change history</h2>
                  <span className="set-card__sub">Every change to invoices, clients, projects, employees, rates, payroll and access — who made it and when.</span>
                </div>
              </div>
              <HistoryList />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
