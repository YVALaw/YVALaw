import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Shell from './components/Shell'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import PortalPage from './pages/PortalPage'
import OAuthCallbackPage from './pages/OAuthCallbackPage'
import ReportsPage from './pages/ReportsPage'
import InvoicePage from './pages/InvoicePage'
import EmployeesPage from './pages/EmployeesPage'
import EmployeeProfilePage from './pages/EmployeeProfilePage'
import ClientsPage from './pages/ClientsPage'
import ClientProfilePage from './pages/ClientProfilePage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectProfilePage from './pages/ProjectProfilePage'
import SettingsPage from './pages/SettingsPage'
import CandidatesPage from './pages/CandidatesPage'
import CandidateProfilePage from './pages/CandidateProfilePage'
import GeneralExpensesPage from './pages/GeneralExpensesPage'
import EstimatesPage from './pages/EstimatesPage'
import TimeTrackingPage from './pages/TimeTrackingPage'
import CalendarPage from './pages/CalendarPage'
import { loadSettings, saveSettings, loadInvoices, loadEmployees, saveEmployees } from './services/storage'
import { RoleProvider, useRole } from './context/RoleContext'
import type { UserRole } from './lib/roles'
import { can } from './lib/roles'

function ComingSoon({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 40 }}>🚧</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 360 }}>{sub}</div>
      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, background: 'rgba(250,204,21,.15)', color: '#a16207', padding: '4px 14px', borderRadius: 999, border: '1px solid rgba(250,204,21,.3)' }}>Coming Soon</div>
    </div>
  )
}

function RoleGuard({ allow, children }: { allow: (r: UserRole) => boolean; children: ReactNode }) {
  const { role, loading } = useRole()
  if (loading) return null
  if (!allow(role)) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Link a Supabase auth user to their Employee record by email match */
async function autoLinkEmployee(userId: string, userEmail: string) {
  const employees = await loadEmployees()
  const email = userEmail.toLowerCase()

  // Already linked
  if (employees.some(e => e.userId === userId)) {
    const linked = employees.find(e => e.userId === userId)
    if (linked) sessionStorage.setItem('linkedEmployeeId', linked.id)
    return
  }

  // Match by email
  const match = employees.find(e => e.email?.toLowerCase() === email)
  if (match) {
    await saveEmployees(employees.map(e => e.id === match.id ? { ...e, userId } : e))
    sessionStorage.setItem('linkedEmployeeId', match.id)
  } else {
    sessionStorage.removeItem('linkedEmployeeId')
  }
}

async function maybeFireReminder() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const settings = await loadSettings()
  if (settings.reminderDay == null) return
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  if (settings.reminderLastFired === todayStr) return
  if (today.getDay() !== settings.reminderDay) return
  const invoices = await loadInvoices()
  const unpaid = invoices.filter(inv => {
    const s = (inv.status || '').toLowerCase()
    return s === 'sent' || s === 'viewed' || s === 'overdue' || s === 'partial'
  })
  if (unpaid.length > 0) {
    new Notification('YVA LawOS — Invoice Reminder', {
      body: `${unpaid.length} unpaid invoice${unpaid.length > 1 ? 's' : ''} waiting. Check the Invoices pipeline.`,
      icon: '/yva-logo.png',
    })
  }
  void saveSettings({ ...settings, reminderLastFired: todayStr })
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        void maybeFireReminder()
        void autoLinkEmployee(data.session.user.id, data.session.user.email || '')
      }
    })
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_OUT') sessionStorage.removeItem('linkedEmployeeId')
      if (event === 'SIGNED_IN' && session) {
        void autoLinkEmployee(session.user.id, session.user.email || '')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Still loading auth state
  if (session === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  return (
    <Routes>
      {/* Public routes — no auth needed */}
      <Route path="/portal" element={<PortalPage />} />
      <Route path="/oauth-callback" element={<OAuthCallbackPage />} />
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/xDdasQwd24zaQ" element={session ? <Navigate to="/" replace /> : <SignupPage />} />

      {/* Protected routes */}
      <Route path="/*" element={
        !session ? <Navigate to="/login" replace /> : (
          <RoleProvider>
            <Shell>
              <Routes>
                <Route path="/" element={<ReportsPage />} />
                <Route path="/invoice" element={<RoleGuard allow={can.viewInvoices}><InvoicePage /></RoleGuard>} />
                <Route path="/employees" element={<RoleGuard allow={can.viewEmployees}><EmployeesPage /></RoleGuard>} />
                <Route path="/employees/:id" element={<RoleGuard allow={can.viewEmployees}><EmployeeProfilePage /></RoleGuard>} />
                <Route path="/clients" element={<RoleGuard allow={can.viewClients}><ClientsPage /></RoleGuard>} />
                <Route path="/clients/:id" element={<RoleGuard allow={can.viewClients}><ClientProfilePage /></RoleGuard>} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectProfilePage />} />
                <Route path="/candidates" element={<RoleGuard allow={r => can.viewAllCandidates(r) || can.viewHiredOnly(r)}><CandidatesPage /></RoleGuard>} />
                <Route path="/candidates/:id" element={<RoleGuard allow={r => can.viewAllCandidates(r) || can.viewHiredOnly(r)}><CandidateProfilePage /></RoleGuard>} />
                <Route path="/expenses" element={<RoleGuard allow={can.viewExpenses}><GeneralExpensesPage /></RoleGuard>} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* New pages — coming soon placeholders */}
                <Route path="/estimates" element={<EstimatesPage />} />
                <Route path="/time" element={<TimeTrackingPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          </RoleProvider>
        )
      } />
    </Routes>
  )
}
