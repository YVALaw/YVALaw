export type Attachment = {
  id: string
  name: string
  mimeType: string
  size: number
  dataUrl: string
  storageUrl?: string   // Supabase Storage public URL (set when uploaded via Storage)
  storagePath?: string  // Supabase Storage path used for deletion
  uploadedAt: number
}

export type Employee = {
  id: string
  name: string
  userId?: string          // Supabase auth user ID — set when employee signs up
  employeeNumber?: string
  email?: string
  phone?: string
  payRate?: string | number
  defaultShiftStart?: string
  defaultShiftEnd?: string
  premiumEnabled?: boolean
  premiumStartTime?: string
  premiumPercent?: string | number
  role?: string
  employmentType?: string
  location?: string
  timezone?: string
  startYear?: number | string
  status?: string
  notes?: string
  photoUrl?: string
  attachments?: Attachment[]
}

export type Client = {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  address?: string
  timezone?: string
  defaultRate?: string | number
  paymentTerms?: string
  tags?: string[]
  notes?: string
  status?: string
  contractEnd?: string
  photoUrl?: string
  links?: { label: string; url: string }[]
  contracts?: Contract[]
}

export type Project = {
  id: string
  name: string
  rate?: string | number
  budget?: number
  clientId?: string | null
  employeeIds?: string[]
  nextInvoiceSeq?: number
  status?: string
  billingModel?: string
  startDate?: string
  endDate?: string
  description?: string
  projectNeeds?: string
  notes?: string
  tags?: string[]
  links?: { label: string; url: string }[]
  contracts?: Contract[]
}

export type Expense = {
  id: string
  projectId: string
  description: string
  amount: number
  date: string
  category?: string
  recurring?: boolean
  createdAt: number
}

export type InvoiceItem = {
  employeeId?: string
  employeeName: string
  position?: string
  hoursTotal: number
  rate: number
  shiftStart?: string
  shiftEnd?: string
  regularHours?: number
  premiumHours?: number
  basePayRate?: number
  premiumPercent?: number
  totalPay?: number
  daily?: Record<string, string>
}

export type EmployeePaymentRecord = {
  status: 'paid' | 'pending'
  paidDate?: string
  amount?: number
  notes?: string
}

export type Invoice = {
  id: string
  number: string
  date?: string
  dueDate?: string
  clientName?: string
  clientEmail?: string
  clientAddress?: string
  billingStart?: string
  billingEnd?: string
  projectId?: string | null
  projectName?: string
  status?: string
  subtotal?: number
  amountPaid?: number
  notes?: string
  items?: InvoiceItem[]
  statusHistory?: { status: string; changedAt: number }[]
  employeePayments?: Record<string, EmployeePaymentRecord>
  tags?: string[]
  createdAt?: number
  updatedAt?: number
}

export type CommEntryType = 'note' | 'call' | 'email' | 'meeting' | 'system'

export type ActivityLogEntry = {
  id: string
  clientId: string
  note: string
  createdAt: number
  type?: CommEntryType   // defaults to 'note' if absent (backward compat)
  auto?: boolean         // true = system-generated (not manually entered)
}

export type InvoiceTemplate = {
  id: string
  name: string
  clientId?: string
  projectId?: string
  billingStart?: string
  billingEnd?: string
  notes?: string
  rows: {
    employeeId?: string
    employeeName: string
    position: string
    rate: string
    hoursManual: string
    shiftStart?: string
    shiftEnd?: string
    daily: Record<string, string>
  }[]
  createdAt: number
}

export type DataSnapshot = {
  employees: Employee[]
  projects: Project[]
  clients: Client[]
  invoices: Invoice[]
  invoiceCounter: number
}

export type CandidateStage =
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected'

export type Candidate = {
  id: string
  name: string
  email?: string
  phone?: string
  role?: string
  source?: string
  stage: CandidateStage
  notes?: string
  resumeUrl?: string
  linkedinUrl?: string
  appliedAt?: string
  updatedAt?: number
  attachments?: Attachment[]
}

export type AppSettings = {
  usdToDop: number
  companyEmail?: string
  companyName?: string
  companyAddress?: string
  companyPhone?: string
  emailSignature?: string
  reminderDay?: number  // 0=Sun … 6=Sat, undefined=off
  reminderLastFired?: string  // ISO date string YYYY-MM-DD
  monthlyGoal?: number
  invoiceEmailTemplate?: string
  statementEmailTemplate?: string
  reminderEmailTemplate?: string
  // Gmail OAuth integration
  gmailClientId?: string
  gmailClientSecret?: string
  gmailAccessToken?: string
  gmailRefreshToken?: string
  gmailTokenExpiry?: number  // unix ms
  gmailEmail?: string
}

