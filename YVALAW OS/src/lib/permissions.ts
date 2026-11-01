// Permissions (PLAN.md "built for growth"): every sensitive action is a permission.
// The CEO always has all of them; other staff roles get what the CEO ticks in
// Settings → Team Access → Permissions. Same rule as private.has_permission() in the database,
// which is what actually protects the data — the app only uses this to show or hide things.
import type { AppRole } from './roles'

export type Permission =
  | 'weekly_close.manage' | 'invoices.send' | 'payments.record'
  | 'payroll.view' | 'payroll.manage' | 'rates.manage' | 'bank.view' | 'bank.manage'
  | 'timeoff.approve' | 'announcements.manage' | 'documents.manage'
  | 'leads.view_all' | 'leads.manage' | 'history.view'

export const PERMISSIONS: { key: Permission; label: string; help: string; group: string }[] = [
  { key: 'weekly_close.manage',  group: 'Billing',   label: 'Run the weekly close',          help: 'Review the week, edit or move time, approve hours and prepare invoices' },
  { key: 'invoices.send',        group: 'Billing',   label: 'Send invoices',                 help: 'Email approved invoices to clients' },
  { key: 'payments.record',      group: 'Billing',   label: 'Record client payments',        help: 'Mark invoices paid or partly paid' },
  { key: 'rates.manage',         group: 'Billing',   label: 'Bill & pay rates',              help: 'See and change what clients are billed and what employees are paid' },
  { key: 'payroll.view',         group: 'Payroll',   label: 'See payroll',                   help: 'See the Friday payroll and payslips' },
  { key: 'payroll.manage',       group: 'Payroll',   label: 'Run payroll',                   help: 'Enter the exchange rate, add bonuses/deductions, mark people paid' },
  { key: 'bank.view',            group: 'Payroll',   label: 'See bank / PayPal details',     help: 'Account numbers employees are paid to' },
  { key: 'bank.manage',          group: 'Payroll',   label: 'Change bank / PayPal details',  help: 'Edit where employees are paid' },
  { key: 'timeoff.approve',      group: 'Team',      label: 'Approve time off',              help: 'Approve or decline vacation, sick and personal days' },
  { key: 'announcements.manage', group: 'Team',      label: 'Post announcements',            help: 'Announcements and holidays shown in My workspace' },
  { key: 'documents.manage',     group: 'Team',      label: 'Employee documents',            help: 'Upload and remove documents in employees\' My workspace' },
  { key: 'leads.view_all',       group: 'Sales',     label: 'See all leads',                 help: 'Without it, people only see leads assigned to them' },
  { key: 'leads.manage',         group: 'Sales',     label: 'Manage leads',                  help: 'Assign leads and turn a won lead into a client' },
  { key: 'history.view',         group: 'Admin',     label: 'See the change history',        help: 'Who changed what and when, across YVA OS' },
]

export const GRANTABLE_ROLES = ['admin', 'accounting', 'recruiter', 'lead_gen'] as const

export function hasPermission(role: AppRole, granted: readonly string[], p: Permission): boolean {
  if (role === 'ceo') return true
  return granted.includes(p)
}
