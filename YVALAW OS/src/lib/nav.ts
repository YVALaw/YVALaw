// Information architecture of the redesigned OS (design_handoff_yva_os_redesign → "App shell").
// One place for: hubs and their pages, who can see each page (the old Shell isVisible rules),
// the Create menu, and route → hub/page lookup for the breadcrumb, sibling chips and phone title.
import { P } from '../components/Icon'
import { can, type AppRole } from './roles'
import type { Permission } from './permissions'

export type HubKey = 'crm' | 'finance' | 'ops' | 'people'
export type NavPage = { key: string; label: string; to: string; icon: string; desc: string; hub: HubKey | null }
export type Hub = { key: HubKey; label: string; short: string; icon: string; pages: NavPage[] }
type Allowed = (p: Permission) => boolean

const pg = (hub: HubKey | null, key: string, label: string, to: string, icon: string, desc: string): NavPage => ({ key, label, to, icon, desc, hub })

export const HUBS: Hub[] = [
  { key: 'crm', label: 'CRM', short: 'CRM', icon: P.clients, pages: [
    pg('crm', 'leads', 'Leads', '/leads', P.leads, 'Pipeline, follow-ups, CSV import'),
    pg('crm', 'clients', 'Clients', '/clients', P.clients, 'Accounts, contacts, documents, portal access'),
    pg('crm', 'estimates', 'Estimates', '/estimates', P.estimates, 'Quotes before a deal is signed'),
    pg('crm', 'requests', 'Staff requests', '/requests', P.requests, 'Requests sent from the client portal'),
  ] },
  { key: 'finance', label: 'Finance', short: 'Finance', icon: P.invoices, pages: [
    pg('finance', 'weekly-close', 'Weekly close', '/weekly-close', P.week, 'Tracked hours become one draft invoice per client every Monday'),
    pg('finance', 'invoices', 'Invoices', '/invoice', P.invoices, 'Build, send, track and record payments'),
    pg('finance', 'payroll', 'Payroll', '/payroll', P.payroll, 'Friday pay in DOP, payslips, bonuses and deductions'),
    pg('finance', 'expenses', 'Expenses', '/expenses', P.expenses, 'General business expenses'),
    pg('finance', 'reports', 'Reports', '/reports', P.reports, 'Revenue by client and project, AR aging, forecast, invoice history'),
  ] },
  { key: 'ops', label: 'Operations', short: 'Ops', icon: P.projects, pages: [
    pg('ops', 'projects', 'Projects', '/projects', P.projects, 'Placements, bill and pay rates, supervisors'),
    pg('ops', 'time', 'Time tracking', '/time', P.time, 'Live, approve, schedule, screenshots, time log'),
    pg('ops', 'calendar', 'Calendar', '/calendar', P.calendar, 'Shifts, holidays and time off'),
  ] },
  { key: 'people', label: 'People', short: 'People', icon: P.team, pages: [
    pg('people', 'team', 'Team', '/employees', P.team, 'Employees, profiles, documents, YVA Time logins'),
    pg('people', 'approvals', 'Approvals', '/approvals', P.approvals, 'Time off and missing-time requests'),
    pg('people', 'candidates', 'Candidates', '/candidates', P.candidates, 'Hiring pipeline and openings'),
    pg('people', 'announcements', 'Announcements', '/announcements', P.announce, 'Posts shown in My workspace'),
  ] },
]
export const SETTINGS_PAGE = pg(null, 'settings', 'Settings', '/settings', P.gear, 'Company, team access, permissions, notifications, integrations, history')

/** Same rules as the old sidebar (Shell.tsx isVisible) */
export function canSeePage(key: string, role: AppRole, allowed: Allowed): boolean {
  switch (key) {
    case 'weekly-close': return allowed('weekly_close.manage')
    case 'leads': return role === 'ceo' || role === 'admin' || role === 'lead_gen' || allowed('leads.view_all') || allowed('leads.manage')
    case 'payroll': return allowed('payroll.view') || allowed('payroll.manage')
    case 'approvals': return allowed('timeoff.approve') || can.approveTime(role)
    case 'announcements': return allowed('announcements.manage')
    case 'invoices': return can.viewInvoices(role)
    case 'clients': return can.viewClients(role)
    case 'team': return can.viewEmployees(role)
    case 'candidates': return can.viewAllCandidates(role) || can.viewHiredOnly(role)
    case 'expenses': return can.viewExpenses(role)
    case 'reports': return can.viewReports(role)
    default: return true
  }
}

/** Hubs with only the pages this person can open; empty hubs are dropped */
export function visibleHubs(role: AppRole, allowed: Allowed): Hub[] {
  return HUBS.map(h => ({ ...h, pages: h.pages.filter(p => canSeePage(p.key, role, allowed)) })).filter(h => h.pages.length > 0)
}

const PROFILE_PARENT: Record<string, string> = { employees: 'team', clients: 'clients', projects: 'projects', candidates: 'candidates' }

/** Which hub/page a path belongs to (profile routes resolve to their list page) */
export function locate(pathname: string): { hub: Hub | null; page: NavPage | null; isProfile: boolean } {
  if (pathname === '/' || pathname === '') return { hub: null, page: null, isProfile: false }
  if (pathname.startsWith('/settings')) return { hub: null, page: SETTINGS_PAGE, isProfile: false }
  const prof = pathname.match(/^\/(employees|clients|projects|candidates)\/[^/]+/)
  for (const h of HUBS) for (const p of h.pages) {
    if (prof ? PROFILE_PARENT[prof[1]] === p.key : pathname === p.to || pathname.startsWith(p.to + '/')) return { hub: h, page: p, isProfile: !!prof }
  }
  if (pathname.startsWith('/me')) return { hub: null, page: { key: 'me', label: 'My workspace', to: '/me', icon: P.user, desc: '', hub: null }, isProfile: false }
  return { hub: null, page: null, isProfile: false }
}

export type CreateItem = { key: string; label: string; icon: string; to: string; page: string }
/** Create menu: each opens the page's existing create flow via ?create=… (pages read it on mount and clear it) */
export const CREATE_ITEMS: CreateItem[] = [
  { key: 'invoice', label: 'New invoice', icon: P.invoices, to: '/invoice?create=invoice', page: 'invoices' },
  { key: 'payment', label: 'Record payment', icon: P.cash, to: '/invoice?create=payment', page: 'invoices' },
  { key: 'lead', label: 'New lead', icon: P.leads, to: '/leads?create=1', page: 'leads' },
  { key: 'client', label: 'New client', icon: P.clients, to: '/clients?create=1', page: 'clients' },
  { key: 'project', label: 'New project', icon: P.projects, to: '/projects?create=1', page: 'projects' },
  { key: 'time', label: 'Log manual time', icon: P.time, to: '/time?create=1', page: 'time' },
  { key: 'employee', label: 'New employee', icon: P.team, to: '/employees?create=1', page: 'team' },
  { key: 'expense', label: 'Add expense', icon: P.expenses, to: '/expenses?create=1', page: 'expenses' },
]
export function visibleCreateItems(role: AppRole, allowed: Allowed): CreateItem[] {
  return CREATE_ITEMS.filter(c => canSeePage(c.page, role, allowed) && (c.key !== 'time' || can.approveTime(role)))
}
