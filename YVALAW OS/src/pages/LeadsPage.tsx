import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission, useRole } from '../context/RoleContext'
import { addActivity, completeActivity, convertLead, deleteLead, importLeads, loadActivities, loadLeads, loadStaff, saveLead, STAGES, updateLead, type Lead, type LeadActivity, type LeadStage } from '../services/crm'
import { localParts } from '../utils/moneyRules'
import { csvToLeads } from '../utils/csv'
import { Banner, Chips, Drawer, Field, PageHeader, Pill, SearchInput, Segmented, Skel, onEnter, useIsMobile, type Tone } from '../components/ui'
import { Ic, P } from '../components/Icon'
import { dateShort, usdShort } from '../utils/format'

const SERVICES = ['Legal Intake', 'Legal Assistants', 'Demand Writing', 'Case Managers', 'Other']
const KIND_LABEL: Record<LeadActivity['kind'], string> = { note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting', whatsapp: 'WhatsApp', follow_up: 'Follow-up', system: 'YVA OS' }
const KIND_TONE: Record<LeadActivity['kind'], Tone> = { note: 'neutral', call: 'info', email: 'viewed', meeting: 'success', whatsapp: 'success', follow_up: 'warning', system: 'neutral' }
const STAGE_DOT: Record<LeadStage, string> = { new: 'crm-dot--new', contacted: 'crm-dot--contacted', meeting: 'crm-dot--meeting', proposal: 'crm-dot--proposal', won: 'crm-dot--won', lost: 'crm-dot--lost' }
const empty = (): Partial<Lead> & { name: string } => ({ name: '', email: '', phone: '', company: '', service: 'Legal Intake', source: 'Manual', stage: 'new' })
const closed = (s: LeadStage) => s === 'won' || s === 'lost'

/** "5h", "3d", "2w", "1mo" since the lead arrived */
function age(iso: string) {
  const h = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 3600000))
  if (h < 1) return 'now'
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  if (d < 30) return `${Math.floor(d / 7)}w`
  return `${Math.floor(d / 30)}mo`
}
/** Staff email → initials ("lina.r@…" → "LR", "hans@…" → "HA") */
function emailInitials(email?: string) {
  const local = (email || '').split('@')[0]
  const parts = local.split(/[._-]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)).toUpperCase() || '—'
}

