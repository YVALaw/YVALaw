// Notification kinds: who gets them and how they are described in Settings → Notifications.
export type NotificationKind =
  | 'week_ready' | 'week_flags' | 'payroll_due' | 'payment_received' | 'timeoff_request' | 'manual_time_request'
  | 'lead_new' | 'followup_due' | 'application_new'
  | 'payslip_ready' | 'timeoff_decision' | 'time_adjusted' | 'announcement' | 'manual_time_decision'
  | 'test'

export const STAFF_KINDS: { kind: NotificationKind; label: string }[] = [
  { kind: 'week_ready',          label: 'Weekly close: invoices ready to review (Monday)' },
  { kind: 'payroll_due',         label: 'Payroll due this Friday' },
  { kind: 'payment_received',    label: 'Client payment received' },
  { kind: 'timeoff_request',     label: 'Time-off requests' },
  { kind: 'manual_time_request', label: 'Missing-time requests' },
  { kind: 'lead_new',            label: 'New leads from the website' },
  { kind: 'followup_due',        label: 'Lead follow-ups due' },
  { kind: 'application_new',     label: 'New job applications (careers page)' },
]

export const EMPLOYEE_KINDS: { kind: NotificationKind; label: string; labelEs: string }[] = [
  { kind: 'payslip_ready',        label: 'My pay is ready',               labelEs: 'Mi pago está listo' },
  { kind: 'timeoff_decision',     label: 'Answers to my time-off requests', labelEs: 'Respuestas a mis solicitudes de días libres' },
  { kind: 'manual_time_decision', label: 'Answers to my missing-time requests', labelEs: 'Respuestas a mis solicitudes de tiempo' },
  { kind: 'time_adjusted',        label: 'YVA adjusted my time',          labelEs: 'YVA ajustó mi tiempo' },
  { kind: 'announcement',         label: 'Company announcements',         labelEs: 'Anuncios de la empresa' },
]