export type TaskStatus = 'todo' | 'in-progress' | 'done'

export type Task = {
  id: string
  projectId: string
  title: string
  description?: string
  status: TaskStatus
  assigneeName?: string
  dueDate?: string
  createdAt?: number
  mentions?: string[]
}

// ─── Estimates ────────────────────────────────────────────────────────────────

export type EstimateItem = {
  description: string
  qty: number
  unitPrice: number
}

export type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'

export type Estimate = {
  id: string
  number: string
  clientId?: string
  clientName?: string
  projectId?: string
  projectName?: string
  date: string
  expiryDate?: string
  items: EstimateItem[]
  notes?: string
  status: EstimateStatus
  total: number
  createdAt?: number
}

// ─── Time Tracking ────────────────────────────────────────────────────────────

export type TimeEntry = {
  id: string
  employeeId?: string
  employeeName: string
  projectId?: string
  projectName?: string
  clientName?: string
  date: string
  hours: number
  description?: string
  billable: boolean
  invoiced?: boolean
  createdAt?: number
}

// ─── Recurring Invoices ───────────────────────────────────────────────────────

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly'

export type RecurringInvoice = {
  id: string
  clientId?: string
  clientName?: string
  projectId?: string
  projectName?: string
  amount: number
  description?: string
  frequency: RecurringFrequency
  nextDueDate: string
  lastGeneratedDate?: string
  active: boolean
  items?: InvoiceItem[]
  createdAt?: number
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export type Tag = {
  id: string
  label: string
  color: string  // hex color
}

// ─── Contracts ────────────────────────────────────────────────────────────────

export type ContractStatus = 'draft' | 'active' | 'expired' | 'terminated'

export type Contract = {
  id: string
  title: string
  status: ContractStatus
  startDate?: string
  endDate?: string
  value?: number        // USD contract value (optional)
  notes?: string
  fileUrl?: string      // Supabase Storage URL
  filePath?: string     // Supabase Storage path for deletion
  fileName?: string     // original file name
  createdAt: number
}

// ─── Client Portal ────────────────────────────────────────────────────────────

/** Links a Supabase Auth user to a Client record for portal access */
export type ClientUser = {
  id: string
  authId: string        // Supabase auth.users UUID
  clientId: string      // references clients.id
  invitedAt?: string
  lastLoginAt?: string
  createdAt?: number
}

/** Client-initiated request for staff replacement or additional staff */
export type StaffRequest = {
  id: string
  clientId: string
  clientName?: string
  type: 'replacement' | 'additional'
  employeeId?: string   // for replacements — who to replace
  employeeName?: string
  role?: string
  hoursPerWeek?: number
  startDate?: string
  notes?: string
  status: 'pending' | 'in_review' | 'fulfilled' | 'declined'
  createdAt: number
}

/** Client rating/review for a team member */
export type TeamReview = {
  id: string
  clientId: string
  employeeId: string
  employeeName: string
  rating: 1 | 2 | 3 | 4 | 5
  comment?: string
  period?: string       // e.g. "April 2026"
  createdAt: number
}

/** Client-initiated performance bonus for a team member */
export type BonusRequest = {
  id: string
  clientId: string
  employeeId: string
  employeeName: string
  amount: number        // USD
  note?: string
  status: 'pending' | 'approved' | 'declined'
  createdAt: number
}

/** Working hour preferences set by the client */
export type WorkingHourPrefs = {
  id: string
  clientId: string
  mondayStart?: string
  mondayEnd?: string
  tuesdayStart?: string
  tuesdayEnd?: string
  wednesdayStart?: string
  wednesdayEnd?: string
  thursdayStart?: string
  thursdayEnd?: string
  fridayStart?: string
  fridayEnd?: string
  timezone?: string
  notes?: string
  updatedAt?: number
}

/** Document stored in Supabase Storage and linked to a client */
export type ClientDocument = {
  id: string
  clientId: string
  name: string
  category: 'contract' | 'nda' | 'report' | 'invoice' | 'other'
  fileUrl: string
  filePath: string
  fileSize?: number
  uploadedAt: number
  uploadedBy?: string   // internal user name/email
}
