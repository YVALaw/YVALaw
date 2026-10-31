import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission, useRole } from '../context/RoleContext'
import { addActivity, completeActivity, convertLead, deleteLead, loadActivities, loadLeads, loadStaff, saveLead, STAGES, updateLead, type Lead, type LeadActivity, type LeadStage } from '../services/crm'
import { localParts } from '../utils/moneyRules'

const SERVICES = ['Legal Intake', 'Legal Assistants', 'Demand Writing', 'Case Managers', 'Other']
const KIND_LABEL: Record<LeadActivity['kind'], string> = { note: 'Note', call: 'Call', email: 'Email', meeting: 'Meeting', whatsapp: 'WhatsApp', follow_up: 'Follow-up', system: 'YVA OS' }
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const ago = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }
const empty = (): Partial<Lead> & { name: string } => ({ name: '', email: '', phone: '', company: '', service: 'Legal Intake', source: 'Manual', stage: 'new' })

/** CRM → Leads: pipeline with an owner per lead, follow-ups, won → client + project (Step 9) */
export default function LeadsPage() {
  const allowed = usePermission()
  const { userId } = useRole()
  const navigate = useNavigate()
  const canAll = allowed('leads.view_all'), canManage = allowed('leads.manage')
  const today = localParts(Date.now()).date
  const [leads, setLeads] = useState<Lead[]>([])
  const [staff, setStaff] = useState<{ user_id: string; email: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [mine, setMine] = useState(!canAll)
  const [open, setOpen] = useState<(Partial<Lead> & { name: string }) | null>(null)
  const [acts, setActs] = useState<LeadActivity[]>([])
  const [act, setAct] = useState<{ kind: LeadActivity['kind']; body: string; dueOn: string }>({ kind: 'note', body: '', dueOn: '' })
  const [convert, setConvert] = useState<{ clientName: string; projectName: string; rate: string; terms: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const convertingRef = useRef(false)   // state updates are async: a fast double-click would pass a state check twice
  // Permissions arrive after the first render for non-CEO roles: follow leads.view_all once it is known
  useEffect(() => { setMine(!canAll) }, [canAll])

  async function load() { const r = await loadLeads(); setLeads(r.rows); setError(r.error) }
  useEffect(() => { void load(); void loadStaff().then(setStaff) }, [])
  useEffect(() => { if (open?.id) void loadActivities(open.id).then(setActs); else setActs([]) }, [open?.id])

  const shown = useMemo(() => leads.filter(l => (!mine || l.owner_id === userId) &&
    (!search || [l.name, l.company, l.email, l.phone, l.service, l.source].some(v => (v || '').toLowerCase().includes(search.toLowerCase())))), [leads, mine, search, userId])
  const owner = (id: string | null) => staff.find(s => s.user_id === id)?.email?.split('@')[0] ?? (id ? 'Someone' : 'Unassigned')

  async function save() {
    if (!open) return
    try { const saved = await saveLead({ ...open, owner_id: open.owner_id ?? (canManage ? null : userId) }); setOpen(saved); await load() } catch (e) { setError((e as Error).message) }
  }
  async function move(id: string, stage: LeadStage) {
    const l = leads.find(x => x.id === id); if (!l || l.stage === stage) return
    if (stage === 'won') { setOpen(l); setConvert({ clientName: l.company || l.name, projectName: l.service ? `${l.service} team` : 'New team', rate: '', terms: 'Net 7' }); return }
    if (stage === 'lost') {
      const reason = window.prompt('Why was it lost? (optional)')
      if (reason === null) return   // Cancel = don't move the lead
      await updateLead(id, { stage, lost_reason: reason.trim() || null }).catch(e => setError(e.message))
    }
    else await updateLead(id, { stage }).catch(e => setError(e.message))
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
  async function doConvert() {
    if (!open?.id || !convert || convertingRef.current) return
    if ((open as Lead).client_id) { setError('This lead was already converted — its client and project exist. Open the client from Clients instead.'); return }
    const rate = convert.rate.trim() ? Number(convert.rate.trim().replace(',', '.')) : null
    if (rate !== null && !(rate >= 0)) { setError('Enter the bill rate as a number, e.g. 10.50.'); return }
    convertingRef.current = true; setConverting(true); setError(null)
    try {
      const r = await convertLead(open as Lead, { clientName: convert.clientName, projectName: convert.projectName, rate, paymentTerms: convert.terms })
      setConvert(null); setOpen(null); await load()
      if (window.confirm('Client and project created. Open the client now?')) navigate(`/clients/${r.clientId}`)
    } catch (e) { setError((e as Error).message) }
    finally { convertingRef.current = false; setConverting(false) }
  }

  const totals = (stage: LeadStage) => shown.filter(l => l.stage === stage)
  return (
    <div className="page-wrap">
      <div className="page-header">
        <div className="page-header-left"><h1 className="page-title">Leads</h1><p className="page-sub">{shown.filter(l => !['won', 'lost'].includes(l.stage)).length} open · website leads arrive here automatically</p></div>
        <div className="page-header-actions">
          <input aria-label="Search leads" className="form-input" style={{ width: 200 }} placeholder="Search leads…" value={search} onChange={e => setSearch(e.target.value)} />
          {canAll && <div className="view-toggle"><button className={`view-toggle-btn${!mine ? ' active' : ''}`} onClick={() => setMine(false)}>All</button><button className={`view-toggle-btn${mine ? ' active' : ''}`} onClick={() => setMine(true)}>Mine</button></div>}
          <button className="btn-primary" onClick={() => setOpen(empty())}>+ New lead</button>
        </div>
      </div>
      {error && <div className="portal-message portal-message-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="lead-board">
        {STAGES.map(s => {
          const list = totals(s.key), value = list.reduce((x, l) => x + (Number(l.value_monthly) || 0), 0)
          return (
            <div key={s.key} className="lead-col" onDragOver={e => e.preventDefault()} onDrop={() => { if (dragId) void move(dragId, s.key); setDragId(null) }}>
              <div className="lead-col-head"><strong>{s.label}</strong><span>{list.length}{value ? ` · ${usd(value)}/mo` : ''}</span></div>
              {list.map(l => (
                <button key={l.id} className="lead-card" draggable onDragStart={() => setDragId(l.id)} onClick={() => setOpen(l)}>
                  <strong>{l.name}</strong>
                  {l.company && <span>{l.company}</span>}
                  <span className="lead-meta">{[l.service, l.source].filter(Boolean).join(' · ')}</span>
                  <span className="lead-meta">{ago(l.created_at)} · {owner(l.owner_id)}{l.calendly_booked ? ' · 📅 booked' : ''}</span>
                  {l.next_follow_up && !['won', 'lost'].includes(l.stage) && <span className={`badge ${l.next_follow_up <= today ? 'badge-red' : 'badge-gray'}`} style={{ alignSelf: 'flex-start' }}>Follow up {l.next_follow_up <= today ? (l.next_follow_up < today ? 'overdue' : 'today') : l.next_follow_up}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => { setOpen(null); setConvert(null) }}>
          <div className="modal" style={{ maxWidth: 760, width: '96vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><div className="modal-title">{open.id ? open.name : 'New lead'}</div><button className="modal-close btn-icon" aria-label="Close" onClick={() => { setOpen(null); setConvert(null) }}>✕</button></div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="lead-form">
                {(['name', 'company', 'email', 'phone'] as const).map(k => (
                  <label key={k}>{k[0].toUpperCase() + k.slice(1)}<input aria-label={k} className="form-input" value={(open[k] as string) ?? ''} onChange={e => setOpen({ ...open, [k]: e.target.value })} /></label>
                ))}
                <label>Service<select aria-label="Service" className="form-select" value={open.service ?? ''} onChange={e => setOpen({ ...open, service: e.target.value })}>{SERVICES.map(s => <option key={s}>{s}</option>)}</select></label>
                <label>Stage<select aria-label="Stage" className="form-select" value={open.stage ?? 'new'} onChange={e => setOpen({ ...open, stage: e.target.value as LeadStage })}>{STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
                <label>Owner<select aria-label="Owner" className="form-select" disabled={!canManage} value={open.owner_id ?? ''} onChange={e => setOpen({ ...open, owner_id: e.target.value || null })}>
                  <option value="">Unassigned</option>{staff.map(s => <option key={s.user_id} value={s.user_id}>{s.email}</option>)}</select></label>
                <label>Monthly value ($)<input aria-label="Monthly value" className="form-input" inputMode="decimal" value={open.value_monthly ?? ''} onChange={e => setOpen({ ...open, value_monthly: e.target.value as unknown as number })} /></label>
                <label>Next follow-up<input aria-label="Next follow-up" className="form-input" type="date" value={open.next_follow_up ?? ''} onChange={e => setOpen({ ...open, next_follow_up: e.target.value || null })} /></label>
                <label>Source<input aria-label="Source" className="form-input" value={open.source ?? ''} onChange={e => setOpen({ ...open, source: e.target.value })} /></label>
                <label className="lead-wide">Message / notes<textarea aria-label="Message" className="form-input" rows={2} value={open.message ?? ''} onChange={e => setOpen({ ...open, message: e.target.value })} /></label>
              </div>
              {open.id && (open as Lead).utm && Object.keys((open as Lead).utm).length > 0 && <div className="td-muted" style={{ fontSize: 12 }}>Ad tracking: {Object.entries((open as Lead).utm).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>}
              {open.id && open.email && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn-ghost btn-sm" href={`mailto:${open.email}`}>Email</a>
                {open.phone && <a className="btn-ghost btn-sm" href={`https://wa.me/${open.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                {open.phone && <a className="btn-ghost btn-sm" href={`tel:${open.phone}`}>Call</a>}
              </div>}
              {convert && (
                <div className="data-card" style={{ background: 'var(--surf2)' }}>
                  <div className="data-card-title">Won — create the client and project</div>
                  <div className="lead-form">
                    <label>Client name<input aria-label="Client name" className="form-input" value={convert.clientName} onChange={e => setConvert({ ...convert, clientName: e.target.value })} /></label>
                    <label>Project name<input aria-label="Project name" className="form-input" value={convert.projectName} onChange={e => setConvert({ ...convert, projectName: e.target.value })} /></label>
                    <label>Bill rate ($/hr)<input aria-label="Bill rate" className="form-input" inputMode="decimal" value={convert.rate} onChange={e => setConvert({ ...convert, rate: e.target.value })} /></label>
                    <label>Payment terms<input aria-label="Payment terms" className="form-input" value={convert.terms} onChange={e => setConvert({ ...convert, terms: e.target.value })} /></label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className="btn-primary btn-sm" disabled={converting || !convert.clientName.trim() || !convert.projectName.trim()} onClick={() => void doConvert()}>{converting ? 'Creating…' : 'Create client + project'}</button><button className="btn-ghost btn-sm" onClick={() => setConvert(null)}>Cancel</button></div>
                </div>
              )}
              {open.id && (
                <div>
                  <div className="data-card-title">Activity</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <select aria-label="Activity type" className="form-select" style={{ width: 'auto' }} value={act.kind} onChange={e => setAct({ ...act, kind: e.target.value as LeadActivity['kind'] })}>
                      {(['note', 'call', 'email', 'meeting', 'whatsapp', 'follow_up'] as const).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
                    {act.kind === 'follow_up' && <input aria-label="Follow-up date" className="form-input" type="date" style={{ width: 'auto' }} value={act.dueOn} onChange={e => setAct({ ...act, dueOn: e.target.value })} />}
                    <input aria-label="Activity" className="form-input" style={{ flex: 1, minWidth: 180 }} placeholder={act.kind === 'follow_up' ? 'What to do (you get a reminder that morning)' : 'What happened?'} value={act.body} onChange={e => setAct({ ...act, body: e.target.value })} onKeyDown={e => e.key === 'Enter' && void addAct()} />
                    <button className="btn-primary btn-sm" onClick={() => void addAct()}>Add</button>
                  </div>
                  {acts.map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className={`badge ${a.kind === 'follow_up' ? (a.done_at ? 'badge-green' : 'badge-orange') : 'badge-gray'}`}>{KIND_LABEL[a.kind]}{a.due_on ? ` · ${a.due_on}` : ''}</span>
                      <span style={{ flex: 1, minWidth: 160 }}>{a.body}</span>
                      <span className="td-muted" style={{ fontSize: 11 }}>{new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      {a.kind === 'follow_up' && !a.done_at && <button className="btn-ghost btn-sm" onClick={() => void completeActivity(a.id).then(async () => setActs(await loadActivities(open.id!)))}>Done</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              {open.id && canManage && <button className="btn-ghost btn-sm" style={{ marginRight: 'auto', color: '#dc2626' }} onClick={() => { if (window.confirm('Delete this lead?')) void deleteLead(open.id!).then(() => { setOpen(null); return load() }) }}>Delete</button>}
              {open.id && open.stage !== 'won' && <button className="btn-ghost btn-sm" onClick={() => setConvert({ clientName: open.company || open.name, projectName: open.service ? `${open.service} team` : 'New team', rate: '', terms: 'Net 7' })}>Mark won…</button>}
              {open.id && (open as Lead).client_id && <button className="btn-ghost btn-sm" onClick={() => navigate(`/clients/${(open as Lead).client_id}`)}>Open client</button>}
              <button className="btn-primary btn-sm" disabled={!open.name?.trim()} onClick={() => void save()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
