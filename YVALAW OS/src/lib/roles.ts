export type UserRole = 'ceo' | 'admin' | 'accounting' | 'recruiter' | 'lead_gen'

/** All roles in the system — UserRole covers internal staff, 'client' covers portal users */
export type AppRole = UserRole | 'client'

export const ROLE_LABELS: Record<UserRole, string> = {
  ceo:        'CEO',
  admin:      'Admin',
  accounting: 'Accounting',
  recruiter:  'Recruiter',
  lead_gen:   'Lead Generator',
}

export const ROLE_OPTIONS: UserRole[] = ['ceo', 'admin', 'accounting', 'recruiter', 'lead_gen']

// All can.* functions accept AppRole so OS pages don't need casts.
// 'client' will never match any internal-role check, so it returns false safely.
export const can = {
  viewInvoices:      (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewFinancials:    (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewPayRates:      (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewAllCandidates: (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'recruiter',
  viewHiredOnly:     (r: AppRole) => r === 'accounting',
  viewClients:       (r: AppRole) => r !== 'recruiter' && r !== 'client',
  viewExpenses:      (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewReports:       (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewEmployees:     (r: AppRole) => r !== 'lead_gen' && r !== 'client',
  manageRoles:       (r: AppRole) => r === 'ceo',
  // CEO-only: revenue totals, payroll, net earnings
  viewOwnerStats:    (r: AppRole) => r === 'ceo',
}
