import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useRole } from '../../context/RoleContext'
import { IconLock, IconUser, IconClock } from '../../components/Icon'
import {
  loadPortalClient,
  loadPortalWorkingHours,
  savePortalProfilePhone,
  savePortalWorkingHours,
} from '../../services/portalStorage'
import type { Client, WorkingHourPrefs } from '../../data/types'

// ── Day config ────────────────────────────────────────────────────────────────

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

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div className={`portal-toast ${ok ? 'portal-toast-success' : 'portal-toast-error'}`}>
      {msg}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalSettings() {
  const { clientId: roleClientId, email: authEmail } = useRole()
  const [searchParams] = useSearchParams()
  const previewId = searchParams.get('preview')
  const clientId  = roleClientId ?? previewId

  const [client,  setClient]  = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)

  // ── Account section ────────────────────────────────────────────────────────
  const [phone,       setPhone]       = useState('')
  const [savingAcct,  setSavingAcct]  = useState(false)
  const [acctMsg,     setAcctMsg]     = useState<{ text: string; ok: boolean } | null>(null)

  // ── Working hours section ──────────────────────────────────────────────────
  const [prefId,      setPrefId]      = useState<string | null>(null)
  const [hours,       setHours]       = useState<HourMap>({})
  const [timezone,    setTimezone]    = useState('')
  const [schedNotes,  setSchedNotes]  = useState('')
  const [savingHrs,   setSavingHrs]   = useState(false)
  const [hrsMsg,      setHrsMsg]      = useState<{ text: string; ok: boolean } | null>(null)

  // ── Security section ───────────────────────────────────────────────────────
  const [newPw,       setNewPw]       = useState('')
  const [confirmPw,   setConfirmPw]   = useState('')
  const [savingPw,    setSavingPw]    = useState(false)
  const [pwMsg,       setPwMsg]       = useState<{ text: string; ok: boolean } | null>(null)

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)
  function showToast(text: string, ok: boolean) {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const [c, prefs] = await Promise.all([
        loadPortalClient(clientId),
        loadPortalWorkingHours(clientId),
      ])
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

  // ── Save profile ───────────────────────────────────────────────────────────
  async function saveProfile() {
    if (!clientId) return
    setSavingAcct(true)
    setAcctMsg(null)
    try {
      await savePortalProfilePhone({ clientId, phone })
      setAcctMsg({ text: 'Profile updated.', ok: true })
      showToast('Profile saved', true)
      setTimeout(() => setAcctMsg(null), 3000)
    } catch {
      setAcctMsg({ text: 'Failed to save. Please try again.', ok: false })
    } finally {
      setSavingAcct(false)
    }
  }

  // ── Save working hours ─────────────────────────────────────────────────────
  async function saveHours() {
    if (!clientId) return
    setSavingHrs(true)
    setHrsMsg(null)
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
      setHrsMsg({ text: 'Working hours saved.', ok: true })
      showToast('Schedule saved', true)
      setTimeout(() => setHrsMsg(null), 3000)
    } catch (err) {
      setHrsMsg({ text: err instanceof Error ? err.message : 'Failed to save.', ok: false })
    } finally {
      setSavingHrs(false)
    }
  }

  // ── Change password ────────────────────────────────────────────────────────
  async function changePassword() {
    if (!newPw || newPw !== confirmPw) {
      setPwMsg({ text: 'Passwords do not match.', ok: false })
      return
    }
    if (newPw.length < 8) {
      setPwMsg({ text: 'Password must be at least 8 characters.', ok: false })
      return
    }
    setSavingPw(true)
    setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    setSavingPw(false)
    if (error) {
      setPwMsg({ text: error.message, ok: false })
    } else {
      setPwMsg({ text: 'Password updated successfully.', ok: true })
      showToast('Password changed', true)
      setNewPw('')
      setConfirmPw('')
      setTimeout(() => setPwMsg(null), 3000)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Loading settings…</div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title">Settings</div>
          <div className="page-sub">
            {client?.company ? client.company + ' · ' : ''}Manage your account preferences
          </div>
        </div>
      </div>

      {/* ── Account Info ─────────────────────────────────────────────────── */}
      <Section title="Account" icon={<IconUser size={20} />} sub="Your profile information">
        <Row label="Name"    value={client?.name ?? '—'} />
        <Row label="Company" value={client?.company ?? '—'} />
        <Row label="Email"   value={authEmail ?? client?.email ?? '—'} sub="Contact your account manager to change your email" />

        <div className="mt-16">
          <label className="form-label">Phone number</label>
          <div className="portal-settings-phone-row">
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="form-input"
            />
            <button
              className="btn-primary"
              onClick={() => void saveProfile()}
              disabled={savingAcct}
              style={{ whiteSpace: 'nowrap' }}
            >
              {savingAcct ? 'Saving…' : 'Save'}
            </button>
          </div>
          {acctMsg && <Feedback msg={acctMsg.text} ok={acctMsg.ok} />}
        </div>
      </Section>

      {/* ── Working Hours ─────────────────────────────────────────────────── */}
      <Section title="Working Hours" icon={<IconClock size={20} />} sub="Let us know when you're available — your team will be scheduled accordingly">

        {/* Timezone */}
        <div className="mb-20">
          <label className="form-label">Your timezone</label>
          <select
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            className="form-input max-w-320"
          >
            <option value="">— Select timezone —</option>
            {TIMEZONES.map(tz => (
              <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        {/* Per-day schedule */}
        <div className="flex-col" style={{ gap: 10, marginBottom: 20 }}>
          {DAYS.map(({ key, label }) => (
            <div key={key} className="portal-hours-row">
              <span className="portal-hours-day">{label}</span>
              <div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Start</label>
                <input
                  type="time"
                  value={hours[`${key}Start`] ?? ''}
                  onChange={e => setHours(h => ({ ...h, [`${key}Start`]: e.target.value || undefined }))}
                  className="form-input form-input-sm w-full"
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>End</label>
                <input
                  type="time"
                  value={hours[`${key}End`] ?? ''}
                  onChange={e => setHours(h => ({ ...h, [`${key}End`]: e.target.value || undefined }))}
                  className="form-input form-input-sm w-full"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div className="mb-20">
          <label className="form-label">Notes for your team</label>
          <textarea
            value={schedNotes}
            onChange={e => setSchedNotes(e.target.value)}
            rows={3}
            placeholder="e.g. Prefer calls in the morning, no Fridays after 3pm…"
            className="form-textarea mt-6"
          />
        </div>

        <div className="flex items-center" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            onClick={() => void saveHours()}
            disabled={savingHrs}
          >
            {savingHrs ? 'Saving…' : 'Save Schedule'}
          </button>
          {hrsMsg && <Feedback msg={hrsMsg.text} ok={hrsMsg.ok} inline />}
        </div>
      </Section>

      {/* ── Security ──────────────────────────────────────────────────────── */}
      <Section title="Security" icon={<IconLock size={16} />} sub="Change your portal password">

        <div className="flex-col max-w-400" style={{ gap: 14 }}>
          <div>
            <label className="form-label">New password</label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="Minimum 8 characters"
              className="form-input mt-6 w-full"
            />
          </div>
          <div>
            <label className="form-label">Confirm new password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="Repeat your new password"
              className="form-input mt-6 w-full"
              style={{ borderColor: confirmPw && confirmPw !== newPw ? '#ef4444' : undefined }}
            />
            {confirmPw && confirmPw !== newPw && (
              <div className="mt-4 text-warn" style={{ fontSize: 12 }}>Passwords do not match</div>
            )}
          </div>
        </div>

        <div className="mt-18 flex items-center" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            onClick={() => void changePassword()}
            disabled={savingPw || !newPw || newPw !== confirmPw}
          >
            {savingPw ? 'Updating…' : 'Change Password'}
          </button>
          {pwMsg && <Feedback msg={pwMsg.text} ok={pwMsg.ok} inline />}
        </div>
      </Section>

      {/* Global toast */}
      {toast && <Toast msg={toast.text} ok={toast.ok} />}

    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon, sub, children }: {
  title: string; icon: React.ReactNode; sub: string; children: React.ReactNode
}) {
  return (
    <div className="portal-section">
      {/* Section header */}
      <div className="portal-section-header">
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <div className="portal-section-title">{title}</div>
          <div className="portal-section-sub">{sub}</div>
        </div>
      </div>
      {/* Section body */}
      <div className="portal-section-body">
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="settings-row-item">
      <div>
        <div className="settings-row-label">{label}</div>
        {sub && <div className="settings-row-sub">{sub}</div>}
      </div>
      <div className="settings-row-value">{value}</div>
    </div>
  )
}

function Feedback({ msg, ok, inline }: { msg: string; ok: boolean; inline?: boolean }) {
  if (inline) {
    return <span style={{ fontSize: 12, fontWeight: 600, color: ok ? '#15803d' : '#ef4444' }}>{msg}</span>
  }
  return (
    <div className={`portal-message mt-10 ${ok ? 'portal-message-success' : 'portal-message-error'}`}>
      {msg}
    </div>
  )
}
