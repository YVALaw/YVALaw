// Portal → Settings (avatar menu): account (only phone editable, via update-portal-profile), working hours
// Mon–Fri + time zone + notes, change password, sign out.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useRole } from '../../context/RoleContext'
import { signOutAndForgetDevice } from '../../services/notifications'
import {
  loadPortalClient,
  loadPortalWorkingHours,
  savePortalProfilePhone,
  savePortalWorkingHours,
} from '../../services/portalStorage'
import type { Client, WorkingHourPrefs } from '../../data/types'
import { Banner } from '../../components/ui'
import { usePortal, PortalSkeleton } from '../../components/PortalSection'

const DAYS = [
  { key: 'monday',    label: 'Monday'    },
  { key: 'tuesday',   label: 'Tuesday'   },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday',  label: 'Thursday'  },
  { key: 'friday',    label: 'Friday'    },
] as const
type DayKey = typeof DAYS[number]['key']
type HourMap = Partial<Record<`${DayKey}Start` | `${DayKey}End`, string>>

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
  'America/Santo_Domingo',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Sao_Paulo',
]

export default function PortalSettings() {
  const { email: authEmail } = useRole()
  const { clientId, isPreview } = usePortal()
  const navigate = useNavigate()

  const [client,  setClient]  = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [success, setSuccess] = useState<string | null>(null)

  // Account
  const [phone,      setPhone]      = useState('')
  const [savingAcct, setSavingAcct] = useState(false)
  const [acctErr,    setAcctErr]    = useState<string | null>(null)

  // Working hours
  const [prefId,     setPrefId]     = useState<string | null>(null)
  const [hours,      setHours]      = useState<HourMap>({})
  const [timezone,   setTimezone]   = useState('')
  const [schedNotes, setSchedNotes] = useState('')
  const [savingHrs,  setSavingHrs]  = useState(false)
  const [hrsErr,     setHrsErr]     = useState<string | null>(null)

  // Password
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [savingPw,  setSavingPw]  = useState(false)
  const [pwErr,     setPwErr]     = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const [c, prefs] = await Promise.all([loadPortalClient(clientId), loadPortalWorkingHours(clientId)])
      setClient(c)
      if (c?.phone) setPhone(c.phone)
      if (prefs) {
        setPrefId(prefs.id)
        setTimezone(prefs.timezone ?? '')
        setSchedNotes(prefs.notes ?? '')
        const hm: HourMap = {}
        for (const d of DAYS) {
          const s = (prefs as unknown as Record<string, string | undefined>)[`${d.key}Start`]
          const e = (prefs as unknown as Record<string, string | undefined>)[`${d.key}End`]
          if (s) hm[`${d.key}Start`] = s
          if (e) hm[`${d.key}End`]   = e
        }
        setHours(hm)
      }
      setLoading(false)
    })()
  }, [clientId])

  function flash(text: string) {
    setSuccess(text)
    window.scrollTo(0, 0)
    setTimeout(() => setSuccess(s => (s === text ? null : s)), 4000)
  }

  async function saveProfile() {
    if (!clientId) return
    setSavingAcct(true)
    setAcctErr(null)
    try {
      await savePortalProfilePhone({ clientId, phone })
      flash('Phone number saved.')
    } catch (err) {
      setAcctErr(err instanceof Error && err.message ? `Could not save: ${err.message}` : 'Failed to save. Please try again.')
    } finally {
      setSavingAcct(false)
    }
  }

  async function saveHours() {
    if (!clientId) return
    setSavingHrs(true)
    setHrsErr(null)
    try {
      const prefs: WorkingHourPrefs = {
        id:             prefId ?? crypto.randomUUID(),
        clientId,
        timezone:       timezone || undefined,
        notes:          schedNotes || undefined,
        mondayStart:    hours.mondayStart,
        mondayEnd:      hours.mondayEnd,
        tuesdayStart:   hours.tuesdayStart,
        tuesdayEnd:     hours.tuesdayEnd,
        wednesdayStart: hours.wednesdayStart,
        wednesdayEnd:   hours.wednesdayEnd,
        thursdayStart:  hours.thursdayStart,
        thursdayEnd:    hours.thursdayEnd,
        fridayStart:    hours.fridayStart,
        fridayEnd:      hours.fridayEnd,
        updatedAt:      Date.now(),
      }
      await savePortalWorkingHours(prefs)
      if (!prefId) setPrefId(prefs.id)
      flash('Working hours saved.')
    } catch (err) {
      setHrsErr(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSavingHrs(false)
    }
  }

  async function changePassword() {
    if (!newPw || newPw !== confirmPw) { setPwErr('Passwords do not match.'); return }
    if (newPw.length < 8) { setPwErr('Password must be at least 8 characters.'); return }
    setSavingPw(true)
    setPwErr(null)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setSavingPw(false)
    if (error) { setPwErr(error.message); return }
    setNewPw('')
    setConfirmPw('')
    flash('Password updated.')
  }

  async function signOut() {
    await signOutAndForgetDevice()
    navigate('/login')
  }

  if (loading) return <PortalSkeleton />

  const mismatch = confirmPw.length > 0 && confirmPw !== newPw
  const tzShown = timezone ? timezone.replace(/_/g, ' ') : 'not set'

  return (
    <div className="por-page">
      {success && <Banner tone="success" onClose={() => setSuccess(null)}>{success}</Banner>}
      {isPreview && <Banner tone="info">Staff preview: the phone number and password can only be changed by the client.</Banner>}

      <div className="por-grid por-grid--settings">
        <section className="card por-card por-form">
          <h2 className="por-card__title">Account</h2>
          <label className="field">
            <span className="field__label">Company</span>
            <input className="input por-input-lg por-input-ro" value={client?.company || client?.name || '—'} readOnly />
          </label>
          {client?.company && client.name && client.name !== client.company && (
            <label className="field">
              <span className="field__label">Name</span>
              <input className="input por-input-lg por-input-ro" value={client.name} readOnly />
            </label>
          )}
          <label className="field">
            <span className="field__label">Email</span>
            <input className="input por-input-lg por-input-ro" value={authEmail && !isPreview ? authEmail : client?.email || '—'} readOnly />
            <span className="field__hint">Contact your account manager to change your email.</span>
          </label>
          <label className="field">
            <span className="field__label">Phone</span>
            <input className="input por-input-lg" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" disabled={isPreview} />
          </label>
          {acctErr && <div className="banner banner--danger" role="alert">{acctErr}</div>}
          <button type="button" className="btn btn--primary por-btn-lg por-form__btn" disabled={savingAcct || isPreview} onClick={() => void saveProfile()}>
            {savingAcct ? 'Saving…' : 'Save phone'}
          </button>
        </section>

        <section className="card por-card por-form">
          <h2 className="por-card__title">Working hours</h2>
          <p className="por-card__sub">When your office needs the team. Time zone {tzShown}.</p>
          <label className="field">
            <span className="field__label">Time zone</span>
            <select className="select por-input-lg" aria-label="Time zone" value={timezone} onChange={e => setTimezone(e.target.value)}>
              <option value="">Select time zone</option>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <div className="por-hours">
            {DAYS.map(({ key, label }) => (
              <div key={key} className="por-hours__row">
                <span className="por-hours__day">{label}</span>
                <input className="input" type="time" aria-label={`${label} start`} value={hours[`${key}Start`] ?? ''}
                  onChange={e => setHours(h => ({ ...h, [`${key}Start`]: e.target.value || undefined }))} />
                <input className="input" type="time" aria-label={`${label} end`} value={hours[`${key}End`] ?? ''}
                  onChange={e => setHours(h => ({ ...h, [`${key}End`]: e.target.value || undefined }))} />
              </div>
            ))}
          </div>
          <label className="field">
            <span className="field__label">Notes for your team</span>
            <textarea className="textarea" rows={3} value={schedNotes} onChange={e => setSchedNotes(e.target.value)} placeholder="e.g. Prefer calls in the morning, no Fridays after 3pm…" />
          </label>
          {hrsErr && <div className="banner banner--danger" role="alert">{hrsErr}</div>}
          <button type="button" className="btn btn--primary por-btn-lg por-form__btn" disabled={savingHrs} onClick={() => void saveHours()}>
            {savingHrs ? 'Saving…' : 'Save hours'}
          </button>
        </section>

        <section className="card por-card por-form">
          <h2 className="por-card__title">Change password</h2>
          <label className="field">
            <span className="sr-only">New password</span>
            <input className="input por-input-lg" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={newPw} onChange={e => setNewPw(e.target.value)} disabled={isPreview} />
          </label>
          <label className="field">
            <span className="sr-only">Repeat new password</span>
            <input className={`input por-input-lg${mismatch ? ' input--invalid' : ''}`} type="password" autoComplete="new-password" placeholder="Repeat new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} disabled={isPreview} />
            {mismatch && <span className="field__error">Passwords do not match</span>}
          </label>
          {pwErr && <div className="banner banner--danger" role="alert">{pwErr}</div>}
          <button type="button" className="btn por-btn-lg por-form__btn" disabled={isPreview || savingPw || !newPw || newPw !== confirmPw} onClick={() => void changePassword()}>
            {savingPw ? 'Updating…' : 'Update password'}
          </button>
          {!isPreview && <button type="button" className="por-signout" onClick={() => void signOut()}>Sign out</button>}
        </section>
      </div>
    </div>
  )
}
