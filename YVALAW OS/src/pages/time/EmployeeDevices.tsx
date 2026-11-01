import { useEffect, useState } from 'react'
import { useRole } from '../../context/RoleContext'
import { can } from '../../lib/roles'
import { disconnectDevice, loadDevices, type DesktopDevice } from '../../services/trackerStorage'
import { Banner, Dot } from '../../components/ui'
import { Ic, P } from '../../components/Icon'

const ONLINE_MS = 5 * 60_000      // the app checks in about once a minute while signed in

function date(ms: number): string {
  return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Employee profile → YVA Time Login: the computers signed in to YVA Time, with Disconnect */
export default function EmployeeDevices({ employeeId, firstName }: { employeeId: string; firstName: string }) {
  const { role } = useRole()
  const [devices, setDevices] = useState<DesktopDevice[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { void loadDevices(employeeId).then(setDevices) }, [employeeId])

  async function disconnect(d: DesktopDevice) {
    if (!window.confirm(`Disconnect "${d.name}" from ${firstName}'s YVA Time?\n\nThe app on that computer signs out within a minute and can't save time any more. ${firstName} can sign in again with their YVA OS password (for example on a new computer).`)) return
    setBusy(d.id); setMessage(null)
    try {
      await disconnectDevice(d.id)
      setMessage({ ok: true, text: `"${d.name}" was disconnected.` })
      setDevices(await loadDevices(employeeId))
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message })
    } finally { setBusy(null) }
  }

  if (!devices) return null
  const now = Date.now()
  return (
    <div className="ops-devices">
      <div className="section-label">Computers</div>
      {devices.length === 0 ? (
        <p className="ops-devices__empty">Not signed in to the YVA Time app on any computer yet.</p>
      ) : (
        <div className="ops-devices__list">
          {devices.map(d => {
            const active = !d.revokedAt && !d.signedOutAt
            const online = active && now - d.lastSeenAt < ONLINE_MS
            return (
              <div key={d.id} className="ops-device">
                <span className="ops-device__icon"><Ic d={P.monitor} size={16} /></span>
                <div className="ops-device__main">
                  <div className="ops-device__name">
                    {d.name}
                    {d.appVersion && <span className="ops-device__ver">YVA Time {d.appVersion}</span>}
                  </div>
                  <div className="ops-device__meta">
                    {d.revokedAt ? <span className="t-danger">Disconnected by YVA {date(d.revokedAt)}</span>
                      : d.signedOutAt ? <>Signed out {date(d.signedOutAt)}</>
                      : online ? <span className="t-success ops-device__online"><Dot tone="success" /> Online now</span>
                      : <>Last seen {date(d.lastSeenAt)}</>}
                    {' · '}signed in {date(d.createdAt)}
                  </div>
                </div>
                {active && can.manageDevices(role) && (
                  <button type="button" className="btn btn--sm ops-btn-danger-text" disabled={busy !== null} onClick={() => void disconnect(d)}>
                    {busy === d.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {message && <Banner tone={message.ok ? 'success' : 'danger'} onClose={() => setMessage(null)}>{message.text}</Banner>}
    </div>
  )
}
