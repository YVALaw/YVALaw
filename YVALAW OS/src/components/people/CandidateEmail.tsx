// Email a candidate from YVA OS (2026-11): the shared compose window (EmailComposeModal → sendEmail → the company
// Outlook mailbox), To = the candidate's email. Each send is recorded on the candidate with
// log_action('candidate_emailed', …, 'candidates', <id>, {to, cc, subject, via}) and listed by CandidateEmails
// through public.record_emails() (supabase/migrate-notification-links.sql) — who, when, to and subject; the full
// email stays in the mailbox's Sent Items. Before that SQL runs the list simply doesn't show.
import { useEffect, useState } from 'react'
import type { Candidate } from '../../data/types'
import { supabase } from '../../lib/supabase'
import { logAction } from '../../services/activityLog'
import EmailComposeModal from '../EmailComposeModal'
import { Ic, P } from '../Icon'

export function CandidateEmailModal({ candidate, onClose, onSent }: { candidate: Candidate | null; onClose: () => void; onSent?: () => void }) {
  return (
    <EmailComposeModal open={!!candidate} onClose={onClose} title={`Email ${candidate?.name ?? ''}`}
      sub="Sent from the company mailbox. A copy is kept in its Sent Items and listed on this candidate."
      to={candidate?.email || ''} greetName={candidate?.name ?? ''}
      onSent={({ to, cc, subject, mode, who }) => {
        if (!candidate) return
        const viaApp = mode === 'mailto'
        void logAction('candidate_emailed', `Emailed ${candidate.name}: "${subject}" to ${who}${viaApp ? ' (opened in the email app)' : ''}`,
          { table: 'candidates', recordId: candidate.id, details: { to, cc, subject, via: mode } }).then(() => onSent?.())
      }} />
  )
}

export type CandidateEmailRow = { sentAt: number; sentBy: string | null; to: string | null; cc: string[]; subject: string | null; via: string | null }

/** Emails sent to this candidate from YVA OS (newest first). null = can't be listed (SQL not run yet / no access). */
export async function loadCandidateEmails(candidateId: string): Promise<CandidateEmailRow[] | null> {
  const { data, error } = await supabase.rpc('record_emails', { p_table: 'candidates', p_record: candidateId })
  if (error) return null
  return ((data || []) as { sent_at: string; sent_by: string | null; to_email: string | null; cc: unknown; subject: string | null; via: string | null }[])
    .map(r => ({ sentAt: Date.parse(r.sent_at), sentBy: r.sent_by, to: r.to_email, cc: Array.isArray(r.cc) ? r.cc.map(String) : [], subject: r.subject, via: r.via }))
}

const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** "Emails" list for the candidate drawer and profile; hidden until there's something to show */
export function CandidateEmails({ candidateId, refreshKey = 0, empty, bare }: { candidateId: string; refreshKey?: number; empty?: string; bare?: boolean }) {
  const [rows, setRows] = useState<CandidateEmailRow[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadCandidateEmails(candidateId).then(r => { if (alive) setRows(r) })
    return () => { alive = false }
  }, [candidateId, refreshKey])
  if (!rows || rows.length === 0) return empty ? <p className="ppl-fine">{empty}</p> : null
  return (
    <div className="ppl-cand-emails" aria-label="Emails sent to this candidate">
      {!bare && <span className="info__label">Emails sent from YVA OS</span>}
      <ul className="ppl-cand-emails__list">
        {rows.map((r, i) => (
          <li key={`${r.sentAt}-${i}`} className="ppl-cand-emails__item">
            <Ic d={P.mail} size={14} />
            <span className="ppl-cand-emails__text">
              <span className="ppl-cand-emails__subject">{r.subject || '(no subject)'}</span>
              <span className="ppl-cand-emails__meta">{when(r.sentAt)}{r.sentBy ? ` · by ${r.sentBy}` : ''}{r.to ? ` · to ${r.to}` : ''}{r.cc.length ? ` (+${r.cc.length} cc)` : ''}{r.via === 'mailto' ? ' · opened in the email app' : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
