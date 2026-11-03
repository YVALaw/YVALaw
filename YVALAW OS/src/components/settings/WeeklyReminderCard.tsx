// Settings → Notifications → "Weekly reminder email" (CEO + Admin — the settings row is theirs to change).
// A summary email once a week from the company Outlook mailbox: drafts still to send, money owed, last week's close.
// Sent by netlify/functions/weekly-reminder.cjs (checks every hour); "Email me a test now" → weekly-reminder-test.cjs.
import { useEffect, useMemo, useState } from 'react'
import { loadUserRoles } from '../../services/storage'
import { DAY_NAMES, REMINDER_SECTIONS, hourLabel, loadWeeklyReminder, saveWeeklyReminder, sendWeeklyReminderTest, type ReminderSection, type WeeklyReminder } from '../../services/weeklyReminder'
import { nextReminder, reminderDateLabel } from '../../utils/reminderSchedule'
import { formatEmailList, parseEmailList } from '../../utils/emailList'
import { dateMed } from '../../utils/format'
import { Banner, Checkbox, Field, Skel, Switch } from '../ui'
import { Ic, P } from '../Icon'
import { useToast } from '../../context/ToastContext'

type Form = { enabled: boolean; day: number; hour: number; recipients: string; include: ReminderSection[] }
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const toForm = (r: WeeklyReminder): Form => ({ enabled: r.enabled, day: r.day, hour: r.hour, recipients: formatEmailList(r.recipients), include: r.include })
const same = (a: Form, b: Form) => a.enabled === b.enabled && a.day === b.day && a.hour === b.hour
  && parseEmailList(a.recipients).emails.join(',').toLowerCase() === parseEmailList(b.recipients).emails.join(',').toLowerCase()
  && [...a.include].sort().join() === [...b.include].sort().join()

