import { useEffect, useRef, useState } from 'react'
import type { AppSettings, DataSnapshot } from '../data/types'
import {
  loadCandidates, loadSettings, saveSettings,
  loadSnapshot, loadExpenses, loadGeneralExpenses,
  saveEmployees, saveClients, saveProjects, saveInvoices,
  saveCandidates, saveInvoiceCounter,
  loadInvoices, loadUserRoles, upsertUserRole, type UserRoleRow,
} from '../services/storage'
import { supabase } from '../lib/supabase'
import { initiateGmailAuth, disconnectGmail, isGmailConnected, sendEmail } from '../services/gmail'
import { useRole } from '../context/RoleContext'
import { can, ROLE_LABELS, ROLE_OPTIONS } from '../lib/roles'

type InfoDolarBhdResponse = {
  provider: string
  entity: string
  buy: number
  sell: number
  timestamp?: string
  sourceUrl: string
}

function normalizeImportedEmployee(row: Record<string, unknown>): Record<string, unknown> {
  const next = { ...row }
  if (next.startYear == null) {
    const legacyYear = next.hireYear ?? next.hire_year
    if (legacyYear != null && legacyYear !== '') {
      next.startYear = legacyYear
    }
  }
  delete next.hireYear
  delete next.hire_year
  return next
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function remapId(value: unknown, map: Map<string, string>): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return map.get(value) || (isUuidLike(value) ? value : null)
}

function createIdMap(items: unknown[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of items) {
    const oldId = (item as { id?: unknown } | undefined)?.id
    if (typeof oldId === 'string' && oldId.trim()) {
      map.set(oldId, crypto.randomUUID())
    }
  }
  return map
}

function pickFields(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]))
}

function normalizeImportedEmployees(items: unknown[], idMap: Map<string, string>): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'userId', 'employeeNumber', 'email', 'phone', 'payRate',
    'defaultShiftStart', 'defaultShiftEnd', 'premiumEnabled', 'premiumStartTime', 'premiumPercent',
    'role', 'employmentType', 'location', 'timezone', 'startYear', 'status', 'notes',
    'photoUrl', 'attachments',
  ]
  return items.map(item => {
    const row = normalizeImportedEmployee(item as Record<string, unknown>)
    const oldId = (item as { id?: unknown } | undefined)?.id
    const id = typeof oldId === 'string' && oldId.trim()
      ? (idMap.get(oldId) || crypto.randomUUID())
      : crypto.randomUUID()
    return { ...pickFields(row, allowed), id }
  })
}

function normalizeImportedClients(items: unknown[], idMap: Map<string, string>): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'company', 'email', 'phone', 'address', 'timezone', 'defaultRate',
    'paymentTerms', 'tags', 'notes', 'status', 'contractEnd', 'photoUrl', 'links', 'contracts',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const id = oldId ? (idMap.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    return { ...pickFields(row, allowed), id }
  })
}

function normalizeImportedProjects(
  items: unknown[],
  maps: { projectIds: Map<string, string>; clientIds: Map<string, string>; employeeIds: Map<string, string> },
): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'rate', 'budget', 'clientId', 'employeeIds', 'nextInvoiceSeq', 'status',
    'billingModel', 'startDate', 'endDate', 'description', 'projectNeeds', 'notes', 'tags',
    'links', 'contracts',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const employeeIds = Array.isArray(row.employeeIds)
      ? row.employeeIds.map(empId => remapId(empId, maps.employeeIds)).filter((v): v is string => !!v)
      : []
    const clientId = remapId(row.clientId, maps.clientIds)
    const id = oldId ? (maps.projectIds.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    return { ...pickFields(row, allowed), id, clientId, employeeIds }
  })
}

