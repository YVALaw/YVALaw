import { useEffect, useMemo, useState } from 'react'
import { useStickyView } from '../lib/stickyView'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { clientHealth, HEALTH_TONE, type Health } from '../utils/clientHealth'
import type { ActivityLogEntry, Client, Invoice, Project, StaffRequest, Tag } from '../data/types'
import { loadSnapshot, saveClients, loadActivityLog, loadStaffRequests } from '../services/storage'
import { loadPortalStatuses, outstandingOf, revenueOf, sendClientReminder, PORTAL_LABEL, type PortalInfo, type PortalStatus } from '../services/crm'
import { loadTags, saveTags } from '../services/tagStorage'
import { TagBadge } from '../components/TagBadge'
import { useRole } from '../context/RoleContext'
import { Banner, Menu, Modal, PageHeader, Pill, SearchInput, Segmented, Skel, Field, onEnter, useIsMobile } from '../components/ui'
import ClientFormDrawer, { CLIENT_STAGES, avatarTone, normTags } from '../components/crm/ClientFormDrawer'
import ClientActivityModal from '../components/crm/ClientActivityModal'
import { loadViews, storeViews, type SavedView } from '../components/crm/savedViews'
import { recipientsLabel } from '../utils/emailList'
import { initials, usd, usdShort } from '../utils/format'

type ViewMode = 'list' | 'pipeline'
type BaseTab = 'all' | 'active' | 'attention' | 'autopay'
type ViewFilters = { tab: BaseTab; q: string }
const BASE_TABS: { key: BaseTab; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'attention', label: 'Needs attention' }, { key: 'autopay', label: 'Not on AutoPay' }]
const STAGE_DOT: Record<string, string> = { lead: 'dot--muted', prospect: 'dot--info', active: 'dot--success', paused: 'dot--warning', churned: 'dot--danger' }
const PORTAL_CLASS: Record<PortalStatus, string> = { autopay: 'crm-portal--autopay', card: 'crm-portal--card', off: 'crm-portal--off', none: 'crm-portal--none' }