export default function WeeklyReminderCard() {
  const toast = useToast()
  const [saved, setSaved] = useState<WeeklyReminder | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ceoEmails, setCeoEmails] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let alive = true
    loadWeeklyReminder()
      .then(r => { if (alive) { setSaved(r); setForm(toForm(r)) } })
      .catch(e => { if (alive) setLoadError((e as Error).message) })
    void loadUserRoles().then(rows => { if (alive) setCeoEmails(rows.filter(r => r.role === 'ceo' && r.email).map(r => r.email)) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const parsed = useMemo(() => parseEmailList(form?.recipients ?? ''), [form?.recipients])
  const recipientError = parsed.invalid.length
    ? `Not an email address: ${parsed.invalid.slice(0, 3).join(', ')}`
    : parsed.emails.length > 10 ? 'Up to 10 recipients.' : null

  if (loadError) return (
    <section className="set-card" aria-label="Weekly reminder email">
      <h2 className="set-card__title">Weekly reminder email</h2>
      <Banner tone="danger">Couldn't load the weekly reminder settings: {loadError}</Banner>
    </section>
  )
  if (!saved || !form) return (
    <section className="set-card" aria-label="Weekly reminder email"><Skel w={180} h={18} /><Skel h={42} /><Skel h={42} /><Skel w={120} h={40} /></section>
  )

  const f = form
  const dirty = !same(f, toForm(saved))
  const off = !saved.ready
  const set = (patch: Partial<Form>) => setForm({ ...f, ...patch })
  const toggleSection = (id: ReminderSection, on: boolean) => set({ include: on ? REMINDER_SECTIONS.map(s => s.id).filter(s => s === id || f.include.includes(s)) : f.include.filter(s => s !== id) })
  const next = nextReminder({ day: f.day, hour: f.hour, lastSent: saved.lastSent }, Date.now(), saved.timeZone)
  const tzName = saved.timeZone === 'America/Santo_Domingo' ? 'Dominican Republic time' : saved.timeZone

  async function save() {
    if (recipientError) { toast.error(recipientError); return }
    setSaving(true)
    try {
      const back = await saveWeeklyReminder({ enabled: f.enabled, day: f.day, hour: f.hour, recipients: parsed.emails, include: f.include })
      const fresh = { ...back, timeZone: saved!.timeZone }
      setSaved(fresh); setForm(toForm(fresh))
      toast.success(fresh.enabled ? `Weekly reminder on: ${DAY_NAMES[fresh.day]}s at ${hourLabel(fresh.hour)} (${tzName}).` : 'Weekly reminder email turned off.')
    } catch (e) {
      toast.error(`Couldn't save the weekly reminder: ${(e as Error).message}`)
    } finally { setSaving(false) }
  }

  async function sendTest() {
    setTesting(true)
    try {
      const r = await sendWeeklyReminderTest(f.include)
      toast.success(`Test sent to ${r.to}. Check your inbox.`)
    } catch (e) {
      toast.error(`Test not sent: ${(e as Error).message}`)
    } finally { setTesting(false) }
  }

  return (
    <section className="set-card" aria-label="Weekly reminder email">
      <div className="set-card__head">
        <div className="set-card__titles">
          <h2 className="set-card__title">Weekly reminder email</h2>
          <span className="set-card__sub">A short summary once a week: invoices still in draft, money owed, and whether last week's close is approved — with a link to YVA OS.</span>
        </div>
        <span className="set-wr__switch">
          <span className={`set-status ${f.enabled ? 'set-status--ok' : 'set-status--off'}`}>{f.enabled ? 'On' : 'Off'}</span>
          <Switch checked={f.enabled} disabled={off} onChange={v => set({ enabled: v })} label="Send the weekly reminder email" />
        </span>
      </div>

      {off && <Banner tone="warning">Run <code className="set-code">supabase/migrate-weekly-reminder.sql</code> in Supabase to turn this on. You can already send yourself a test.</Banner>}

      <div className="form-grid">
        <Field label="Day">
          <select className="select" aria-label="Reminder day" value={f.day} disabled={off} onChange={e => set({ day: Number(e.target.value) })}>
            {DAY_ORDER.map(d => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
          </select>
        </Field>
        <Field label="Time" hint={`${tzName} (${saved.timeZone})`}>
          <select className="select" aria-label="Reminder time" value={f.hour} disabled={off} onChange={e => set({ hour: Number(e.target.value) })}>
            {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </Field>
        <Field label="Send to" full error={recipientError}
          hint={parsed.emails.length ? `${parsed.emails.length} recipient${parsed.emails.length === 1 ? '' : 's'}. Separate several with commas.`
            : `Empty = the CEO login${ceoEmails.length > 1 ? 's' : ''}${ceoEmails.length ? ` (${ceoEmails.join(', ')})` : ''}. Separate several with commas.`}>
          <input className="input" aria-label="Reminder recipients" inputMode="email" autoComplete="off" disabled={off}
            placeholder={ceoEmails.join(', ') || 'you@yvastaffing.agency'} value={f.recipients} onChange={e => set({ recipients: e.target.value })} />
        </Field>
      </div>

      <div className="set-wr__sections" role="group" aria-label="What the email contains">
        <span className="field__label">What it contains</span>
        {REMINDER_SECTIONS.map(s => (
          <div key={s.id} className="set-wr__section">
            <Checkbox checked={f.include.includes(s.id)} disabled={off} onChange={v => toggleSection(s.id, v)} label={s.label} />
            <span className="set-wr__section-hint">{s.hint}</span>
          </div>
        ))}
      </div>

      <div className="set-wr__when" data-next={f.enabled ? next.date : ''}>
        <Ic d={P.time} size={14} />
        <span>
          {!f.enabled ? 'Off — no weekly email is sent.'
            : next.catchUp ? `Goes out within the hour (today's ${hourLabel(f.hour)} email hasn't been sent yet).`
            : `Next email: ${reminderDateLabel(next.date)} at ${hourLabel(next.hour)} ${tzName}.`}
          {saved.lastSent && <> Last sent {dateMed(saved.lastSent)}.</>}
          {dirty && f.enabled && <> (after you save)</>}
        </span>
      </div>

      <div className="set-actions">
        <button type="button" className="btn btn--primary" disabled={off || saving || !dirty || !!recipientError} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" className="btn" disabled={testing || f.include.length === 0} onClick={() => void sendTest()}>
          <Ic d={P.send} size={14} /> {testing ? 'Sending…' : 'Email me a test now'}
        </button>
        {dirty && <span className="set-unsaved">Unsaved changes</span>}
      </div>
    </section>
  )
}