/** CRM → Leads: pipeline with an owner per lead, follow-ups, won → client + project (Step 9; redesign 2026-11) */
export default function LeadsPage() {
  const allowed = usePermission()
  const { userId } = useRole()
  const navigate = useNavigate()
  const mobile = useIsMobile()
  const [params, setParams] = useSearchParams()
  const canAll = allowed('leads.view_all'), canManage = allowed('leads.manage')
  const today = localParts(Date.now()).date
  const [leads, setLeads] = useState<Lead[]>([])
  const [loaded, setLoaded] = useState(false)
  const [staff, setStaff] = useState<{ user_id: string; email: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; clientId?: string } | null>(null)
  const [search, setSearch] = useState('')
  const [mine, setMine] = useState(!canAll)
  const [mStage, setMStage] = useState<LeadStage>('new')
  const [open, setOpen] = useState<(Partial<Lead> & { name: string }) | null>(null)
  const [acts, setActs] = useState<LeadActivity[]>([])
  const [act, setAct] = useState<{ kind: LeadActivity['kind']; body: string; dueOn: string }>({ kind: 'note', body: '', dueOn: '' })
  const [convert, setConvert] = useState<{ clientName: string; projectName: string; rate: string; terms: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<LeadStage | null>(null)
  const [converting, setConverting] = useState(false)
  const [saving, setSaving] = useState(false)
  const convertingRef = useRef(false)   // state updates are async: a fast double-click would pass a state check twice
  // Permissions arrive after the first render for non-CEO roles: follow leads.view_all once it is known
  useEffect(() => { setMine(!canAll) }, [canAll])

  async function load() { const r = await loadLeads(); setLeads(r.rows); setError(r.error); setLoaded(true); return r.rows }
  // Import older leads from a CSV (Netlify → Forms → lead-backup → Download as CSV, or any spreadsheet with name/email columns)
  const importInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  async function importCsv(file: File) {
    setNotice(null); setError(null)
    try {
      const { leads: rows, columns } = csvToLeads(await file.text())
      if (!rows.length) { setError('No leads found in that file. It needs a header row with at least a name or email column.'); return }
      if (!window.confirm(`Import ${rows.length} lead${rows.length === 1 ? '' : 's'} from "${file.name}"?\nColumns used: ${columns.join(', ')}.\nPeople already in your list are skipped.`)) return
      setImporting(true)
      let added = 0
      for (let i = 0; i < rows.length; i += 500) added += await importLeads(rows.slice(i, i + 500))
      setNotice({ text: `${added} lead${added === 1 ? '' : 's'} added from ${file.name}${rows.length - added ? ` · ${rows.length - added} already in the list (or repeated in the file) skipped` : ''}.` })
      await load()
    } catch (e) { setError(`Import failed: ${(e as Error).message}`) }
    setImporting(false)
  }
  useEffect(() => {
    void load().then(rows => {
      // Deep links from the Create menu (?create=1) and search (?open=<id>)
      const create = params.get('create'), openId = params.get('open')
      if (create) { setConvert(null); setOpen(empty()) }
      else if (openId) { const l = rows.find(x => x.id === openId); if (l) setOpen(l) }
      if (create || openId) setParams({}, { replace: true })
    })
    void loadStaff().then(setStaff)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open?.id) void loadActivities(open.id).then(setActs); else setActs([]) }, [open?.id])

  const shown = useMemo(() => leads.filter(l => (!mine || l.owner_id === userId) &&
    (!search || [l.name, l.company, l.email, l.phone, l.service, l.source].some(v => (v || '').toLowerCase().includes(search.toLowerCase())))), [leads, mine, search, userId])
  const ownerEmail = (id: string | null) => staff.find(s => s.user_id === id)?.email
  const ownerLabel = (id: string | null) => ownerEmail(id)?.split('@')[0] ?? (id ? 'Someone' : 'Unassigned')
  const openList = shown.filter(l => !closed(l.stage))
  const openValue = openList.reduce((x, l) => x + (Number(l.value_monthly) || 0), 0)
  const closeDrawer = () => { setOpen(null); setConvert(null) }
  const startConvert = (l: Partial<Lead> & { name: string }) => setConvert({ clientName: l.company || l.name, projectName: l.service ? `${l.service} team` : 'New team', rate: '', terms: 'Net 7' })

  async function save() {
    if (!open || saving) return
    setSaving(true); setError(null)
    try { const saved = await saveLead({ ...open, owner_id: open.owner_id ?? (canManage ? null : userId) }); setOpen(saved); await load(); setNotice({ text: `${saved.name} saved.` }) }
    catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  async function move(id: string, stage: LeadStage) {
    const l = leads.find(x => x.id === id); if (!l || l.stage === stage) return
    if (stage === 'won') { setOpen(l); startConvert(l); return }
    let patch: Partial<Lead> = { stage }
    if (stage === 'lost') {
      const reason = window.prompt('Why was it lost? (optional)')
      if (reason === null) return   // Cancel = don't move the lead
      patch = { stage, lost_reason: reason.trim() || null }
    }
    setLeads(prev => prev.map(x => (x.id === id ? { ...x, ...patch } : x)))   // optimistic; load() below puts back the truth
    try { await updateLead(id, patch) } catch (e) { setError((e as Error).message) }
    await addActivity({ leadId: id, kind: 'system', body: `Moved to ${STAGES.find(s => s.key === stage)?.label}` }).catch(() => {})
    await load()
  }
  async function addAct() {
    if (!open?.id || !act.body.trim()) return
    try {
      await addActivity({ leadId: open.id, kind: act.kind, body: act.body, dueOn: act.dueOn || null })
      if (act.kind === 'follow_up' && act.dueOn) await updateLead(open.id, { next_follow_up: act.dueOn })
      setAct({ kind: 'note', body: '', dueOn: '' }); setActs(await loadActivities(open.id)); await load()
    } catch (e) { setError((e as Error).message) }
  }
  async function doneAct(a: LeadActivity) {
    try { await completeActivity(a.id); if (open?.id) setActs(await loadActivities(open.id)) } catch (e) { setError((e as Error).message) }
  }
  async function doConvert() {
    if (!open?.id || !convert || convertingRef.current) return
    if ((open as Lead).client_id) { setError('This lead was already converted — its client and project exist. Open the client from Clients instead.'); return }
    const rate = convert.rate.trim() ? Number(convert.rate.trim().replace(',', '.')) : null
    if (rate !== null && !(rate >= 0)) { setError('Enter the bill rate as a number, e.g. 10.50.'); return }
    convertingRef.current = true; setConverting(true); setError(null)
    try {
      const r = await convertLead(open as Lead, { clientName: convert.clientName, projectName: convert.projectName, rate, paymentTerms: convert.terms })
      setNotice({ text: `${convert.clientName} is now a client. Project and contact created.`, clientId: r.clientId })
      setConvert(null); setOpen(null); await load()
    } catch (e) { setError((e as Error).message) }
    finally { convertingRef.current = false; setConverting(false) }
  }
  async function remove() {
    if (!open?.id || !window.confirm('Delete this lead?')) return
    try { await deleteLead(open.id); setOpen(null); await load() } catch (e) { setError((e as Error).message) }
  }

  const followUp = (l: Lead): { text: string; tone: Tone } | null => {
    if (!l.next_follow_up || closed(l.stage)) return null
    if (l.next_follow_up < today) return { text: 'Follow-up overdue', tone: 'danger' }
    if (l.next_follow_up === today) return { text: 'Follow up today', tone: 'warning' }
    return { text: `Follow up ${dateShort(l.next_follow_up)}`, tone: 'neutral' }
  }
  const leadCard = (l: Lead) => {
    const fu = followUp(l)
    return (
      <button key={l.id} type="button" className="kanban__card crm-lead" draggable onDragStart={() => setDragId(l.id)} onDragEnd={() => { setDragId(null); setOverCol(null) }} onClick={() => { setConvert(null); setOpen(l) }}>
        <span className="crm-lead__top"><span className="crm-lead__name">{l.name}</span>{l.value_monthly ? <span className="crm-lead__value num">{usdShort(Number(l.value_monthly))}/mo</span> : null}</span>
        {l.company && <span className="crm-lead__company">{l.company}</span>}
        {(l.service || l.source) && <span className="crm-lead__meta">{[l.service, l.source].filter(Boolean).join(' · ')}</span>}
        <span className="crm-lead__foot">
          <span className="crm-owner" title={`Owner: ${ownerLabel(l.owner_id)}`}>{l.owner_id ? emailInitials(ownerEmail(l.owner_id)) : '—'}</span>
          <span className="crm-lead__age">{age(l.created_at)}</span>
          {l.calendly_booked && <span className="crm-tag crm-tag--info">Call booked</span>}
          {fu && <span className={`crm-tag crm-tag--${fu.tone}`}>{fu.text}</span>}
        </span>
      </button>
    )
  }
  const mobileList = shown.filter(l => l.stage === mStage)
  const set = (patch: Partial<Lead>) => setOpen(o => (o ? { ...o, ...patch } : o))
  const existing = !!open?.id
  const openLead = open as Lead | null

  return (
    <div className="page crm-page">
      <PageHeader
        title="Leads"
        sub={`${openList.length} open · ${usdShort(openValue)}/mo in pipeline · website leads arrive here automatically`}
        actions={<>
          <SearchInput value={search} onChange={setSearch} placeholder="Search leads" width={mobile ? '100%' : 220} />
          {canAll && <Segmented label="Whose leads" value={mine ? 'mine' : 'all'} onChange={v => setMine(v === 'mine')} options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }]} />}
          {canManage && <>
            <input ref={importInput} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importCsv(f) }} />
            <button type="button" className="btn" disabled={importing} onClick={() => importInput.current?.click()} title="Add older leads from a CSV file, e.g. Netlify → Forms → lead-backup → Download as CSV">{importing ? 'Importing…' : 'Import CSV'}</button>
          </>}
          <button type="button" className="btn btn--primary" onClick={() => { setConvert(null); setOpen(empty()) }}>+ New lead</button>
        </>}
      />
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      {notice && <Banner tone="success" onClose={() => setNotice(null)} action={notice.clientId ? <button type="button" className="btn btn--sm" onClick={() => navigate(`/clients/${notice.clientId}`)}>Open client</button> : undefined}>{notice.text}</Banner>}

      {!loaded ? (
        <div className="kanban crm-board">{STAGES.map(s => <div key={s.key} className="kanban__col"><Skel h={18} w="60%" /><Skel h={92} r={12} /><Skel h={92} r={12} /></div>)}</div>
      ) : mobile ? (
        <>
          <Chips value={mStage} onChange={setMStage} options={STAGES.map(s => ({ value: s.key, label: s.label, count: shown.filter(l => l.stage === s.key).length }))} />
          <div className="mcards">
            {mobileList.map(l => {
              const fu = followUp(l)
              return (
                <button key={l.id} type="button" className="mcard crm-mlead" onClick={() => { setConvert(null); setOpen(l) }}>
                  <span className="mcard__top"><span className="crm-mlead__name">{l.name}</span>{l.value_monthly ? <span className="crm-lead__value num">{usdShort(Number(l.value_monthly))}/mo</span> : null}</span>
                  <span className="mcard__meta">{[l.company, l.service].filter(Boolean).join(' · ') || l.email}</span>
                  {fu && <span className={`crm-tag crm-tag--${fu.tone} crm-tag--start`}>{fu.text}</span>}
                </button>
              )
            })}
            {mobileList.length === 0 && <div className="card card-empty">No leads in this stage.</div>}
          </div>
        </>
      ) : (
        <div className="kanban crm-board">
          {STAGES.map(s => {
            const list = shown.filter(l => l.stage === s.key), value = list.reduce((x, l) => x + (Number(l.value_monthly) || 0), 0)
            return (
              <div key={s.key} className={`kanban__col crm-col${dragId ? ' kanban__col--drop' : ''}${overCol === s.key ? ' crm-col--over' : ''}`} data-stage={s.key}
                onDragOver={e => { e.preventDefault(); if (overCol !== s.key) setOverCol(s.key) }}
                onDrop={() => { if (dragId) void move(dragId, s.key); setDragId(null); setOverCol(null) }}>
                <div className="crm-col__head">
                  <span className={`dot ${STAGE_DOT[s.key]}`} />
                  <span className="crm-col__label">{s.label}</span>
                  <span className="crm-col__count">{list.length}</span>
                  <span className="spacer" />
                  {value > 0 && <span className="crm-col__value mono">{usdShort(value)}/mo</span>}
                </div>
                {list.map(leadCard)}
                {list.length === 0 && <div className="kanban__empty">Drop here</div>}
              </div>
            )
          })}
        </div>
      )}

      <Drawer
        open={!!open}
        onClose={closeDrawer}
        title={existing ? open!.name || 'Lead' : 'New lead'}
        sub={existing && openLead ? `${[openLead.company, `added ${age(openLead.created_at) === 'now' ? 'just now' : `${age(openLead.created_at)} ago`}`, openLead.source && `via ${openLead.source}`].filter(Boolean).join(' · ')}` : 'Website leads are added automatically'}
        footer={open && <>
          {existing && canManage && <button type="button" className="btn btn--ghost btn--danger" onClick={() => void remove()}>Delete</button>}
          <span className="spacer" />
          {existing && openLead?.client_id && <button type="button" className="btn" onClick={() => navigate(`/clients/${openLead.client_id}`)}>Open client</button>}
          {existing && open.stage !== 'won' && !convert && <button type="button" className="btn" onClick={() => startConvert(open)}>Mark won…</button>}
          <button type="button" className="btn btn--primary" disabled={!open.name?.trim() || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
        </>}
      >
        {open && <>
          {existing && open.email && (
            <div className="row row--wrap">
              <a className="btn" href={`mailto:${open.email}`}><Ic d={P.mail} size={15} />Email</a>
              {open.phone && <a className="btn" href={`https://wa.me/${open.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><Ic d={P.whatsapp} size={15} />WhatsApp</a>}
              {open.phone && <a className="btn" href={`tel:${open.phone}`}><Ic d={P.call} size={15} />Call</a>}
            </div>
          )}
          <div className="form-grid">
            {(['name', 'company', 'email', 'phone'] as const).map(k => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input aria-label={k} className="input" value={(open[k] as string) ?? ''} onChange={e => set({ [k]: e.target.value })} /></Field>
            ))}
            <Field label="Service"><select aria-label="Service" className="select" value={open.service ?? ''} onChange={e => set({ service: e.target.value })}>{SERVICES.map(s => <option key={s}>{s}</option>)}{open.service && !SERVICES.includes(open.service) && <option>{open.service}</option>}</select></Field>
            <Field label="Stage"><select aria-label="Stage" className="select" value={open.stage ?? 'new'} onChange={e => set({ stage: e.target.value as LeadStage })}>{STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
            <Field label="Owner" hint={canManage ? undefined : 'Only people who manage leads can reassign'}><select aria-label="Owner" className="select" disabled={!canManage} value={open.owner_id ?? ''} onChange={e => set({ owner_id: e.target.value || null })}>
              <option value="">Unassigned</option>{staff.map(s => <option key={s.user_id} value={s.user_id}>{s.email}</option>)}</select></Field>
            <Field label="Monthly value ($)"><input aria-label="Monthly value" className="input" inputMode="decimal" value={open.value_monthly ?? ''} onChange={e => set({ value_monthly: e.target.value as unknown as number })} /></Field>
            <Field label="Next follow-up"><input aria-label="Next follow-up" className="input" type="date" value={open.next_follow_up ?? ''} onChange={e => set({ next_follow_up: e.target.value || null })} /></Field>
            <Field label="Source"><input aria-label="Source" className="input" value={open.source ?? ''} onChange={e => set({ source: e.target.value })} /></Field>
            <Field label="Message / notes" full><textarea aria-label="Message" className="textarea" rows={3} value={open.message ?? ''} onChange={e => set({ message: e.target.value })} /></Field>
          </div>
          {existing && openLead?.utm && Object.keys(openLead.utm).length > 0 && <div className="crm-utm mono">Ad tracking: {Object.entries(openLead.utm).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>}
          {existing && openLead?.stage === 'lost' && openLead.lost_reason && <div className="crm-utm">Lost because: {openLead.lost_reason}</div>}

          {convert && existing && (
            <div className="crm-convert">
              <div><div className="crm-convert__title">Won: create the client and project</div><div className="crm-convert__sub">Creates a client, a project and a contact from this lead.</div></div>
              <div className="form-grid">
                <Field label="Client name"><input aria-label="Client name" className="input" value={convert.clientName} onChange={e => setConvert({ ...convert, clientName: e.target.value })} /></Field>
                <Field label="Project name"><input aria-label="Project name" className="input" value={convert.projectName} onChange={e => setConvert({ ...convert, projectName: e.target.value })} /></Field>
                <Field label="Bill rate ($/hr)"><input aria-label="Bill rate" className="input" inputMode="decimal" value={convert.rate} onChange={e => setConvert({ ...convert, rate: e.target.value })} /></Field>
                <Field label="Payment terms"><input aria-label="Payment terms" className="input" value={convert.terms} onChange={e => setConvert({ ...convert, terms: e.target.value })} /></Field>
              </div>
              <div className="row row--wrap">
                <button type="button" className="btn btn--primary" disabled={converting || !convert.clientName.trim() || !convert.projectName.trim()} onClick={() => void doConvert()}>{converting ? 'Creating…' : 'Create client + project'}</button>
                <button type="button" className="btn" onClick={() => setConvert(null)}>Cancel</button>
              </div>
            </div>
          )}

          {existing && (
            <div className="stack">
              <h3 className="card__title">Activity</h3>
              <div className="crm-act-form">
                <select aria-label="Activity type" className="select crm-act-form__kind" value={act.kind} onChange={e => setAct({ ...act, kind: e.target.value as LeadActivity['kind'] })}>
                  {(['note', 'call', 'email', 'meeting', 'whatsapp', 'follow_up'] as const).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
                {act.kind === 'follow_up' && <input aria-label="Follow-up date" className="input crm-act-form__date" type="date" value={act.dueOn} onChange={e => setAct({ ...act, dueOn: e.target.value })} />}
                <input aria-label="Activity" className="input crm-act-form__body" placeholder={act.kind === 'follow_up' ? 'What to do (you get a reminder that morning)' : 'What happened?'} value={act.body} onChange={e => setAct({ ...act, body: e.target.value })} onKeyDown={onEnter(() => void addAct())} />
                <button type="button" className="btn btn--primary" onClick={() => void addAct()}>Add</button>
              </div>
              <div>
                {acts.map(a => (
                  <div key={a.id} className="crm-act">
                    <Pill tone={a.kind === 'follow_up' && a.done_at ? 'success' : KIND_TONE[a.kind]}>{KIND_LABEL[a.kind]}{a.due_on ? ` · ${a.due_on === today && !a.done_at ? 'due today' : dateShort(a.due_on)}` : ''}{a.kind === 'follow_up' && a.done_at ? ' · done' : ''}</Pill>
                    <span className="crm-act__body">{a.body}</span>
                    <span className="crm-act__when">{dateShort(a.created_at)}</span>
                    {a.kind === 'follow_up' && !a.done_at && <button type="button" className="btn btn--xs" onClick={() => void doneAct(a)}>Done</button>}
                  </div>
                ))}
                {acts.length === 0 && <div className="crm-muted-line">No activity yet. Log a call, email or note above.</div>}
              </div>
            </div>
          )}
        </>}
      </Drawer>
    </div>
  )
}
