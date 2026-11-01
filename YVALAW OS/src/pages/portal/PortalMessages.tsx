// Portal → Messages: Crisp live chat (Phase 7). The Crisp website ID comes from Settings → Integrations
// (public.portal_chat_config(), since clients can't read `settings`). No ID → the "coming soon" card.
// Crisp is loaded for signed-in clients only — never in staff preview — and hidden again when the client leaves
// this page (portal.css hides .crisp-client unless <html> has .por-crisp-on); signing out resets the Crisp session.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRole } from '../../context/RoleContext'
import { usePortal } from '../../components/PortalSection'
import { loadChatConfig, loadPortalClient } from '../../services/portalStorage'
import { Ic, P } from '../../components/Icon'
import { Skel } from '../../components/ui'

const CONTACT_EMAIL = 'contact@yvastaffing.agency'
const SCRIPT_ID = 'yva-crisp-loader'
const ON_CLASS = 'por-crisp-on'
const PHONE = '(max-width: 759px)'

type CrispQueue = { push: (cmd: unknown[]) => unknown }
declare global {
  interface Window { $crisp?: CrispQueue; CRISP_WEBSITE_ID?: string }
}

const crisp = (...cmd: unknown[]) => { window.$crisp?.push(cmd) }
let signOutHooked = false

/** Loads Crisp once per page load (the loader keeps itself alive across visits to this tab) */
function startCrisp(websiteId: string) {
  if (!document.getElementById(SCRIPT_ID)) {
    window.$crisp = [] as unknown as CrispQueue
    window.CRISP_WEBSITE_ID = websiteId
    const s = document.createElement('script')
    s.id = SCRIPT_ID
    s.src = 'https://client.crisp.chat/l.js'
    s.async = true
    document.head.appendChild(s)
  }
  if (!signOutHooked) {
    signOutHooked = true
    // The next person to sign in on this browser must not inherit this client's conversation
    supabase.auth.onAuthStateChange(evt => {
      if (evt === 'SIGNED_OUT') { crisp('do', 'chat:close'); crisp('do', 'chat:hide'); crisp('do', 'session:reset') }
    })
  }
}

function openChat() { crisp('do', 'chat:show'); crisp('do', 'chat:open') }

export default function PortalMessages() {
  const { role, email } = useRole()
  const { clientId, roleClientId, isPreview } = usePortal()
  /** Only the signed-in client gets the chat; staff previewing the portal never load Crisp */
  const asClient = role === 'client' && !!roleClientId && !isPreview
  const [websiteId, setWebsiteId] = useState<string | null | undefined>(undefined)  // undefined = loading
  const [clientName, setClientName] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void loadChatConfig().then(c => { if (alive) setWebsiteId(c.crispWebsiteId) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!asClient || !clientId) return
    let alive = true
    void loadPortalClient(clientId)
      .then(c => { if (alive) setClientName(c?.company || c?.name || null) })
      .catch(() => { if (alive) setClientName(null) })
    return () => { alive = false }
  }, [asClient, clientId])

  const chatReady = asClient && !!websiteId && clientName !== undefined
  useEffect(() => {
    if (!chatReady || !websiteId) return
    startCrisp(websiteId)
    document.documentElement.classList.add(ON_CLASS)
    crisp('safe', true)  // a rejected value is ignored instead of throwing
    if (email) crisp('set', 'user:email', [email])
    if (clientName) crisp('set', 'user:nickname', [clientName])
    if (clientId) crisp('set', 'session:data', [[['client_id', clientId]]])
    // On phones the closed launcher would sit on the dock, so it goes away until "Open chat"
    crisp('on', 'chat:closed', () => { if (window.matchMedia(PHONE).matches) crisp('do', 'chat:hide') })
    openChat()
    return () => {
      document.documentElement.classList.remove(ON_CLASS)
      crisp('off', 'chat:closed')
      crisp('do', 'chat:close')
      crisp('do', 'chat:hide')
    }
  }, [chatReady, websiteId, email, clientName, clientId])

  if (websiteId === undefined || (asClient && websiteId && clientName === undefined)) {
    return (
      <div className="por-page" aria-busy="true" aria-label="Loading">
        <section className="card por-chat"><Skel w={160} h={18} /><Skel w="80%" h={14} /><Skel w={120} h={44} r={10} /></section>
      </div>
    )
  }

  // Staff preview: never load the client's chat into the staff OS
  if (!asClient) {
    return (
      <div className="por-page">
        <section className="card por-chat" aria-label="Messages">
          <span className="por-chat__icon" aria-hidden><Ic d={P.message} size={20} /></span>
          <h1 className="por-chat__title">Chat is only available to the client</h1>
          <p className="por-chat__text">
            {websiteId
              ? 'Crisp is connected: the client sees live chat on this tab, and replies are sent from your Crisp inbox.'
              : 'Crisp isn’t set up yet, so the client sees “coming soon” here. Add the Crisp website ID in Settings → Integrations.'}
          </p>
        </section>
      </div>
    )
  }

  if (!websiteId) {
    return (
      <div className="por-page">
        <section className="por-soon" aria-label="Messages">
          <span className="por-soon__tag mono">COMING SOON</span>
          <h1 className="por-soon__title">Messages</h1>
          <p className="por-soon__text">
            Live chat with your YVA account manager is on the way. Until then, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="por-page">
      <section className="card por-chat" aria-label="Messages">
        <span className="por-chat__icon" aria-hidden><Ic d={P.message} size={20} /></span>
        <h1 className="por-chat__title">Chat with YVA</h1>
        <p className="por-chat__text">
          The chat window opens in the bottom-right corner of your screen (full screen on phones). Messages go straight to your YVA account manager.
        </p>
        <button type="button" className="btn btn--primary por-btn-lg" onClick={openChat}><Ic d={P.message} size={16} /> Open chat</button>
        <p className="por-chat__note">Prefer email? Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </section>
    </div>
  )
}
