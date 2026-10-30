export type UserRole = 'ceo' | 'admin' | 'accounting' | 'recruiter' | 'lead_gen'

/**
 * All roles in the system — UserRole covers internal staff, 'client' covers portal users,
 * 'employee' covers invited employees (My workspace / YVA Time only, never the internal OS),
 * 'pending' is a new account with no access until a CEO picks its role in Team Access.
 */
export type AppRole = UserRole | 'client' | 'employee' | 'pending'

export const ROLE_LABELS: Record<UserRole, string> = {
  ceo:        'CEO',
  admin:      'Admin',
  accounting: 'Accounting',
  recruiter:  'Recruiter',
  lead_gen:   'Lead Generator',
}

export const ROLE_OPTIONS: UserRole[] = ['ceo', 'admin', 'accounting', 'recruiter', 'lead_gen']

/** True only for internal staff roles (same list as private.is_internal() in the database) */
export const isStaff = (r: AppRole): r is UserRole => (ROLE_OPTIONS as AppRole[]).includes(r)

// All can.* functions accept AppRole so OS pages don't need casts.
// 'client', 'employee' and 'pending' never match an internal-role check, so they return false safely.
export const can = {
  viewInvoices:      (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewFinancials:    (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewPayRates:      (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewAllCandidates: (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'recruiter',
  viewHiredOnly:     (r: AppRole) => r === 'accounting',
  viewClients:       (r: AppRole) => isStaff(r) && r !== 'recruiter',
  viewExpenses:      (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewReports:       (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewEmployees:     (r: AppRole) => isStaff(r) && r !== 'lead_gen',
  manageRoles:       (r: AppRole) => r === 'ceo',
  // CEO-only: revenue totals, payroll, net earnings
  viewOwnerStats:    (r: AppRole) => r === 'ceo',
  // YVA Time: who is tracking + hours (Live), and screenshots (CEO/Admin only — matches RLS)
  viewTracker:       (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
  viewScreenshots:   (r: AppRole) => r === 'ceo' || r === 'admin',
  // Approve YVA Time hours / manual requests (matches yva_time_approve in the database)
  approveTime:       (r: AppRole) => r === 'ceo' || r === 'admin' || r === 'accounting',
}
