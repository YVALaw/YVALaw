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
    <div className="settings-row" style={{ alignItems: 'flex-start' }}>
      <div className="settings-row-info">
        <div className="settings-row-label">Automatic emails are sent from</div>
        <div className="settings-row-sub">
          {sender?.id
            ? <>{sender.id === me ? 'Your Gmail' : sender.email ?? 'Another team member'}{sender.id === me && !connected && ' — but your Gmail is not connected (Settings → Integrations)'}</>
            : 'Nobody yet — weekly-close emails, payslips and notification emails need a connected Gmail account.'}
          {msg && <div style={{ marginTop: 4, color: msg.startsWith('Saved') ? '#15803d' : '#dc2626' }}>{msg}</div>}
        </div>
      </div>
      {sender && sender.id !== me && (
        <button className="btn-primary btn-sm" disabled={!connected} title={connected ? '' : 'Connect your Gmail first (Integrations tab)'} onClick={() => void useMine()}>
          Use my Gmail
        </button>
      )}
    </div>
  )
}
