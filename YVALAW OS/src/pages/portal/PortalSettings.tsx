import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useRole } from '../../context/RoleContext'
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
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, padding: '10px 22px', borderRadius: 12, fontSize: 13, fontWeight: 700,
      background: ok ? '#15803d' : '#b91c1c',
      color: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
      pointerEvents: 'none',
    }}>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading settings…</div>
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
      <Section title="Account" icon="👤" sub="Your profile information">
        <Row label="Name"    value={client?.name ?? '—'} />
        <Row label="Company" value={client?.company ?? '—'} />
        <Row label="Email"   value={authEmail ?? client?.email ?? '—'} sub="Contact your account manager to change your email" />

        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Phone number</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              style={inputStyle}
            />
            <button
              className="btn-primary"
              onClick={() => void saveProfile()}
              disabled={savingAcct}
              style={{ fontSize: 13, whiteSpace: 'nowrap' }}
            >
              {savingAcct ? 'Saving…' : 'Save'}
            </button>
          </div>
          {acctMsg && <Feedback msg={acctMsg.text} ok={acctMsg.ok} />}
        </div>
      </Section>

      {/* ── Working Hours ─────────────────────────────────────────────────── */}
      <Section title="Working Hours" icon="🕐" sub="Let us know when you're available — your team will be scheduled accordingly">

        {/* Timezone */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Your timezone</label>
          <select
            value={timezone}
            onChange={e => setTimezone(e.target.value)}
            style={{ ...inputStyle, maxWidth: 320 }}
          >
            <option value="">— Select timezone —</option>
            {TIMEZONES.map(tz => (
              <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
            ))}
          </select>
        </div>

        {/* Per-day schedule */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {DAYS.map(({ key, label }) => (
            <div key={key} style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr 1fr',
              gap: 12,
              alignItems: 'center',
              padding: '12px 16px',
              background: 'var(--surf2)',
              borderRadius: 12,
              border: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{label}</span>
              <div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Start</label>
                <input
                  type="time"
                  value={hours[`${key}Start`] ?? ''}
                  onChange={e => setHours(h => ({ ...h, [`${key}Start`]: e.target.value || undefined }))}
                  style={{ ...inputStyle, padding: '6px 10px', width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>End</label>
                <input
                  type="time"
                  value={hours[`${key}End`] ?? ''}
                  onChange={e => setHours(h => ({ ...h, [`${key}End`]: e.target.value || undefined }))}
                  style={{ ...inputStyle, padding: '6px 10px', width: '100%' }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Notes for your team</label>
          <textarea
            value={schedNotes}
            onChange={e => setSchedNotes(e.target.value)}
            rows={3}
            placeholder="e.g. Prefer calls in the morning, no Fridays after 3pm…"
            style={{ ...inputStyle, width: '100%', resize: 'vertical', marginTop: 6 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            onClick={() => void saveHours()}
            disabled={savingHrs}
            style={{ fontSize: 13 }}
          >
            {savingHrs ? 'Saving…' : 'Save Schedule'}
          </button>
          {hrsMsg && <Feedback msg={hrsMsg.text} ok={hrsMsg.ok} inline />}
        </div>
      </Section>

      {/* ── Security ──────────────────────────────────────────────────────── */}
      <Section title="Security" icon="🔒" sub="Change your portal password">

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 400 }}>
          <div>
            <label style={labelStyle}>New password</label>
            <input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="Minimum 8 characters"
              style={{ ...inputStyle, marginTop: 6, width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Confirm new password</label>
            <input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="Repeat your new password"
              style={{
                ...inputStyle,
                marginTop: 6,
                width: '100%',
                borderColor: confirmPw && confirmPw !== newPw ? '#ef4444' : undefined,
              }}
            />
            {confirmPw && confirmPw !== newPw && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>Passwords do not match</div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn-primary"
            onClick={() => void changePassword()}
            disabled={savingPw || !newPw || newPw !== confirmPw}
            style={{ fontSize: 13 }}
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
  title: string; icon: string; sub: string; children: React.ReactNode
}) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 16, overflow: 'hidden',
    }}>
      {/* Section header */}
      <div style={{
        padding: '18px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--surf2)',
      }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
        </div>
      </div>
      {/* Section body */}
      <div style={{ padding: '20px 24px' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '10px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, opacity: 0.7 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textAlign: 'right' }}>{value}</div>
    </div>
  )
}

function Feedback({ msg, ok, inline }: { msg: string; ok: boolean; inline?: boolean }) {
  const style: React.CSSProperties = inline
    ? { fontSize: 12, fontWeight: 600, color: ok ? '#15803d' : '#ef4444' }
    : {
        marginTop: 10, fontSize: 12, padding: '8px 12px',
        background: ok ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)',
        border: `1px solid ${ok ? 'rgba(34,197,94,.2)' : 'rgba(239,68,68,.2)'}`,
        borderRadius: 8, color: ok ? '#15803d' : '#ef4444', fontWeight: 600,
      }
  return <div style={style}>{msg}</div>
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surf2)',
  color: 'var(--text)',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--muted)',
  display: 'block',
}
