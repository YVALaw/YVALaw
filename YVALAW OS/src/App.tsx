import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { IconZap } from './components/Icon'
import Shell from './components/Shell'
import ClientShell from './components/ClientShell'
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
import PortalDashboard from './pages/portal/PortalDashboard'
import PortalBilling from './pages/portal/PortalBilling'
import PortalProjects from './pages/portal/PortalProjects'
import PortalTeam from './pages/portal/PortalTeam'
import PortalDocuments from './pages/portal/PortalDocuments'
import PortalSettings from './pages/portal/PortalSettings'
import RequestsPage from './pages/RequestsPage'
import PortalSetPassword from './pages/portal/PortalSetPassword'
import EmployeeWorkspace from './pages/me/EmployeeWorkspace'
import ConnectAppPage from './pages/ConnectAppPage'
import { afterLoginPath, rememberConnectReturn } from './lib/connectApp'
import { loadSettings, saveSettings, loadInvoices, loadEmployees, linkEmployeeLogin } from './services/storage'
import { RoleProvider, useRole } from './context/RoleContext'
import { ToastProvider } from './context/ToastContext'
import type { UserRole } from './lib/roles'
import { can, isStaff } from './lib/roles'

// ── Shared loading screen ────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <div className="loading-text">Loading YVA LawOS…</div>
    </div>
  )
}

// ── Not logged in: go to /login, remembering a desktop-app connect request ────

function LoginRedirect() {
  const location = useLocation()
  rememberConnectReturn(location.pathname, location.search)
  return <Navigate to="/login" replace />
}

// ── Waiting for access (new account without a staff role yet) ───────────────

function PendingAccess() {
  return (
    <div className="loading-screen">
      <div className="loading-text">Your account is waiting for approval.</div>
      <div className="loading-text">A YVA admin needs to give you access before you can use YVA LawOS.</div>
      <button className="btn-ghost" onClick={() => void supabase.auth.signOut()}>Sign out</button>
    </div>
  )
}

// ── Coming-soon placeholder ──────────────────────────────────────────────────

function ComingSoon({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon-icon"><IconZap size={32} /></div>
      <div className="coming-soon-title">{title}</div>
      <div className="coming-soon-sub">{sub}</div>
      <div className="coming-soon-badge">Coming Soon</div>
    </div>
  )
}

// ── OS role guard ────────────────────────────────────────────────────────────

function RoleGuard({ allow, children }: { allow: (r: UserRole) => boolean; children: ReactNode }) {
  const { role, loading } = useRole()
  if (loading) return null
  if (role === 'client') return <Navigate to="/portal/dashboard" replace />
  if (!allow(role as UserRole)) return <Navigate to="/" replace />
  return <>{children}</>
}

// ── Smart router — decides client portal vs OS based on role ─────────────────

