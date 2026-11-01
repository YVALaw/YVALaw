import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { uploadPhoto } from '../utils/photo'
import ClientContacts from '../components/ClientContacts'
import HistoryList from '../components/HistoryList'
import type { ActivityLogEntry, Client, ClientDocument, Invoice, Project, StaffRequest, Tag } from '../data/types'
import { loadSnapshot, saveClients, loadActivityLog, loadClientDocuments, loadClientBillingSummary, loadStaffRequests, type ClientBillingSummary } from '../services/storage'
import { invoicesOf, isUnpaid, balanceOf, sendClientReminder, loadPortalStatuses } from '../services/crm'
import { loadTags, saveTags } from '../services/tagStorage'
import { supabase } from '../lib/supabase'
import { APP_URL } from '../lib/appUrl'
import { can } from '../lib/roles'
import { usePermission, useRole } from '../context/RoleContext'
import { clientHealth, HEALTH_TONE } from '../utils/clientHealth'
import { TagBadge } from '../components/TagBadge'
import { Banner, KpiStrip, Menu, Modal, PageHeader, Pill, Skel, Tabs, type Tone } from '../components/ui'
import { Ic, P } from '../components/Icon'
import ClientFormDrawer, { CLIENT_STAGES, avatarTone, normTags } from '../components/crm/ClientFormDrawer'
import { BillingTab, CommsTab, ContractsTab, DocumentsTab } from '../components/crm/ClientProfileTabs'
import { dateMed, dateShort, initials, usd } from '../utils/format'

type TabKey = 'overview' | 'billing' | 'comms' | 'contracts' | 'docs' | 'history'
const TAB_KEYS: TabKey[] = ['overview', 'billing', 'comms', 'contracts', 'docs', 'history']
const INACTIVE_PROJECT = new Set(['completed', 'cancelled', 'canceled', 'closed', 'archived', 'paused', 'on hold', 'inactive'])
const PAY_LABEL: Record<string, string> = { weekly: 'weekly pay', biweekly: 'bi-weekly', semimonthly: 'twice a month', monthly: 'monthly' }