const stageOf = (c: Client) => (c.status || 'lead').toLowerCase()
const stageLabel = (s: string) => CLIENT_STAGES.find(x => x.key === s)?.label ?? s.charAt(0).toUpperCase() + s.slice(1)
function contractNote(c: Client): { text: string; tone: 'danger' | 'warning' } | null {
  if (!c.contractEnd) return null
  const [y, m, d] = c.contractEnd.slice(0, 10).split('-').map(Number)
  const t = new Date(); const days = Math.round((new Date(y, (m || 1) - 1, d || 1).getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / 86400000)
  if (days > 60) return null
  return days <= 0 ? { text: `Contract expired ${Math.abs(days)}d ago`, tone: 'danger' } : { text: `Contract ends in ${days}d`, tone: days <= 30 ? 'danger' : 'warning' }
}

export default function ClientsPage() {
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const { userId } = useRole()
  const [params, setParams] = useSearchParams()
  const [clients, setClients] = useState<Client[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [allTags, setAllTags] = useState<Tag[]>([])
  const [healthActivity, setHealthActivity] = useState<ActivityLogEntry[]>([])
  const [healthRequests, setHealthRequests] = useState<StaffRequest[]>([])
  const [portal, setPortal] = useState<Map<string, PortalInfo> | null | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useStickyView<ViewMode>('clients', 'list', ['list', 'pipeline'])
  const [tab, setTab] = useState<BaseTab>('all')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [views, setViews] = useState<SavedView<ViewFilters>[]>([])
  const [naming, setNaming] = useState<string | null>(null)
  const [form, setForm] = useState<{ client: Client | null } | null>(null)
  const [activityClient, setActivityClient] = useState<Client | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Client | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void loadSnapshot().then(snap => { setClients(snap.clients); setInvoices(snap.invoices); setProjects(snap.projects); setLoaded(true) })
    void loadTags().then(setAllTags)
    // Client health inputs (Step 9) and portal / AutoPay status for every client in one query
    void loadActivityLog().then(setHealthActivity)
    void loadStaffRequests().then(setHealthRequests).catch(() => {})
    void loadPortalStatuses().then(setPortal)
    if (params.get('create')) { setForm({ client: null }); setParams({}, { replace: true }) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setViews(loadViews<ViewFilters>('clients', userId)) }, [userId])

  /** Optimistic update → await the save → roll back with a message if it fails */
  async function persist(next: Client[], okText?: string) {
    const prev = clients
    setClients(next); setError(null)
    try { await saveClients(next); if (okText) setNotice(okText) }
    catch (e) { setClients(prev); setError(`Could not save: ${(e as Error).message}`); throw e }
  }
  async function saveForm(patch: Partial<Client>) {
    const editing = form?.client
    if (editing) await persist(clients.map(c => (c.id === editing.id ? { ...c, ...patch } : c)), `${patch.name} saved.`)
    else await persist([...clients, { id: crypto.randomUUID(), ...patch } as Client], `${patch.name} added.`)
  }
  async function doDelete(c: Client) { setConfirmDelete(null); await persist(clients.filter(x => x.id !== c.id), `${c.name} removed.`).catch(() => {}) }
  async function moveStage(id: string, stage: string) {
    const c = clients.find(x => x.id === id); if (!c || stageOf(c) === stage) return
    await persist(clients.map(x => (x.id === id ? { ...x, status: stage } : x))).catch(() => {})
  }
  async function remind(c: Client) {
    setError(null)
    try {
      const r = await sendClientReminder(c, invoices)
      if (!r) return
      if (r.result.mode === 'outlook') setNotice(`Reminder sent to ${recipientsLabel(r.to, r.cc)} for ${usd(r.total)} (${r.count} invoice${r.count === 1 ? '' : 's'}).`)
      else if (r.result.mode === 'mailto') setNotice(`Reminder for ${usd(r.total)} opened in your email app.`)
      else setError(`Reminder not sent: ${r.result.fallbackReason ?? 'the company mailbox could not send it.'}`)
    } catch (e) { setError(`Reminder not sent: ${(e as Error).message}`) }
  }
  function handleTagCreated(tag: Tag) { const next = [...allTags, tag]; setAllTags(next); void saveTags(next).catch(e => setError(`Tag not saved: ${(e as Error).message}`)) }
  const tagColor = (label: string) => allTags.find(t => t.label === label)?.color ?? '#3b82f6'

  // Derived rows
  const rows = useMemo(() => clients.map(c => {
    const stage = stageOf(c)
    const health: Health | null = stage === 'lead' ? null : clientHealth(c, invoices, healthActivity, healthRequests)
    const p = portal?.get(c.id)
    return { c, stage, health, revenue: revenueOf(c, invoices), out: outstandingOf(c, invoices), projects: projects.filter(pr => pr.clientId === c.id).length, portal: portal === null || portal === undefined ? null : (p?.status ?? 'none') as PortalStatus }
  }), [clients, invoices, projects, healthActivity, healthRequests, portal])
  type Row = typeof rows[number]
  const FILTERS: Record<BaseTab, (r: Row) => boolean> = {
    all: () => true,
    active: r => r.stage === 'active',
    attention: r => r.health?.level === 'risk' || r.health?.level === 'watch' || r.out > 0.005,
    autopay: r => r.stage === 'active' && r.portal !== 'autopay',
  }
  const base = rows.filter(r => !search || `${r.c.name} ${r.c.email ?? ''} ${r.c.company ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  const listRows = base.filter(FILTERS[tab])
  const totalOut = rows.reduce((s, r) => s + r.out, 0)
  const activeCount = rows.filter(r => r.stage === 'active').length

  function pickBase(k: BaseTab) { setTab(k); setSavedId(null) }
  function pickSaved(v: SavedView<ViewFilters>) { setTab(v.filters.tab); setSearch(v.filters.q); setSavedId(v.id) }
  function saveView() {
    const name = (naming || '').trim(); if (!name) return
    const v: SavedView<ViewFilters> = { id: crypto.randomUUID(), name, filters: { tab, q: search } }
    const next = [...views, v]
    if (!storeViews('clients', userId, next)) { setError('This browser would not save the view (private window or storage full).'); return }
    setViews(next); setSavedId(v.id); setNaming(null); setNotice(`View "${name}" saved. It only shows for you, on this browser.`)
  }
  function deleteView(id: string) {
    const next = views.filter(v => v.id !== id)
    storeViews('clients', userId, next); setViews(next); if (savedId === id) setSavedId(null)
  }
  const rowMenu = (r: Row) => [
    { label: 'Open profile', onClick: () => navigate(`/clients/${r.c.id}`) },
    { label: 'Activity log', onClick: () => setActivityClient(r.c) },
    { label: 'Send reminder', onClick: () => void remind(r.c), hidden: !(r.out > 0 && r.c.email) },
    { label: 'Edit', onClick: () => setForm({ client: r.c }) },
    'sep' as const,
    { label: 'Delete client', danger: true, onClick: () => setConfirmDelete(r.c) },
  ]
  const healthCell = (r: Row) => r.health
    ? <span className="crm-health" title={r.health.reasons.join(' · ') || 'All good'}><span className={`dot dot--${HEALTH_TONE[r.health.level]}`} />{r.health.label}</span>
    : <span className="crm-health soft"><span className="dot crm-dot--none" />—</span>
  const portalCell = (r: Row) => r.portal ? <span className={`crm-portal ${PORTAL_CLASS[r.portal]}`}>{PORTAL_LABEL[r.portal]}</span> : <span className="soft">—</span>

  return (
    <div className="page crm-page">
      <PageHeader
        title="Clients"
        sub={`${clients.length} client${clients.length === 1 ? '' : 's'} · ${activeCount} active · ${usd(totalOut, { cents: false })} outstanding`}
        actions={<>
          <SearchInput value={search} onChange={v => { setSearch(v); setSavedId(null) }} placeholder="Search clients" width={mobile ? '100%' : 220} />
          <Segmented label="View" value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'pipeline', label: 'Pipeline' }]} />
          <button type="button" className="btn btn--primary" onClick={() => setForm({ client: null })}>+ Add client</button>
        </>}
      />
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner tone="success" onClose={() => setNotice(null)}>{notice}</Banner>}

      {view === 'list' && <>
        <div className="tabs crm-views" role="tablist" aria-label="Saved views">
          {BASE_TABS.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={!savedId && tab === t.key} className={`tab${!savedId && tab === t.key ? ' tab--on' : ''}`} onClick={() => pickBase(t.key)}>
              {t.label}<span className="tab__count">{base.filter(FILTERS[t.key]).length}</span>
            </button>
          ))}
          {views.map(v => (
            <span key={v.id} className="crm-saved-tab">
              <button type="button" role="tab" aria-selected={savedId === v.id} className={`tab${savedId === v.id ? ' tab--on' : ''}`} onClick={() => pickSaved(v)}>{v.name}</button>
              {savedId === v.id && <button type="button" className="crm-saved-tab__x" aria-label={`Delete view ${v.name}`} title="Delete this view" onClick={() => deleteView(v.id)}>×</button>}
            </span>
          ))}
          <button type="button" className="tab crm-save-view" onClick={() => setNaming('')}>+ Save view</button>
        </div>

        {!loaded ? (
          <div className="table-card crm-skel">{[0, 1, 2, 3, 4].map(i => <div key={i} className="crm-skel__row"><Skel w={34} h={34} r={10} /><Skel w="30%" /><Skel w="12%" /><Skel w="14%" /></div>)}</div>
        ) : listRows.length === 0 ? (
          <div className="card card-empty">{search || tab !== 'all' ? 'No clients match this view.' : 'No clients yet. Add your first.'}</div>
        ) : mobile ? (
          <div className="mcards">
            {listRows.map(r => (
              <div key={r.c.id} className="mcard crm-mclient" role="button" tabIndex={0} onClick={() => navigate(`/clients/${r.c.id}`)} onKeyDown={onEnter(() => navigate(`/clients/${r.c.id}`))}>
                <span className={`crm-av crm-av--lg ${avatarTone(r.c.name)}`}>{initials(r.c.name)}</span>
                <div className="crm-mclient__main">
                  <span className="crm-mclient__name">{r.c.name}</span>
                  <span className="crm-mclient__meta">{r.health ? <><span className={`dot dot--${HEALTH_TONE[r.health.level]}`} />{r.health.label}</> : stageLabel(r.stage)} · {r.projects} project{r.projects === 1 ? '' : 's'}</span>
                  {contractNote(r.c) && <span className={`crm-mclient__warn t-${contractNote(r.c)!.tone}`}>{contractNote(r.c)!.text}</span>}
                </div>
                <div className="crm-mclient__out"><span className={`num ${r.out > 0 ? 't-danger' : 'soft'}`}>{r.out > 0 ? usd(r.out, { cents: false }) : '—'}</span><span className="crm-mclient__outlbl">outstanding</span></div>
                <Menu items={rowMenu(r)} label={`Actions for ${r.c.name}`} buttonClass="btn btn--icon btn--ghost" />
              </div>
            ))}
          </div>
        ) : (
          <div className="table-card">
            <table className="table crm-clients-table">
              <thead><tr><th>Client</th><th>Stage</th><th>Health</th><th>Projects</th><th className="t-right">Revenue</th><th className="t-right">Outstanding</th><th>Terms</th><th>Portal</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {listRows.map(r => {
                  const cn = contractNote(r.c)
                  return (
                    <tr key={r.c.id} className="is-clickable" onClick={() => navigate(`/clients/${r.c.id}`)}>
                      <td>
                        <div className="crm-client-cell">
                          <span className={`crm-av ${avatarTone(r.c.name)}`}>{r.c.photoUrl ? <img src={r.c.photoUrl} alt="" /> : initials(r.c.name)}</span>
                          <div className="crm-client-cell__text">
                            <span className="crm-client-cell__name">{r.c.name}</span>
                            <span className="crm-client-cell__sub">{r.c.email || 'No email'}</span>
                            {cn && <span className={`crm-client-cell__warn t-${cn.tone}`}>{cn.text}</span>}
                          </div>
                        </div>
                      </td>
                      <td><Pill status={r.stage}>{stageLabel(r.stage)}</Pill></td>
                      <td>{healthCell(r)}</td>
                      <td className="crm-td-2">{r.projects}</td>
                      <td className="t-num crm-td-strong">{r.revenue ? usdShort(r.revenue) : '—'}</td>
                      <td className={`t-num crm-td-out ${r.out > 0 ? 't-danger' : 'soft'}`}>{r.out > 0 ? usd(r.out, { cents: false }) : '—'}</td>
                      <td className="muted">{r.c.paymentTerms || '—'}</td>
                      <td>{portalCell(r)}</td>
                      <td className="t-actions" onClick={e => e.stopPropagation()}><Menu items={rowMenu(r)} label={`Actions for ${r.c.name}`} buttonClass="btn btn--icon btn--ghost btn--sm" /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </>}

      {view === 'pipeline' && (
        <div className="kanban crm-board crm-board--clients">
          {CLIENT_STAGES.map(({ key, label }) => {
            const list = base.filter(r => r.stage === key)
            return (
              <div key={key} className={`kanban__col crm-col${dragId ? ' kanban__col--drop' : ''}`} data-stage={key} onDragOver={e => e.preventDefault()} onDrop={() => { if (dragId) void moveStage(dragId, key); setDragId(null) }}>
                <div className="crm-col__head"><span className={`dot ${STAGE_DOT[key]}`} /><span className="crm-col__label">{label}</span><span className="crm-col__count">{list.length}</span></div>
                {list.map(r => (
                  <div key={r.c.id} className="kanban__card crm-ccard" draggable role="button" tabIndex={0} onDragStart={() => setDragId(r.c.id)} onDragEnd={() => setDragId(null)} onClick={() => navigate(`/clients/${r.c.id}`)} onKeyDown={onEnter(() => navigate(`/clients/${r.c.id}`))}>
                    <div className="crm-ccard__top"><span className="crm-lead__name">{r.c.name}</span><Menu items={rowMenu(r)} label={`Actions for ${r.c.name}`} buttonClass="btn btn--icon btn--ghost btn--xs" /></div>
                    <span className="crm-lead__meta">{r.c.email || 'No email'}</span>
                    {normTags(r.c.tags).length > 0 && <div className="crm-tagrow">{normTags(r.c.tags).map(t => <TagBadge key={t} label={t} color={tagColor(t)} />)}</div>}
                    {(r.c.links ?? []).length > 0 && <div className="crm-tagrow">{(r.c.links ?? []).map((lk, i) => <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" className="crm-linkpill" onClick={e => e.stopPropagation()}>{lk.label}</a>)}</div>}
                  </div>
                ))}
                {list.length === 0 && <div className="kanban__empty">Drop here</div>}
              </div>
            )
          })}
        </div>
      )}

      <ClientFormDrawer open={!!form} client={form?.client ?? null} allTags={allTags} onTagCreated={handleTagCreated} onClose={() => setForm(null)} onSave={saveForm} />
      <ClientActivityModal client={activityClient} onClose={() => setActivityClient(null)} />
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={`Remove ${confirmDelete?.name ?? 'client'}?`} sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button><button type="button" className="btn btn--danger" onClick={() => confirmDelete && void doDelete(confirmDelete)}>Remove</button></>} />
      <Modal open={naming !== null} onClose={() => setNaming(null)} title="Save this view" sub={`Saves the "${BASE_TABS.find(t => t.key === tab)?.label}" filter${search ? ` and the search "${search}"` : ''}. Only you see it.`}
        footer={<><button type="button" className="btn" onClick={() => setNaming(null)}>Cancel</button><button type="button" className="btn btn--primary" disabled={!naming?.trim()} onClick={saveView}>Save view</button></>}>
        <Field label="View name"><input className="input" aria-label="View name" autoFocus value={naming ?? ''} onChange={e => setNaming(e.target.value)} onKeyDown={onEnter(saveView)} placeholder="e.g. Law firms owing money" /></Field>
      </Modal>
    </div>
  )
}
