import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isGmailConnected } from '../services/gmail'

/** CEO: whose connected Gmail sends automatic emails (weekly close, payslips, notifications) */
export default function AutoEmailSender() {
  const [sender, setSender] = useState<{ id: string | null; email: string | null } | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    const [{ data: { user } }, { data: row }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('settings').select('notify_sender_user_id').eq('id', 1).maybeSingle(),
    ])
    setMe(user?.id ?? null)
    const id = (row as { notify_sender_user_id?: string } | null)?.notify_sender_user_id ?? null
    let email: string | null = null
    if (id) {
      const { data } = await supabase.from('user_roles').select('email').eq('user_id', id).maybeSingle()
      email = (data as { email?: string } | null)?.email ?? null
    }
    setSender({ id, email })
    setConnected(await isGmailConnected().catch(() => false))
  }
  useEffect(() => { void load() }, [])

  async function useMine() {
    setMsg(null)
    const { error } = await supabase.from('settings').update({ notify_sender_user_id: me }).eq('id', 1)
    if (error) { setMsg(error.message.includes('notify_sender_user_id') ? 'Run supabase/migrate-step1-foundation.sql first.' : error.message); return }
    await load()
    setMsg('Saved — automatic emails will come from your Gmail.')
  }

  return (
    <section className="set-card">
      <div className="set-card__head">
        <div className="set-card__titles">
          <h2 className="set-card__title">Automatic emails are sent from</h2>
          <span className="set-card__sub">
            {sender === null ? 'Checking…' : sender.id
              ? <>{sender.id === me ? 'Your Gmail' : sender.email ?? 'Another team member'}{sender.id === me && !connected && ' — but your Gmail is not connected (Settings → Integrations)'}</>
              : 'Nobody yet — weekly-close emails, payslips and notification emails need a connected Gmail account.'}
          </span>
        </div>
        {sender && sender.id !== me && (
          <button type="button" className="btn btn--sm" disabled={!connected} title={connected ? '' : 'Connect your Gmail first (Integrations tab)'} onClick={() => void useMine()}>
            Use my Gmail
          </button>
        )}
      </div>
      {msg && <span className={`set-msg set-msg--${msg.startsWith('Saved') ? 'ok' : 'err'}`} role="status">{msg}</span>}
    </section>
  )
}