export default function ClientProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const allowed = usePermission()
  const { role } = useRole()
  const [params, setParams] = useSearchParams()
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([])
  const [allActivity, setAllActivity] = useState<ActivityLogEntry[]>([])
  const [requests, setRequests] = useState<StaffRequest[]>([])
  const [clientDocs, setClientDocs] = useState<ClientDocument[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [lastLogin, setLastLogin] = useState<string | null>(null)
  const [portalBilling, setPortalBilling] = useState<ClientBillingSummary>({ hasPortalAccount: false, autoPayEnabled: false, hasSavedPaymentMethod: false, recentAttempts: [] })
  const tabParam = params.get('tab') as TabKey | null
  const [tab, setTab] = useState<TabKey>(tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'overview')
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [inviteLoading, setInviteLoading] = useState<'email' | 'link' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadSnapshot().then(snap => { setClients(snap.clients); setInvoices(snap.invoices); setProjects(snap.projects); setLoaded(true) })
    void loadActivityLog().then(all => { setAllActivity(all); setActivityLog(all.filter(e => e.clientId === id).sort((a, b) => b.createdAt - a.createdAt)) })
    void loadStaffRequests().then(setRequests).catch(() => {})
    void loadTags().then(setAllTags)
    if (id) {
      void loadClientDocuments(id).then(setClientDocs)
      void loadClientBillingSummary(id).then(setPortalBilling)
      void loadPortalStatuses().then(m => setLastLogin(m?.get(id)?.lastLoginAt ?? null))
    }
  }, [id])
  const client = clients.find(c => c.id === id)

  // Computed (hooks above the early return)
  const clientInvoices = useMemo(() => (client ? invoicesOf(client, invoices) : []), [client, invoices])
  const health = useMemo(() => (client && (client.status || 'lead').toLowerCase() !== 'lead' ? clientHealth(client, invoices, allActivity, requests) : null), [client, invoices, allActivity, requests])

  if (!client) {
    return (
      <div className="page crm-page">
        <button type="button" className="back-link" onClick={() => navigate('/clients')}><Ic d={P.chevL} size={15} />Clients</button>
        {loaded ? <div className="card card-empty">Client not found.</div> : <div className="card card--pad stack"><Skel h={28} w="40%" /><Skel h={14} w="60%" /><Skel h={80} /></div>}
      </div>
    )
  }
  const clientNN = client

  const totalRevenue = clientInvoices.reduce((s, i) => s + (Number(i.subtotal) || 0), 0)
  const outstanding = clientInvoices.filter(isUnpaid).reduce((s, i) => s + balanceOf(i), 0)
  const clientProjects = projects.filter(p => p.clientId === clientNN.id)
  const activeProjects = clientProjects.filter(p => !INACTIVE_PROJECT.has(String(p.status || '').toLowerCase()))
  const people = new Set(activeProjects.flatMap(p => p.employeeIds ?? [])).size
  const payDays = clientInvoices.flatMap(inv => {
    const paid = inv.statusHistory?.filter(h => h.status === 'paid').pop()
    if (!paid || !inv.date) return []
    const [y, m, d] = inv.date.slice(0, 10).split('-').map(Number)
    const days = Math.round((paid.changedAt - new Date(y, (m || 1) - 1, d || 1).getTime()) / 86400000)
    return days >= 0 ? [days] : []
  })
  const avgDays = payDays.length ? Math.round(payDays.reduce((a, b) => a + b, 0) / payDays.length) : null
  const stage = (clientNN.status || 'lead').toLowerCase()
  const extra = clientNN as Client & { invoicePrefix?: string | null; nextInvoiceSeq?: number | null }
  const canPreview = can.viewInvoices(role)   // portal preview is CEO/Admin/Accounting only (enforced by the portal too)

  /** Optimistic update → await → roll back with a message if it fails */
  async function persistUpdate(updated: Client) {
    const prev = clients
    const next = clients.map(c => (c.id === updated.id ? updated : c))
    setClients(next)
    try { await saveClients(next) } catch (e) { setClients(prev); setMsg({ ok: false, text: `Could not save: ${(e as Error).message}` }); throw e }
  }
  function handlePhotoUpload(file: File) {
    if (!file.type.startsWith('image/')) { setMsg({ ok: false, text: 'Please select an image file.' }); return }
    if (file.size > 5 * 1024 * 1024) { setMsg({ ok: false, text: 'Image too large (max 5 MB).' }); return }
    // Stored as a small file in Storage; the record keeps only the link (utils/photo.ts)
    void uploadPhoto(file, `photos/clients/${clientNN.id}`)
      .then(url => persistUpdate({ ...clientNN, photoUrl: url }).then(() => setMsg({ ok: true, text: 'Photo updated.' })))
      .catch(e => setMsg({ ok: false, text: `Could not upload the photo: ${(e as Error).message}` }))
  }
  async function handleDelete() {
    const prev = clients
    const next = clients.filter(c => c.id !== clientNN.id)
    setClients(next)
    try { await saveClients(next); navigate('/clients') } catch (e) { setClients(prev); setConfirmDelete(false); setMsg({ ok: false, text: `Could not delete: ${(e as Error).message}` }) }
  }
  async function sendPortalInvite(mode: 'email' | 'link') {
    if (!clientNN.email) { setMsg({ ok: false, text: 'Add an email address to this client before inviting.' }); return }
    setInviteLoading(mode); setMsg(null)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setInviteLoading(null); setMsg({ ok: false, text: 'You must be logged in.' }); return }
    try {
      const res = await fetch('/.netlify/functions/invite-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ clientId: clientNN.id, email: clientNN.email, mode, redirectTo: `${APP_URL}portal/set-password` }),
      })
      const data = await res.json()
      if (!res.ok) { setMsg({ ok: false, text: data.error || 'Failed to send invitation.' }); return }
      if (mode === 'link') {
        const inviteLink = data.inviteLink as string | undefined
        if (!inviteLink) { setMsg({ ok: false, text: 'Invite was created but no link was returned.' }); return }
        try { await navigator.clipboard.writeText(inviteLink); setMsg({ ok: true, text: `Invite link copied for ${clientNN.email}. You can paste it into your own email or message.` }) }
        catch { window.prompt('Copy this portal invite link:', inviteLink); setMsg({ ok: true, text: `Invite link created for ${clientNN.email}.` }) }
      } else {
        // Email mode: Supabase sends the invite email automatically with the correct redirect.
        setMsg({ ok: true, text: `Invitation email sent to ${clientNN.email}` })
      }
    } catch {
      setMsg({ ok: false, text: 'Network error — could not create invitation.' })
    } finally { setInviteLoading(null) }
  }
  async function sendReminder() {
    try {
      const r = await sendClientReminder(clientNN, invoices)
      if (!r) return
      if (r.result.mode === 'gmail') setMsg({ ok: true, text: `Reminder sent via Gmail to ${clientNN.email} for ${usd(r.total)} (${r.count} invoice${r.count === 1 ? '' : 's'}).` })
      else if (r.result.mode === 'mailto') setMsg({ ok: true, text: `Reminder for ${usd(r.total)} opened in your email app.` })
      else setMsg({ ok: false, text: `Reminder not sent: ${r.result.fallbackReason ?? 'Gmail could not send it.'}` })
    } catch (e) { setMsg({ ok: false, text: `Reminder not sent: ${(e as Error).message}` }) }
  }
  function handleTagCreated(tag: Tag) { const next = [...allTags, tag]; setAllTags(next); void saveTags(next).catch(() => {}) }
  const tagColor = (label: string) => allTags.find(t => t.label === label)?.color ?? '#3b82f6'
  function pickTab(t: TabKey) { setTab(t); setParams(t === 'overview' ? {} : { tab: t }, { replace: true }) }

  const portalPill: { text: string; tone: Tone; title: string } = portalBilling.autoPayEnabled
    ? { text: 'AutoPay on', tone: 'success', title: `AutoPay authorized${portalBilling.autoPayAuthorizedAt ? ` on ${dateMed(portalBilling.autoPayAuthorizedAt)}` : ''}` }
    : portalBilling.hasSavedPaymentMethod ? { text: 'Card saved', tone: 'gold', title: 'Client has a saved card but AutoPay is off' }
    : portalBilling.hasPortalAccount ? { text: 'AutoPay off', tone: 'neutral', title: 'Client portal account exists, but no AutoPay authorization yet' }
    : { text: 'No portal', tone: 'neutral', title: 'No client portal account yet' }
  const info = [
    { k: 'Email', v: clientNN.email },
    { k: 'Phone', v: clientNN.phone },
    { k: 'Company', v: clientNN.company },
    { k: 'Default rate', v: clientNN.defaultRate ? `$${Number(clientNN.defaultRate).toFixed(2)}/hr` : undefined },
    { k: 'Payment terms', v: clientNN.paymentTerms },
    { k: 'Invoice prefix', v: extra.invoicePrefix ? `${extra.invoicePrefix}${extra.nextInvoiceSeq ? ` · next ${String(extra.nextInvoiceSeq).padStart(4, '0')}` : ''}` : undefined },
    { k: 'Contract ends', v: clientNN.contractEnd ? dateMed(clientNN.contractEnd) : undefined },
    { k: 'Timezone', v: clientNN.timezone },
    { k: 'Billing address', v: clientNN.address },
    { k: 'Portal', v: portalBilling.hasPortalAccount ? (lastLogin ? `Last login ${dateShort(lastLogin)}` : 'Invited, not signed in yet') : 'No portal account' },
  ].filter(i => i.v)
  const tags = normTags(clientNN.tags)

  return (
    <div className="page crm-page">
      <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }} />
      <button type="button" className="back-link" onClick={() => navigate('/clients')}><Ic d={P.chevL} size={15} />Clients</button>

      <div className="crm-prof-head">
        <div className="crm-prof-id">
          <button type="button" className={`crm-av crm-av--xl ${avatarTone(clientNN.name)}`} title="Change photo" aria-label="Change photo" onClick={() => photoInputRef.current?.click()}>
            {clientNN.photoUrl ? <img src={clientNN.photoUrl} alt="" /> : initials(clientNN.name)}
          </button>
          <PageHeader keepTitleOnPhone className="crm-prof-title" title={clientNN.name}
            sub={<>
              <span>{[clientNN.company, clientNN.email, clientNN.timezone].filter(Boolean).join(' · ') || 'No contact details yet'}</span>
              <span className="crm-pills">
                <Pill status={stage}>{CLIENT_STAGES.find(s => s.key === stage)?.label ?? stage}</Pill>
                {health && <span title={health.reasons.join(' · ') || 'All good'}><Pill tone={HEALTH_TONE[health.level]}>{health.label}{health.reasons[0] ? ` · ${health.reasons[0]}` : ''}</Pill></span>}
                <span title={portalPill.title}><Pill tone={portalPill.tone}>{portalPill.text}</Pill></span>
                {portalBilling.lastAttempt?.status === 'failed' && <span title={portalBilling.lastAttempt.failureReason || 'Latest payment attempt failed'}><Pill tone="danger">Payment failed</Pill></span>}
              </span>
            </>} />
        </div>
        <div className="page-actions crm-prof-actions">
          {outstanding > 0 && clientNN.email && <button type="button" className="btn btn--primary" onClick={() => void sendReminder()}><Ic d={P.mail} size={15} />Send reminder</button>}
          <Menu label="Portal access" buttonClass="btn" trigger={<>{inviteLoading === 'email' ? 'Sending…' : inviteLoading === 'link' ? 'Creating…' : 'Portal access'}<Ic d={P.chevD} size={14} /></>}
            items={[
              { label: <span className="crm-menu2"><span>Email invite</span><span className="crm-menu2__sub">Supabase sends the invite to {clientNN.email || 'the client email'}</span></span>, onClick: () => void sendPortalInvite('email'), disabled: inviteLoading !== null },
              { label: <span className="crm-menu2"><span>Copy invite link</span><span className="crm-menu2__sub">One-time link to send yourself</span></span>, onClick: () => void sendPortalInvite('link'), disabled: inviteLoading !== null },
              { label: <span className="crm-menu2"><span>Preview portal</span><span className="crm-menu2__sub">Opens their portal in a new tab</span></span>, hidden: !canPreview, onClick: () => window.open(`${import.meta.env.BASE_URL}portal/dashboard?preview=${clientNN.id}`, '_blank') },
            ]} />
          <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
          <Menu label="More actions" items={[
            { label: 'Change photo', icon: P.image, onClick: () => photoInputRef.current?.click() },
            'sep',
            { label: 'Delete client', icon: P.trash, danger: true, onClick: () => setConfirmDelete(true) },
          ]} />
        </div>
      </div>
      {msg && <Banner tone={msg.ok ? 'success' : 'danger'} onClose={() => setMsg(null)}>{msg.text}</Banner>}

      <KpiStrip compact items={[
        { label: 'Revenue, all time', value: usd(totalRevenue, { cents: false }) },
        { label: 'Outstanding', value: <span className={outstanding > 0 ? 't-danger' : undefined}>{usd(outstanding, { cents: false })}</span>, note: `${clientInvoices.length} invoice${clientInvoices.length === 1 ? '' : 's'}` },
        { label: 'Active projects', value: activeProjects.length, note: clientProjects.length !== activeProjects.length ? `${clientProjects.length} in total` : undefined },
        { label: 'People placed', value: people },
        { label: 'Avg. days to pay', value: avgDays ?? '—' },
      ]} />

      <Tabs label="Client sections" value={tab} onChange={pickTab} tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'billing', label: 'Billing', count: clientInvoices.length || null },
        { value: 'comms', label: 'Communications' },
        { value: 'contracts', label: 'Contracts', count: (clientNN.contracts ?? []).length || null },
        { value: 'docs', label: 'Documents', count: clientDocs.length || null },
        { value: 'history', label: 'History', hidden: !allowed('history.view') },
      ]} />

      {tab === 'overview' && (
        <div className="grid-auto">
          <section className="card card--pad stack">
            <h2 className="card__title">Client information</h2>
            <div className="info-grid">{info.map(i => <div key={i.k} className="info"><span className="info__label">{i.k}</span><span className="info__value">{i.v}</span></div>)}</div>
            {tags.length > 0 && <div className="crm-tagrow">{tags.map(t => <TagBadge key={t} label={t} color={tagColor(t)} />)}</div>}
            {clientNN.notes && <div className="crm-notes">{clientNN.notes}</div>}
            {(clientNN.links ?? []).length > 0 && <div className="crm-tagrow">{(clientNN.links ?? []).map((lk, i) => <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="crm-linkpill">{lk.label}</a>)}</div>}
          </section>
          <div className="stack stack--lg">
            <section className="card">
              <div className="card__head"><h2 className="card__title">Projects</h2><button type="button" className="link" onClick={() => navigate('/projects')}>All projects →</button></div>
              {clientProjects.length === 0 ? <div className="card-empty">No projects yet.</div> : clientProjects.map(p => {
                const n = (p.employeeIds ?? []).length
                return (
                  <button key={p.id} type="button" className="list-row crm-btnrow" onClick={() => navigate('/projects/' + p.id)}>
                    <div className="list-row__main"><span className="list-row__title">{p.name}</span><span className="list-row__meta">{[`${n} ${n === 1 ? 'person' : 'people'}`, PAY_LABEL[p.paySchedule || 'weekly'], p.status].filter(Boolean).join(' · ')}</span></div>
                    {p.rate ? <span className="num crm-td-strong">${Number(p.rate).toFixed(2).replace(/\.00$/, '')}/hr</span> : null}
                  </button>
                )
              })}
            </section>
            <ClientContacts clientId={clientNN.id} />
          </div>
        </div>
      )}
      {tab === 'billing' && <BillingTab invoices={clientInvoices} billing={portalBilling} canOpenInvoices={can.viewInvoices(role)} />}
      {tab === 'comms' && <CommsTab clientId={clientNN.id} log={activityLog} setLog={setActivityLog} />}
      {tab === 'contracts' && <ContractsTab client={clientNN} persist={persistUpdate} />}
      {tab === 'docs' && <DocumentsTab client={clientNN} docs={clientDocs} setDocs={setClientDocs} />}
      {tab === 'history' && allowed('history.view') && <section className="card card--pad crm-narrow"><HistoryList table="clients" recordId={clientNN.id} limit={50} /></section>}

      <ClientFormDrawer open={editing} client={clientNN} allTags={allTags} onTagCreated={handleTagCreated} onClose={() => setEditing(false)}
        onSave={async patch => { await persistUpdate({ ...clientNN, ...patch }); setMsg({ ok: true, text: 'Client saved.' }) }} />
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${clientNN.name}?`} sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="btn btn--danger" onClick={() => void handleDelete()}>Delete</button></>} />
    </div>
  )
}