function normalizeImportedInvoices(
  items: unknown[],
  maps: { invoiceIds: Map<string, string>; projectIds: Map<string, string>; employeeIds: Map<string, string> },
): Record<string, unknown>[] {
  const allowed = [
    'id', 'number', 'date', 'dueDate', 'clientName', 'clientEmail', 'clientAddress',
    'billingStart', 'billingEnd', 'projectId', 'projectName', 'status', 'subtotal', 'amountPaid',
    'notes', 'items', 'statusHistory', 'employeePayments', 'tags', 'createdAt', 'updatedAt',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const id = oldId ? (maps.invoiceIds.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    const projectId = remapId(row.projectId, maps.projectIds)
    const items = Array.isArray(row.items)
      ? row.items.map(rawItem => {
          const it = rawItem as Record<string, unknown>
          const employeeId = remapId(it.employeeId, maps.employeeIds)
          return employeeId ? { ...it, employeeId } : (() => { const copy = { ...it }; delete copy.employeeId; return copy })()
        })
      : row.items
    const employeePayments = row.employeePayments && typeof row.employeePayments === 'object'
      ? Object.fromEntries(Object.entries(row.employeePayments as Record<string, unknown>).map(([key, value]) => {
          const mappedKey = maps.employeeIds.get(key)
          return [mappedKey || key, value]
        }))
      : row.employeePayments
    return { ...pickFields(row, allowed), id, projectId, items, employeePayments }
  })
}

function normalizeImportedCandidates(items: unknown[], idMap: Map<string, string>): Record<string, unknown>[] {
  const allowed = [
    'id', 'name', 'email', 'phone', 'role', 'source', 'stage', 'notes', 'resumeUrl',
    'linkedinUrl', 'appliedAt', 'updatedAt', 'attachments',
  ]
  return items.map(item => {
    const row = item as Record<string, unknown>
    const oldId = typeof row.id === 'string' ? row.id : ''
    const id = oldId ? (idMap.get(oldId) || crypto.randomUUID()) : crypto.randomUUID()
    return { ...pickFields(row, allowed), id }
  })
}

type SettingsTab = 'company' | 'email' | 'integrations' | 'currency' | 'notifications' | 'data' | 'access'

const ALL_TABS: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
  { id: 'company',       label: 'Company' },
  { id: 'email',         label: 'Email' },
  { id: 'integrations',  label: 'Integrations' },
  { id: 'currency',      label: 'Currency' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'data',          label: 'Data' },
  { id: 'access',        label: 'Team Access', adminOnly: true },
]

