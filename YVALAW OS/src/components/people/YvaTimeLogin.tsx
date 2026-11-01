// Employee profile → YVA Time tab: the login card (invite / new sign-in link via invite-employee, consent notice)
// and the computers list (Operations' EmployeeDevices, with Disconnect). Invite logic moved unchanged.
import { useEffect, useState } from 'react'
import type { Employee } from '../../data/types'
import { supabase } from '../../lib/supabase'
import { APP_URL } from '../../lib/appUrl'
import { loadLatestConsent } from '../../services/trackerStorage'
import EmployeeDevices from '../../pages/time/EmployeeDevices'
import { Ic, P } from '../Icon'
import { Banner, Card, Pill } from '../ui'
import { firstName } from './common'

const longDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function YvaTimeLogin({ emp, onLinked, onViewScreens }: { emp: Employee; onLinked: (userId: string) => void; onViewScreens?: () => void }) {
  const [inviteLoading, setInviteLoading] = useState<'email' | 'link' | 'reset' | null>(null)
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [consent, setConsent] = useState<{ at: number; version: number } | null>(null)
  useEffect(() => { void loadLatestConsent(emp.id).then(setConsent) }, [emp.id])
  const first = firstName(emp.name)

  // YVA Time / My workspace login — created server-side by invite-employee.
  // 'reset' = they already have a login: a one-time link that opens "Choose a new password".
  async function sendEmployeeInvite(mode: 'email' | 'link' | 'reset') {
    if (!emp.email && mode !== 'reset') { setInviteMsg({ ok: false, text: 'Add an email address to this employee before inviting.' }); return }
    setInviteLoading(mode)
    setInviteMsg(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setInviteLoading(null); setInviteMsg({ ok: false, text: 'You must be logged in.' }); return }
    try {
      const res = await fetch('/.netlify/functions/invite-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ employeeId: emp.id, mode, redirectTo: `${APP_URL}${mode === 'reset' ? 'reset-password' : 'me/set-password'}` }),
      })
      const data = await res.json()
      if (!res.ok) { setInviteMsg({ ok: false, text: data.error || 'Failed to create the link.' }); return }
      // The server linked the login; mirror it locally (whole-table saves never write userId)
      if (mode !== 'reset') onLinked(data.userId)
      if (mode === 'link' || mode === 'reset') {
        const what = mode === 'reset' ? 'New sign-in link' : 'Invite link'
        try {
          await navigator.clipboard.writeText(data.inviteLink)
          setInviteMsg({ ok: true, text: `${what} copied for ${data.email}. Paste it into your own email or message — it works once.` })
        } catch {
          window.prompt(`Copy this ${what.toLowerCase()}:`, data.inviteLink)
          setInviteMsg({ ok: true, text: `${what} created for ${data.email}.` })
        }
      } else {
        setInviteMsg({ ok: true, text: `Invitation email sent to ${data.email}` })
      }
    } catch {
      setInviteMsg({ ok: false, text: 'Network error — could not create the invitation.' })
    } finally {
      setInviteLoading(null)
    }
  }

  const client = emp.worksFor !== 'yva'
  return (
    <div className="grid-auto ppl-tabgrid">
      <Card title="YVA Time login" actions={<Pill tone={emp.userId ? 'success' : 'neutral'}>{emp.userId ? 'Has a login' : 'Not invited'}</Pill>}>
        <div className="card__body stack">
          {inviteMsg && <Banner tone={inviteMsg.ok ? 'success' : 'danger'} onClose={() => setInviteMsg(null)}>{inviteMsg.text}</Banner>}
          {emp.userId ? (
            <>
              <p className="ppl-p">
                {emp.email ? <strong>{emp.email}</strong> : first} can sign in to My workspace and the YVA Time app.
                {client && <> Screenshot &amp; activity notice: {consent
                  ? <><strong>v{consent.version} accepted {longDate(consent.at)}</strong>{consent.version < 2 && ' (older notice without activity % — the app asks again after updating)'}</>
                  : 'not accepted yet (the app asks on first use)'}.</>}
              </p>
              <div className="row row--wrap">
                <button type="button" className="btn btn--sm" disabled={inviteLoading !== null} onClick={() => void sendEmployeeInvite('reset')}
                  title="For an expired invite or a forgotten password: a one-time link that lets them choose a new password">
                  <Ic d={P.link} size={14} />{inviteLoading === 'reset' ? 'Creating…' : 'Copy new sign-in link'}
                </button>
                {onViewScreens && <button type="button" className="btn btn--sm" onClick={onViewScreens}><Ic d={P.image} size={14} />View screenshots</button>}
              </div>
            </>
          ) : (
            <>
              <p className="ppl-p">Send an invitation so {first} can set a password and use My workspace and YVA Time.{!emp.email && ' Add an email address first.'}</p>
              <div className="row row--wrap">
                <button type="button" className="btn btn--sm btn--primary" disabled={!emp.email || inviteLoading !== null} onClick={() => void sendEmployeeInvite('email')}>
                  <Ic d={P.mail} size={14} />{inviteLoading === 'email' ? 'Sending…' : 'Email invite'}
                </button>
                <button type="button" className="btn btn--sm" disabled={!emp.email || inviteLoading !== null} onClick={() => void sendEmployeeInvite('link')}>
                  <Ic d={P.link} size={14} />{inviteLoading === 'link' ? 'Creating…' : 'Copy invite link'}
                </button>
              </div>
            </>
          )}
          <div className="info-grid ppl-divide">
            <div className="info"><span className="info__label">Works for</span><span className="info__value">{client ? 'Client project (screenshots on)' : 'YVA team (screenshots off)'}</span></div>
            <div className="info"><span className="info__label">Manual time</span><span className="info__value">{emp.manualTimeAllowed ? 'On (admin approves)' : 'Off'}</span></div>
            <div className="info"><span className="info__label">Default shift</span><span className="info__value">{emp.defaultShiftStart || emp.defaultShiftEnd ? `${emp.defaultShiftStart || '—'} – ${emp.defaultShiftEnd || '—'}` : 'Not set'}</span></div>
          </div>
        </div>
      </Card>
      {emp.userId ? (
        <Card className="ppl-devices">
          {/* EmployeeDevices (Operations) renders its own "Computers" heading, rows and Disconnect */}
          <div className="card__body"><EmployeeDevices employeeId={emp.id} firstName={first} /></div>
        </Card>
      ) : (
        <Card title="Computers"><div className="card-empty">{first} needs a login before signing in to the YVA Time app.</div></Card>
      )}
    </div>
  )
}
