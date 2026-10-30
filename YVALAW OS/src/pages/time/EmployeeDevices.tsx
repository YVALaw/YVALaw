import { useEffect, useState } from 'react'
import { useRole } from '../../context/RoleContext'
import { can } from '../../lib/roles'
import { disconnectDevice, loadDevices, type DesktopDevice } from '../../services/trackerStorage'

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
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>Computers</div>
      {devices.length === 0 ? (
        <div style={{ fontSize: 13 }}>Not signed in to the YVA Time app on any computer yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {devices.map(d => {
            const active = !d.revokedAt && !d.signedOutAt
            const online = active && now - d.lastSeenAt < ONLINE_MS
            return (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)', overflowWrap: 'anywhere' }}>
                    {d.name}
                    {d.appVersion && <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6, fontSize: 12 }}>YVA Time {d.appVersion}</span>}
                  </div>
                  <div style={{ fontSize: 12 }}>
                    {d.revokedAt ? <span style={{ color: '#b91c1c' }}>Disconnected by YVA {date(d.revokedAt)}</span>
                      : d.signedOutAt ? <>Signed out {date(d.signedOutAt)}</>
                      : online ? <span style={{ color: '#047857' }}>● Online now</span>
                      : <>Last seen {date(d.lastSeenAt)}</>}
                    {' · '}signed in {date(d.createdAt)}
                  </div>
                </div>
                {active && can.manageDevices(role) && (
                  <button className="btn-ghost btn-sm" disabled={busy !== null} onClick={() => void disconnect(d)}>
                    {busy === d.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {message && (
        <div className={`portal-message ${message.ok ? 'portal-message-success' : 'portal-message-error'}`} style={{ marginTop: 8 }}>{message.text}</div>
      )}
    </div>
  )
}
