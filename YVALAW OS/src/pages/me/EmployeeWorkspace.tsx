import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { IconBriefcase, IconClock, IconLogOut, IconUser } from '../../components/Icon'

// Shape returned by /.netlify/functions/employee-me (safe fields only)
type MyEmployee = {
  id: string
  name: string
  employeeNumber: string | null
  email: string | null
  phone: string | null
  role: string | null
  timezone: string | null
  defaultShiftStart: string | null
  defaultShiftEnd: string | null
  photoUrl: string | null
  worksFor: 'client' | 'yva'
  manualTimeAllowed: boolean
}
type MyProject = { id: string; name: string; clientName: string | null; status: string | null }

// Set VITE_YVA_TIME_DOWNLOAD_URL in Netlify once an installer is published (GitHub release asset)
const DOWNLOAD_URL = import.meta.env.VITE_YVA_TIME_DOWNLOAD_URL as string | undefined

/** My workspace — the only YVA OS area an invited employee can open */
export default function EmployeeWorkspace() {
  const [employee, setEmployee] = useState<MyEmployee | null>(null)
  const [projects, setProjects] = useState<MyProject[]>([])
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      try {
        const res  = await fetch('/.netlify/functions/employee-me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error || 'Could not load your profile.'); return }
        setEmployee(data.employee)
        setProjects(data.projects || [])
      } catch {
        setError('Network error — could not load your profile.')
      }
    })()
  }, [])

  const isYva = employee?.worksFor === 'yva'
  const shift = employee?.defaultShiftStart && employee?.defaultShiftEnd
    ? `${employee.defaultShiftStart} – ${employee.defaultShiftEnd}`
    : '—'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src={`${import.meta.env.BASE_URL}yva-logo.png`} alt="YVA" style={{ height: 40 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', overflowWrap: 'anywhere' }}>
              {employee ? `Hi, ${employee.name.split(' ')[0]}` : 'My workspace'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>YVA Staffing · My workspace</div>
          </div>
          <button className="btn-ghost btn-sm" onClick={() => void supabase.auth.signOut()}>
            <IconLogOut size={14} /> Sign out
          </button>
        </div>

        {error && <div className="portal-message portal-message-error">{error}</div>}
        {!employee && !error && <div className="loading-text">Loading your workspace…</div>}

        {employee && (
          <>
            <Section icon={<IconClock size={20} />} title="YVA Time" sub="Track your hours from your computer">
              {DOWNLOAD_URL && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                  <a className="btn-primary" href={DOWNLOAD_URL}>Download YVA Time for Windows</a>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>Install it, open it and click <strong>Sign in with YVA OS</strong>.</span>
                </div>
              )}
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text2)', lineHeight: 1.6 }}>
                {DOWNLOAD_URL
                  ? 'YVA Time runs in the corner of your screen while you work.'
                  : "The YVA Time app for Windows is coming soon. You'll download it here and sign in with this same account."}
                {isYva
                  ? ' As part of the YVA team, screenshots are off for you.'
                  : ' While you track time, the app takes a screenshot at a random moment about every 10 minutes. You can see each one and delete it within 2 minutes (that 10-minute block is then removed from your time).'}
              </p>
              <div style={{ marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
                Adding time by hand: <strong style={{ color: 'var(--text)' }}>
                  {employee.manualTimeAllowed ? 'allowed — an admin approves each entry' : 'not enabled for your account'}
                </strong>
              </div>
            </Section>

            <Section icon={<IconBriefcase size={20} />} title={isYva ? 'YVA team' : 'My projects'}
              sub={isYva ? 'You work for YVA directly' : 'The client projects you are assigned to'}>
              {projects.length === 0 ? (
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>
                  {isYva ? 'No client projects assigned.' : "You're not assigned to a project yet."}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {projects.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px', border: '1px solid var(--border)', borderRadius: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text)', overflowWrap: 'anywhere' }}>{p.name}</div>
                        {p.clientName && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.clientName}</div>}
                      </div>
                      {p.status && <span className="badge badge-gray" style={{ alignSelf: 'center', textTransform: 'capitalize' }}>{p.status}</span>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section icon={<IconUser size={20} />} title="My details" sub="Ask YVA to update anything that's wrong">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                <Row label="Name"            value={employee.name} />
                <Row label="Employee number" value={employee.employeeNumber || '—'} />
                <Row label="Position"        value={employee.role || '—'} />
                <Row label="Email"           value={employee.email || '—'} />
                <Row label="Phone"           value={employee.phone || '—'} />
                <Row label="Timezone"        value={employee.timezone || '—'} />
                <Row label="Shift"           value={shift} />
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ icon, title, sub, children }: { icon: ReactNode; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="portal-section">
      <div className="portal-section-header" style={{ justifyContent: 'flex-start', gap: 12 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <div className="portal-section-title">{title}</div>
          <div className="portal-section-sub">{sub}</div>
        </div>
      </div>
      <div className="portal-section-body">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-row-item">
      <div className="settings-row-label">{label}</div>
      <div className="settings-row-value">{value}</div>
    </div>
  )
}
