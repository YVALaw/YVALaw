// "Who did what" for actions that aren't a saved change (saved changes are recorded by the audit_log triggers):
// emailed an invoice, sent a reminder, downloaded a payslip, signed in… Written through public.log_action()
// (supabase/migrate-staff-profiles.sql), which stamps the signed-in person and time server-side — the browser can't
// write audit_log directly. Never throws: a missing function (SQL not run yet) or a network error is ignored.
import { supabase } from '../lib/supabase'

export type ActionKind =
  | 'invoice_emailed' | 'invoice_reminder' | 'invoice_pdf' | 'statement_emailed' | 'payslip_pdf'
  | 'client_emailed' | 'signed_in' | 'export' | 'import' | 'other'

/** Record an action. `table`/`recordId` point at the record it was about (shown on that record's history too). */
export async function logAction(kind: ActionKind, label: string, opts: { table?: string; recordId?: string | null; details?: Record<string, unknown> } = {}): Promise<void> {
  try {
    await supabase.rpc('log_action', {
      p_kind: kind,
      p_label: label.slice(0, 300),
      p_table: opts.table ?? null,
      p_record: opts.recordId ?? null,
      p_details: opts.details ?? {},
    })
  } catch { /* history is best-effort for actions; the action itself already happened */ }
}
