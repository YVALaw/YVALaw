// Settings → Integrations / Email: can YVA OS send from the company Outlook mailbox? Asks the email-status
// function, which signs in to Microsoft with the app's credentials (no email is sent, no secret reaches the browser).
import { useCallback, useEffect, useState } from 'react'
import { loadEmailStatus } from '../../services/email'

export type EmailState = 'checking' | 'off' | 'ok' | 'problem'
export type EmailStatusView = { state: EmailState; mailbox?: string | null; reason?: string; missing?: string[] }

export async function checkEmailSending(): Promise<EmailStatusView> {
  try {
    const s = await loadEmailStatus(true)
    if (!s.configured) return { state: 'off', mailbox: s.mailbox, missing: s.missing }
    if (s.ok === false) return { state: 'problem', mailbox: s.mailbox, reason: s.problem }
    return { state: 'ok', mailbox: s.mailbox }
  } catch (e) {
    return { state: 'problem', reason: (e as Error).message }
  }
}

export function useEmailStatus() {
  const [status, setStatus] = useState<EmailStatusView>({ state: 'checking' })
  const recheck = useCallback(async () => {
    setStatus(s => ({ ...s, state: 'checking' }))
    setStatus(await checkEmailSending())
  }, [])
  useEffect(() => { void recheck() }, [recheck])
  return { status, recheck }
}