function AuthenticatedRouter() {
  const { role, loading, mustChangePassword } = useRole()
  const location = useLocation()

  if (loading) return <LoadingScreen />

  // ── "Forgot password?" and "Copy new sign-in link" open here, signed in by the link ──
  if (location.pathname === '/reset-password') {
    const home = role === 'employee' ? '/me' : role === 'client' ? '/portal/dashboard' : '/'
    return (
      <Routes>
        <Route path="*" element={<PortalSetPassword title="Choose a new password" subtitle="Pick a new password for your YVA account" next={home} />} />
      </Routes>
    )
  }

  // ── YVA Time desktop sign-in — employees and staff (the code is only issued
  //    to logins linked to an employee record; desktop-link-create checks) ──────
  if (location.pathname === '/connect-app' && !mustChangePassword && (role === 'employee' || isStaff(role))) {
    return <ConnectAppPage />
  }

  // ── Employee workspace — invited employees never see the internal OS ───────
  if (role === 'employee') {
    if (mustChangePassword) {
      return (
        <Routes>
          <Route path="/me/set-password" element={<PortalSetPassword title="Welcome to YVA" next="/me" />} />
          <Route path="*" element={<Navigate to="/me/set-password" replace />} />
        </Routes>
      )
    }
    return (
      <Routes>
        <Route path="/me" element={<EmployeeWorkspace />} />
        <Route path="*"   element={<Navigate to="/me" replace />} />
      </Routes>
    )
  }

  // ── Pending / unknown role — no OS or portal until a CEO assigns a role ────
  if (!isStaff(role) && role !== 'client') return <PendingAccess />

  // ── Preview portal — internal user viewing as a client ─────────────────────
  const previewClientId = new URLSearchParams(location.search).get('preview')
  const canPreviewPortal = role === 'ceo' || role === 'admin' || role === 'accounting'
  if (canPreviewPortal && previewClientId && location.pathname.startsWith('/portal')) {
    return (
      <ClientShell previewClientId={previewClientId}>
        <Routes>
          <Route path="/portal/dashboard" element={<PortalDashboard />} />
          <Route path="/portal/billing"   element={<PortalBilling />} />
          <Route path="/portal/team"      element={<PortalTeam />} />
          <Route path="/portal/projects"  element={<PortalProjects />} />
          <Route path="/portal/documents" element={<PortalDocuments />} />
          <Route path="/portal/messages"  element={<ComingSoon title="Messages"    sub="Live chat and communication center — coming in Phase 7." />} />
          <Route path="/portal/settings"  element={<PortalSettings />} />
          <Route path="*"                 element={<Navigate to={`/portal/dashboard?preview=${previewClientId}`} replace />} />
        </Routes>
      </ClientShell>
    )
  }

  // ── Client portal ──────────────────────────────────────────────────────────
  if (role === 'client') {
    // Force password change before anything else
    if (mustChangePassword) {
      return (
        <Routes>
          <Route path="/portal/set-password" element={<PortalSetPassword />} />
          <Route path="*" element={<Navigate to="/portal/set-password" replace />} />
        </Routes>
      )
    }

    return (
      <ClientShell>
        <Routes>
          <Route path="/portal/dashboard" element={<PortalDashboard />} />
          <Route path="/portal/billing"   element={<PortalBilling />} />
          <Route path="/portal/team"      element={<PortalTeam />} />
          <Route path="/portal/projects"  element={<PortalProjects />} />
          <Route path="/portal/documents" element={<PortalDocuments />} />
          <Route path="/portal/messages"  element={<ComingSoon title="Messages"    sub="Live chat and communication center — coming in Phase 7." />} />
          <Route path="/portal/settings"  element={<PortalSettings />} />
          <Route path="*"                 element={<Navigate to="/portal/dashboard" replace />} />
        </Routes>
      </ClientShell>
    )
  }

  // ── Internal OS ────────────────────────────────────────────────────────────
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<ReportsPage />} />
        <Route path="/invoice"       element={<RoleGuard allow={can.viewInvoices}><InvoicePage /></RoleGuard>} />
        <Route path="/employees"     element={<RoleGuard allow={can.viewEmployees}><EmployeesPage /></RoleGuard>} />
        <Route path="/employees/:id" element={<RoleGuard allow={can.viewEmployees}><EmployeeProfilePage /></RoleGuard>} />
        <Route path="/clients"       element={<RoleGuard allow={can.viewClients}><ClientsPage /></RoleGuard>} />
        <Route path="/clients/:id"   element={<RoleGuard allow={can.viewClients}><ClientProfilePage /></RoleGuard>} />
        <Route path="/projects"      element={<ProjectsPage />} />
        <Route path="/projects/:id"  element={<ProjectProfilePage />} />
        <Route path="/candidates"    element={<RoleGuard allow={r => can.viewAllCandidates(r) || can.viewHiredOnly(r)}><CandidatesPage /></RoleGuard>} />
        <Route path="/candidates/:id" element={<RoleGuard allow={r => can.viewAllCandidates(r) || can.viewHiredOnly(r)}><CandidateProfilePage /></RoleGuard>} />
        <Route path="/expenses"      element={<RoleGuard allow={can.viewExpenses}><GeneralExpensesPage /></RoleGuard>} />
        <Route path="/settings"      element={<SettingsPage />} />
        <Route path="/estimates"     element={<EstimatesPage />} />
        <Route path="/time"          element={<TimeTrackingPage />} />
        <Route path="/calendar"      element={<CalendarPage />} />
        <Route path="/requests"      element={<RequestsPage />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

// ── Employee auto-link ────────────────────────────────────────────────────────

async function autoLinkEmployee(userId: string, userEmail: string) {
  const employees = await loadEmployees()
  const email = userEmail.toLowerCase()
  if (employees.some(e => e.userId === userId)) {
    const linked = employees.find(e => e.userId === userId)
    if (linked) sessionStorage.setItem('linkedEmployeeId', linked.id)
    return
  }
  const match = employees.find(e => e.email?.toLowerCase() === email && !e.userId)
  if (match) {
    await linkEmployeeLogin(match.id, userId)
    sessionStorage.setItem('linkedEmployeeId', match.id)
  } else {
    sessionStorage.removeItem('linkedEmployeeId')
  }
}

// ── Weekly reminder ───────────────────────────────────────────────────────────

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
      icon: `${window.location.origin}${import.meta.env.BASE_URL}yva-logo.png`,
    })
  }
  void saveSettings({ ...settings, reminderLastFired: todayStr })
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) {
        void maybeFireReminder()
        // Only auto-link employee for non-client sessions
        void autoLinkEmployee(data.session.user.id, data.session.user.email || '')
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_OUT') sessionStorage.removeItem('linkedEmployeeId')
      if (event === 'SIGNED_IN' && session) {
        void autoLinkEmployee(session.user.id, session.user.email || '')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return <LoadingScreen />

  return (
    <ToastProvider>
      <Routes>
        {/* ── Public: no auth needed ── */}
        {/* Old read-only invoice share view (renamed from /portal to avoid conflict) */}
        <Route path="/invoice-view" element={<PortalPage />} />
        <Route path="/oauth-callback" element={<OAuthCallbackPage />} />

        {/* ── Auth pages: redirect away if already logged in ── */}
        <Route path="/login"          element={session ? <Navigate to={afterLoginPath()} replace /> : <LoginPage />} />
        <Route path="/xDdasQwd24zaQ"  element={session ? <Navigate to="/"   replace /> : <SignupPage />} />

        {/* ── Protected: all authenticated routes ── */}
        <Route path="/*" element={
          !session
            ? <LoginRedirect />
            : (
              <RoleProvider>
                <AuthenticatedRouter />
              </RoleProvider>
            )
        } />
      </Routes>
    </ToastProvider>
  )
}