export default function SettingsPage() {
  const { role: currentRole, loading: roleLoading } = useRole()
  const TABS = roleLoading ? ALL_TABS.filter(t => !t.adminOnly) : ALL_TABS.filter(t => !t.adminOnly || can.manageRoles(currentRole))
  const fileRef = useRef<HTMLInputElement>(null)
  const [settings, setSettingsState] = useState<AppSettings>({
    usdToDop: 0, companyName: 'YVA Staffing', companyEmail: '', emailSignature: '',
  })
  const [stats, setStats] = useState([
    { label: 'Employees',  count: 0 },
    { label: 'Clients',    count: 0 },
    { label: 'Projects',   count: 0 },
    { label: 'Invoices',   count: 0 },
    { label: 'Candidates', count: 0 },
    { label: 'Expenses',   count: 0 },
  ])
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [fetchingRate, setFetchingRate] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('company')
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState<string | undefined>()
  const [userRoles, setUserRoles] = useState<UserRoleRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [rateSourceMeta, setRateSourceMeta] = useState<InfoDolarBhdResponse | null>(null)

  useEffect(() => {
    void loadSettings().then(setSettingsState)
    void isGmailConnected().then(setGmailConnected)
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setGmailEmail(user?.user_metadata?.gmailEmail as string | undefined)
    })
  }, [])

  useEffect(() => {
    if (activeTab === 'access' && can.manageRoles(currentRole)) {
      void loadUserRoles().then(setUserRoles)
    }
  }, [activeTab, currentRole])

  useEffect(() => {
    if (activeTab !== 'data') return
    void (async () => {
      const [snap, candidates, expenses, generalExpenses] = await Promise.all([
        loadSnapshot(), loadCandidates(), loadExpenses(), loadGeneralExpenses(),
      ])
      setStats([
        { label: 'Employees',  count: snap.employees.length },
        { label: 'Clients',    count: snap.clients.length },
        { label: 'Projects',   count: snap.projects.length },
        { label: 'Invoices',   count: snap.invoices.length },
        { label: 'Candidates', count: candidates.length },
        { label: 'Expenses',   count: expenses.length + generalExpenses.length },
      ])
    })()
  }, [activeTab])

  function updateSettings(partial: Partial<AppSettings>) {
    const next = { ...settings, ...partial }
    setSettingsState(next)
    void saveSettings(next)
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviteSending(true)
    setInviteMsg(null)
    const signupUrl = `${window.location.origin}/os/xDdasQwd24zaQ`
    const subject = `You've been invited to YVA LawOS`
    const body = `Hi,\n\nYou've been invited to join YVA LawOS — the internal operations platform.\n\nClick the link below to create your account:\n${signupUrl}\n\nOnce you sign up, your account will be active and an admin can assign your role.\n\nWelcome to the team!\n\n— YVA Staffing`
    try {
      await sendEmail(inviteEmail.trim(), subject, body)
      setInviteMsg({ type: 'ok', text: `Invite sent to ${inviteEmail.trim()}` })
      setInviteEmail('')
    } catch {
      setInviteMsg({ type: 'err', text: 'Failed to send invite. Make sure Gmail is connected.' })
    }
    setInviteSending(false)
  }

  async function handleFetchRate() {
    setFetchingRate(true)
    setFetchMsg(null)
    let payload: InfoDolarBhdResponse | null = null
    try {
      const res = await fetch('/.netlify/functions/infodolar-bhd')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFetchingRate(false)
        setFetchMsg(data?.error || 'Could not auto-fetch from InfoDolar BHD.')
        return
      }
      payload = data as InfoDolarBhdResponse
    } catch {
      setFetchingRate(false)
      setFetchMsg('Could not auto-fetch from InfoDolar BHD. Try again or enter the rate manually.')
      return
    }
    setFetchingRate(false)
    if (payload?.sell) {
      updateSettings({ usdToDop: payload.sell })
      setRateSourceMeta(payload)
      setFetchMsg(`Rate updated from ${payload.entity} via ${payload.provider}: RD$${payload.sell} / $1 USD`)
    } else {
      setFetchMsg('Could not auto-fetch from InfoDolar BHD. Try again or enter the rate manually.')
    }
  }

  async function requestNotifications() {
    if (typeof Notification === 'undefined') return
    const perm = await Notification.requestPermission()
    setNotifPerm(perm)
    if (perm === 'granted') {
      checkAndNotify()
    }
  }

  function checkAndNotify() {
    void loadInvoices().then(invoices => {
      const overdue = invoices.filter(i => (i.status || '').toLowerCase() === 'overdue')
      const drafts  = invoices.filter(i => (i.status || '').toLowerCase() === 'draft')
      if (overdue.length > 0) {
        new Notification('YVA OS — Overdue Invoices', {
          body: `${overdue.length} invoice${overdue.length > 1 ? 's are' : ' is'} overdue. Open the Invoices pipeline to review.`,
          icon: '/yva-logo.png',
        })
      }
      if (drafts.length > 0) {
        new Notification('YVA OS — Draft Invoices', {
          body: `${drafts.length} draft invoice${drafts.length > 1 ? 's are' : ' is'} ready to send to clients.`,
          icon: '/yva-logo.png',
        })
      }
      if (overdue.length === 0 && drafts.length === 0) {
        new Notification('YVA OS', { body: 'All clear — no pending actions.', icon: '/yva-logo.png' })
      }
    })
  }

  function handleImport(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as Partial<DataSnapshot & { candidates: unknown[]; invoiceCounter: number }>
        void (async () => {
          try {
            let count = 0
            const employeeIdMap = Array.isArray(data.employees) ? createIdMap(data.employees) : new Map<string, string>()
            const clientIdMap = Array.isArray(data.clients) ? createIdMap(data.clients) : new Map<string, string>()
            const projectIdMap = Array.isArray(data.projects) ? createIdMap(data.projects) : new Map<string, string>()
            const invoiceIdMap = Array.isArray(data.invoices) ? createIdMap(data.invoices) : new Map<string, string>()
            const candidateIdMap = Array.isArray(data.candidates) ? createIdMap(data.candidates) : new Map<string, string>()

            if (Array.isArray(data.employees)) { await saveEmployees(normalizeImportedEmployees(data.employees, employeeIdMap) as Parameters<typeof saveEmployees>[0]); count++ }
            if (Array.isArray(data.projects))  { await saveProjects(normalizeImportedProjects(data.projects, { projectIds: projectIdMap, clientIds: clientIdMap, employeeIds: employeeIdMap }) as Parameters<typeof saveProjects>[0]);   count++ }
            if (Array.isArray(data.clients))   { await saveClients(normalizeImportedClients(data.clients, clientIdMap) as Parameters<typeof saveClients>[0]);     count++ }
            if (Array.isArray(data.invoices))  { await saveInvoices(normalizeImportedInvoices(data.invoices, { invoiceIds: invoiceIdMap, projectIds: projectIdMap, employeeIds: employeeIdMap }) as Parameters<typeof saveInvoices>[0]);   count++ }
            if (typeof data.invoiceCounter === 'number') { await saveInvoiceCounter(data.invoiceCounter); count++ }
            if (Array.isArray(data.candidates)) { await saveCandidates(normalizeImportedCandidates(data.candidates, candidateIdMap) as Parameters<typeof saveCandidates>[0]); count++ }
            if (count === 0) throw new Error('No supported data sets found in this file.')
            setImportStatus(`Imported ${count} data set${count !== 1 ? 's' : ''} successfully. Reloading…`)
            setTimeout(() => window.location.reload(), 900)
          } catch (error) {
            setImportStatus(`Import failed — ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        })()
      } catch { setImportStatus('Import failed — invalid JSON file.') }
    }
    reader.readAsText(file)
  }

  function exportData() {
    void (async () => {
      const [snap, candidates, invoiceCounter] = await Promise.all([
        loadSnapshot(), loadCandidates(),
        supabase.from('counters').select('value').eq('key', 'invoice').single().then(r => (r.data?.value as number) ?? 1),
      ])
      const data = {
        employees: snap.employees,
        clients: snap.clients,
        projects: snap.projects,
        invoices: snap.invoices,
        candidates,
        invoiceCounter,
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `yva-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click(); URL.revokeObjectURL(url)
    })()
  }

  function doClear() {
    void (async () => {
      // Server-side verification: only CEO may wipe data
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: roleRow } = await supabase.from('user_roles').select('role').eq('user_id', user.id).single()
      if (roleRow?.role !== 'ceo') return

      const tables = ['employees', 'clients', 'projects', 'invoices', 'tasks', 'expenses', 'activity_log', 'candidates', 'invoice_templates']
      await Promise.all(tables.map(t => supabase.from(t).delete().neq('id', '')))
      await supabase.from('counters').update({ value: 1 }).eq('key', 'invoice')
      await supabase.from('counters').update({ value: 1 }).eq('key', 'employee')
      setConfirmClear(false); setCleared(true)
      setTimeout(() => setCleared(false), 4000)
    })()
  }

  return (
    <div className="page-wrap" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">App preferences, integrations &amp; data management</p>
        </div>
        <div className="page-header-right">
          <button
            className="btn-ghost btn-sm"
            style={{ color: '#f87171' }}
            onClick={() => void supabase.auth.signOut()}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="settings-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`settings-tab${activeTab === t.id ? ' settings-tab-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Company ── */}
      {activeTab === 'company' && (
        <div className="settings-section">
          <div className="settings-section-title">Company Info</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Name</div>
              <div className="settings-row-sub">Shown on invoice PDF exports</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              value={settings.companyName || ''}
              onChange={(e) => updateSettings({ companyName: e.target.value })}
              placeholder="YVA Staffing"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Email</div>
              <div className="settings-row-sub">Pre-filled in email drafts &amp; invoices</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              type="email"
              value={settings.companyEmail || ''}
              onChange={(e) => updateSettings({ companyEmail: e.target.value })}
              placeholder="Contact@yvastaffing.net"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Address</div>
              <div className="settings-row-sub">Shown on invoice PDFs</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              value={settings.companyAddress || ''}
              onChange={(e) => updateSettings({ companyAddress: e.target.value })}
              placeholder="Santo Domingo, Dominican Republic"
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Company Phone</div>
              <div className="settings-row-sub">Shown on invoice PDFs</div>
            </div>
            <input
              className="form-input" style={{ width: 220 }}
              value={settings.companyPhone || ''}
              onChange={(e) => updateSettings({ companyPhone: e.target.value })}
              placeholder="+1 (717) 281-8676"
            />
          </div>
          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Email Signature</div>
              <div className="settings-row-sub">Appended to all email invoice drafts</div>
            </div>
            <textarea
              className="form-textarea" rows={3}
              value={settings.emailSignature || ''}
              onChange={(e) => updateSettings({ emailSignature: e.target.value })}
              placeholder="Best regards,&#10;YVA Staffing Team&#10;yvastaffing.net"
            />
          </div>
          <div className="settings-row" style={{ marginTop: 8 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Monthly Revenue Goal</div>
              <div className="settings-row-sub">Shown as a progress bar on the Dashboard</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>$</span>
              <input
                className="form-input" style={{ width: 120 }}
                type="number" min="0" step="100"
                value={settings.monthlyGoal || ''}
                onChange={(e) => updateSettings({ monthlyGoal: parseFloat(e.target.value) || undefined })}
                placeholder="10000"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Email Templates ── */}
      {activeTab === 'email' && (
        <div className="settings-section">
          <div className="settings-section-title">Email Templates</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.7 }}>
            Use{' '}
            {['{clientName}', '{invoiceNumber}', '{amount}', '{period}', '{dueDate}', '{companyName}', '{employeeName}'].map(p => (
              <code key={p} style={{ background: 'rgba(255,255,255,.07)', padding: '1px 6px', borderRadius: 4, marginRight: 4 }}>{p}</code>
            ))}
            {' '}as placeholders.
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Invoice Email</div>
              <div className="settings-row-sub">Sent when emailing an invoice to a client</div>
            </div>
            <textarea
              className="form-textarea" rows={6}
              value={settings.invoiceEmailTemplate || ''}
              onChange={(e) => updateSettings({ invoiceEmailTemplate: e.target.value })}
              placeholder={`Hi {clientName},\n\nPlease find attached invoice {invoiceNumber} for {amount}.\n\nBilling period: {period}\n{dueDate}\nPlease don't hesitate to reach out with any questions.\n\n{companyName}`}
            />
            {settings.invoiceEmailTemplate && (
              <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => updateSettings({ invoiceEmailTemplate: undefined })}>
                Reset to default
              </button>
            )}
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 20 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Employee Statement Email</div>
              <div className="settings-row-sub">Sent from the Statements panel in Team page</div>
            </div>
            <textarea
              className="form-textarea" rows={6}
              value={settings.statementEmailTemplate || ''}
              onChange={(e) => updateSettings({ statementEmailTemplate: e.target.value })}
              placeholder={`Hi {employeeName},\n\nHere is your earnings summary for the period {period}.\n\nTotal Hours: ...\nTotal Earned: ...\n\nPlease reach out if you have any questions.\n\n{companyName}`}
            />
            {settings.statementEmailTemplate && (
              <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => updateSettings({ statementEmailTemplate: undefined })}>
                Reset to default
              </button>
            )}
          </div>

          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 20 }}>
            <div className="settings-row-info">
              <div className="settings-row-label">Payment Reminder Email</div>
              <div className="settings-row-sub">Sent via Remind button on overdue/unpaid invoices</div>
            </div>
            <textarea
              className="form-textarea" rows={6}
              value={settings.reminderEmailTemplate || ''}
              onChange={(e) => updateSettings({ reminderEmailTemplate: e.target.value })}
              placeholder={`Hi {clientName},\n\nThis is a friendly reminder that invoice {invoiceNumber} for {amount} is past due.\n\nOriginal due date: {dueDate}\n\nPlease let us know when we can expect payment or if you have any questions.\n\n{companyName}`}
            />
            {settings.reminderEmailTemplate && (
              <button className="btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => updateSettings({ reminderEmailTemplate: undefined })}>
                Reset to default
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Integrations ── */}
      {activeTab === 'integrations' && (
        <div className="settings-section">
          <div className="settings-section-title">Gmail</div>

          {gmailConnected ? (
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Connected Account</div>
                <div className="settings-row-sub" style={{ color: '#22c55e' }}>
                  ✓ Emails sent via Gmail as <strong>{gmailEmail}</strong>
                </div>
              </div>
              <button className="btn-ghost btn-sm" style={{ color: '#f87171' }}
                onClick={() => void disconnectGmail().then(() => { setGmailConnected(false); setGmailEmail(undefined) })}>
                Disconnect
              </button>
            </div>
          ) : (
            <>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Google OAuth Client ID</div>
                  <div className="settings-row-sub">
                    From Google Cloud Console → APIs &amp; Services → Credentials → OAuth 2.0 Client ID (Web application).<br />
                    Authorized Redirect URI:{' '}
                    <code style={{ background: 'rgba(255,255,255,.07)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>{window.location.origin}/oauth-callback</code>
                  </div>
                </div>
                <input
                  className="form-input"
                  style={{ width: 320, fontSize: 12 }}
                  placeholder="123456789-abc123.apps.googleusercontent.com"
                  value={settings.gmailClientId || ''}
                  onChange={e => updateSettings({ gmailClientId: e.target.value })}
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Connect Gmail</div>
                  <div className="settings-row-sub">
                    All emails (invoices, statements, reminders) will be sent directly via your Gmail.
                  </div>
                </div>
                <button
                  className="btn-primary btn-sm"
                  disabled={!settings.gmailClientId?.trim()}
                  onClick={() => initiateGmailAuth(settings.gmailClientId!)}
                >
                  Connect Gmail →
                </button>
              </div>
              <div style={{ background: 'rgba(245,181,51,.05)', borderRadius: 8, padding: '12px 16px', marginTop: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                <strong style={{ color: 'var(--gold)' }}>Setup guide:</strong>{' '}
                Go to <strong>console.cloud.google.com</strong> → New Project → Enable <strong>Gmail API</strong> →
                Create <strong>OAuth 2.0 Client ID</strong> (Web application) → add the redirect URI above →
                paste the Client ID here → add the Google client secret to Netlify as <code style={{ background: 'rgba(255,255,255,.07)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>GMAIL_CLIENT_SECRET</code> → click Connect.
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Currency ── */}
      {activeTab === 'currency' && (
        <div className="settings-section">
          <div className="settings-section-title">Currency — USD / DOP</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Exchange Rate (USD → DOP)</div>
              <div className="settings-row-sub">
                Auto-fetched from InfoDolar using Banco BHD sell rate. Click Auto-fetch or enter manually.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="form-input" style={{ width: 100 }}
                type="number" step="0.01"
                value={settings.usdToDop || ''}
                onChange={(e) => updateSettings({ usdToDop: parseFloat(e.target.value) || 0 })}
                placeholder="59.50"
              />
              <button className="btn-ghost btn-sm" onClick={handleFetchRate} disabled={fetchingRate}>
                {fetchingRate ? 'Fetching…' : 'Auto-fetch'}
              </button>
            </div>
          </div>
          {fetchMsg && (
            <div className={`settings-notice ${fetchMsg.startsWith('Could') ? 'settings-notice-error' : 'settings-notice-success'}`}>
              {fetchMsg}
            </div>
          )}
          {rateSourceMeta && (
            <div className="settings-notice">
              Source: <strong>{rateSourceMeta.entity}</strong> via {rateSourceMeta.provider}
              {typeof rateSourceMeta.buy === 'number' ? ` · Buy RD$${rateSourceMeta.buy}` : ''}
              {typeof rateSourceMeta.sell === 'number' ? ` · Sell RD$${rateSourceMeta.sell}` : ''}
              {rateSourceMeta.timestamp ? ` · ${rateSourceMeta.timestamp}` : ''}
              {' · '}
              <a href={rateSourceMeta.sourceUrl} target="_blank" rel="noreferrer">Open source</a>
            </div>
          )}
          {settings.usdToDop > 0 && (
            <div className="settings-notice settings-notice-success">
              Active rate: $1 USD = RD${settings.usdToDop} · DOP amounts shown on invoice cards
            </div>
          )}
        </div>
      )}

      {/* ── Notifications ── */}
      {activeTab === 'notifications' && (
        <div className="settings-section">
          <div className="settings-section-title">Browser Notifications</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Notifications</div>
              <div className="settings-row-sub">
                {notifPerm === 'granted'
                  ? 'Enabled. Click to send a test check for overdue &amp; draft invoices.'
                  : notifPerm === 'denied'
                  ? 'Blocked by browser — enable in browser site settings.'
                  : 'Allow YVA OS to send reminders for overdue &amp; draft invoices.'}
              </div>
            </div>
            {notifPerm === 'granted' ? (
              <button className="btn-ghost btn-sm" onClick={checkAndNotify}>Check Now</button>
            ) : (
              <button className="btn-primary btn-sm" onClick={requestNotifications} disabled={notifPerm === 'denied'}>
                Enable
              </button>
            )}
          </div>

          {notifPerm === 'granted' && (
            <div className="settings-row" style={{ marginTop: 12 }}>
              <div className="settings-row-info">
                <div className="settings-row-label">Weekly Invoice Reminder</div>
                <div className="settings-row-sub">
                  Automatically checks for unpaid invoices on the selected day when the app is opened.
                </div>
              </div>
              <select
                className="form-select"
                style={{ width: 140 }}
                value={settings.reminderDay ?? ''}
                onChange={e => {
                  const val = e.target.value === '' ? undefined : Number(e.target.value)
                  updateSettings({ reminderDay: val })
                }}
              >
                <option value="">Off</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
                <option value="0">Sunday</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── Data ── */}
      {activeTab === 'data' && (
        <>
          <div className="settings-section">
            <div className="settings-section-title">Data Overview</div>
            <div className="settings-stats-grid">
              {stats.map((s) => (
                <div key={s.label} className="settings-stat-card">
                  <div className="settings-stat-count">{s.count}</div>
                  <div className="settings-stat-label">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Backup &amp; Restore</div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Export all data</div>
                <div className="settings-row-sub">Download a full JSON backup you can re-import at any time.</div>
              </div>
              <button className="btn-primary btn-sm" onClick={exportData}>Export JSON</button>
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Restore from backup</div>
                <div className="settings-row-sub">Import a previously exported file. Existing data will be overwritten.</div>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>Choose File</button>
              <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = '' }} />
            </div>
            {importStatus && (
              <div className={`settings-notice ${importStatus.startsWith('Import failed') ? 'settings-notice-error' : 'settings-notice-success'}`}>
                {importStatus}
              </div>
            )}
          </div>

          <div className="settings-section settings-section-danger">
            <div className="settings-section-title">Danger Zone</div>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Clear all data</div>
                <div className="settings-row-sub">Permanently deletes everything from this browser. Export first.</div>
              </div>
              <button className="btn-danger btn-sm" onClick={() => setConfirmClear(true)}>Clear All</button>
            </div>
            {cleared && <div className="settings-notice settings-notice-success">All data cleared. Reload the page.</div>}
          </div>
        </>
      )}

      {/* ── Team Access ── */}
      {activeTab === 'access' && can.manageRoles(currentRole) && (
        <div className="settings-section">
          <div className="settings-section-title">Invite Team Member</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            Send a private signup link via your connected email. The recipient can register and will appear in the table below.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input
              className="form-input"
              type="email"
              placeholder="colleague@email.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void sendInvite()}
              style={{ flex: 1, maxWidth: 320 }}
            />
            <button className="btn-primary" onClick={() => void sendInvite()} disabled={inviteSending || !inviteEmail.trim()}>
              {inviteSending ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
          {inviteMsg && (
            <div style={{ fontSize: 12, color: inviteMsg.type === 'ok' ? 'var(--green)' : 'var(--red)', marginBottom: 12 }}>
              {inviteMsg.text}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 24, background: 'var(--surf2)', padding: '8px 12px', borderRadius: 8 }}>
            Signup link: <span style={{ fontFamily: 'monospace', userSelect: 'all' }}>{window.location.origin}/os/xDdasQwd24zaQ</span>
          </div>
        </div>
      )}

      {activeTab === 'access' && can.manageRoles(currentRole) && (
        <div className="settings-section">
          <div className="settings-section-title">Team Access</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
            Manage what each user can see. New users default to Recruiter until assigned a role.
          </div>
          {userRoles.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '16px 0' }}>No users found. Users appear here after they first log in.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {userRoles.map(u => (
                    <tr key={u.user_id}>
                      <td className="td-name">{u.email || '—'}</td>
                      <td>
                        <select
                          className="form-select"
                          style={{ width: 160, fontSize: 12 }}
                          value={u.role}
                          onChange={async e => {
                            const newRole = e.target.value
                            await upsertUserRole(u.user_id, u.email, newRole)
                            setUserRoles(prev => prev.map(r => r.user_id === u.user_id ? { ...r, role: newRole } : r))
                          }}
                        >
                          {ROLE_OPTIONS.map(r => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className="badge badge-blue" style={{ fontSize: 10 }}>{ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] || u.role}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmClear && (
        <div className="modal-overlay" onClick={() => setConfirmClear(false)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Clear all data?</div>
            <div className="confirm-body">This will permanently delete all employees, clients, projects, invoices, and candidates from the database. This cannot be undone. Export a backup first.</div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="btn-danger" onClick={doClear}>Yes, clear everything</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
