import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Attachment, Candidate, CandidateStage, Employee } from '../data/types'
import { loadCandidates, saveCandidates } from '../services/storage'
import { useRole } from '../context/RoleContext'
import { can } from '../lib/roles'
import { Ic, P } from '../components/Icon'
import { Banner, Chips, Drawer, EmptyState, Field, Modal, PageHeader, Pill, Skel, useIsMobile } from '../components/ui'
import { OpeningPicker, loadOpeningLabels } from '../components/OpeningCandidates'
import { AttachmentList, downloadAttachment, attUrl } from '../components/people/attachments'
import { HireModal, OnboardingModal, convertCandidateToEmployee, type HireDetails } from '../components/people/hire'
import { PersonAvatar } from '../components/people/common'
import { ago } from '../utils/format'

type Cand = Candidate & { staffRequestId?: string | null }

const STAGES: { key: CandidateStage; label: string }[] = [
  { key: 'applied', label: 'Applied' },
  { key: 'screening', label: 'Screening' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'hired', label: 'Hired' },
  { key: 'rejected', label: 'Rejected' },
]
const stageLabel = (s: CandidateStage) => STAGES.find(x => x.key === s)?.label ?? s
const isHttps = (u?: string) => !!u && /^https?:\/\//i.test(u)
const appliedAgo = (c: Candidate) => c.appliedAt ? ago(Date.parse(`${c.appliedAt}T12:00:00`)) : c.updatedAt ? ago(c.updatedAt) : ''
const digits = (s?: string) => (s || '').replace(/\D/g, '')

function uid() { return crypto.randomUUID() }

const EMPTY_FORM: Omit<Candidate, 'id' | 'updatedAt'> = {
  name: '', email: '', phone: '', role: '', source: '', stage: 'applied', notes: '', resumeUrl: '', linkedinUrl: '',
  appliedAt: new Date().toISOString().slice(0, 10),
}

export default function CandidatesPage() {
  const navigate = useNavigate()
  const { role } = useRole()
  const mobile = useIsMobile()
  const hiredOnly = can.viewHiredOnly(role)
  const [candidates, setCandidates] = useState<Cand[] | null>(null)
  const [openings, setOpenings] = useState<Record<string, { client: string; role: string; open: boolean }>>({})
  useEffect(() => {
    loadCandidates().then(all => setCandidates((hiredOnly ? all.filter(c => c.stage === 'hired') : all) as Cand[]))
      .catch(e => { setError(`Could not load candidates: ${(e as Error).message}`); setCandidates([]) })
  }, [hiredOnly])
  useEffect(() => { if (!hiredOnly) void loadOpeningLabels().then(setOpenings) }, [hiredOnly])

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<Omit<Candidate, 'id' | 'updatedAt'>>(EMPTY_FORM)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Cand | null>(null)
  const [hiring, setHiring] = useState<Cand | null>(null)
  const [hireBusy, setHireBusy] = useState(false)
  const [onboarding, setOnboarding] = useState<{ cand: Candidate; employee: Employee } | null>(null)
  const [mStage, setMStage] = useState<CandidateStage>('applied')
  const [dropOn, setDropOn] = useState<CandidateStage | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const list = candidates ?? []
  const cur = list.find(c => c.id === openId) ?? null
  useEffect(() => { setNotesDraft(cur?.notes ?? '') }, [cur?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next: Cand[], ok?: string) {
    const before = candidates
    setCandidates(next); setError(null)
    try { await saveCandidates(next); if (ok) setNotice(ok); return true }
    catch (e) { setCandidates(before); setError(`Could not save: ${(e as Error).message}`); return false }
  }

  function handleFileUpload(file: File) {
    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) { alert('File too large (max 5 MB). For videos, paste a link in Resume URL instead.'); return }
    const reader = new FileReader()
    reader.onload = ev => {
      const att: Attachment = { id: uid(), name: file.name, mimeType: file.type, size: file.size, dataUrl: ev.target?.result as string, uploadedAt: Date.now() }
      setAttachments(prev => [...prev, att])
    }
    reader.readAsDataURL(file)
  }

  function openAdd() { setForm({ ...EMPTY_FORM, appliedAt: new Date().toISOString().slice(0, 10) }); setAttachments([]); setAdding(true) }
  async function saveForm() {
    if (!form.name.trim()) return
    if (await persist([...list, { ...form, id: uid(), updatedAt: Date.now(), attachments }], `${form.name.trim()} added to ${stageLabel(form.stage)}.`)) setAdding(false)
  }
  async function deleteCandidate(c: Cand) {
    setConfirmDelete(null); setOpenId(null)
    await persist(list.filter(x => x.id !== c.id), `${c.name} removed.`)
  }

  /** Hired opens the employee-profile completion form; every other stage just moves the card */
  function moveStage(id: string, stage: CandidateStage) {
    const cand = list.find(c => c.id === id)
    if (!cand || cand.stage === stage) return
    if (stage === 'hired') { setHiring(cand); return }
    void persist(list.map(c => (c.id === id ? { ...c, stage, updatedAt: Date.now() } : c)), `${cand.name} moved to ${stageLabel(stage)}.`)
  }
  async function confirmHire(d: HireDetails) {
    const cand = hiring
    if (!cand) return
    setHireBusy(true); setError(null)
    try {
      const hired = { ...cand, stage: 'hired' as const, updatedAt: Date.now() }
      const { employee, existed } = await convertCandidateToEmployee(hired, d)
      const ok = await persist(list.filter(c => c.id !== cand.id), existed ? `${cand.name} already had an employee profile (${employee.employeeNumber ?? employee.name}) — linked as hired.` : `${employee.name} hired as ${employee.employeeNumber}.`)
      if (ok) { setHiring(null); setOpenId(null); setOnboarding({ cand: hired, employee }) }
    } catch (e) { setError(`Could not create the employee: ${(e as Error).message}`) }
    finally { setHireBusy(false) }
  }

  function onDrop(stage: CandidateStage) {
    setDropOn(null)
    if (dragId.current) { moveStage(dragId.current, stage); dragId.current = null }
  }
  const byStage = (stage: CandidateStage) => list.filter(c => c.stage === stage)

  /* ── Accounting: hired staff only (payroll reference) ─────────────── */
  if (hiredOnly) {
    return (
      <div className="page">
        <PageHeader title="Hired staff" sub="Candidates who have been hired — for payroll reference" />
        {candidates === null ? <div className="table-card ppl-skel">{[0, 1, 2].map(i => <div key={i} className="ppl-skel__row"><Skel w={32} h={32} r={16} /><Skel w={180} h={12} /><Skel w={120} h={12} /></div>)}</div>
          : list.length === 0 ? <EmptyState>No hired candidates yet.</EmptyState>
          : mobile ? (
            <div className="mcards">{list.map(c => (
              <button type="button" key={c.id} className="ppl-mrow" onClick={() => navigate('/candidates/' + c.id)}>
                <PersonAvatar name={c.name} size="lg" />
                <span className="ppl-mrow__main"><span className="ppl-mrow__title">{c.name}</span><span className="ppl-mrow__meta">{[c.role, c.email].filter(Boolean).join(' · ') || '—'}</span></span>
              </button>
            ))}</div>
          ) : (
            <div className="table-card">
              <table className="table">
                <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Applied</th></tr></thead>
                <tbody>{list.map(c => (
                  <tr key={c.id} className="is-clickable" onClick={() => navigate('/candidates/' + c.id)}>
                    <td><div className="ppl-person"><PersonAvatar name={c.name} size="sm" /><span className="ppl-person__name">{c.name}</span></div></td>
                    <td>{c.role || '—'}</td><td className="muted">{c.email || '—'}</td><td className="muted mono">{c.appliedAt || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </div>
    )
  }

  const card = (c: Cand) => (
    <div key={c.id} className="kanban__card ppl-cand" draggable={!mobile} role="button" tabIndex={0}
      onDragStart={(e: DragEvent) => { dragId.current = c.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id) }}
      onDragEnd={() => setDropOn(null)}
      onClick={() => setOpenId(c.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(c.id) }}>
      <span className="ppl-cand__name">{c.name}</span>
      {c.role && <span className="ppl-cand__role">{c.role}</span>}
      <span className="ppl-cand__meta">{[c.source, appliedAgo(c)].filter(Boolean).join(' · ') || c.email || ''}</span>
      {c.staffRequestId && openings[c.staffRequestId] && <span className="pill pill--teal ppl-cand__tag">{openings[c.staffRequestId].client}</span>}
    </div>
  )
  const inPipeline = list.filter(c => c.stage !== 'hired' && c.stage !== 'rejected').length

  const idx = cur ? STAGES.findIndex(s => s.key === cur.stage) : 0
  const next = cur ? (cur.stage === 'rejected' ? STAGES[0] : cur.stage === 'hired' ? null : STAGES[Math.min(idx + 1, 4)]) : null
  const contactLinks = cur ? [
    ...(cur.attachments || []).map(a => ({ key: a.id, label: a.name, icon: P.file, onClick: () => void downloadAttachment(attUrl(a), a.name) })),
    ...(isHttps(cur.resumeUrl) ? [{ key: 'resume', label: 'Resume', icon: P.link, href: cur.resumeUrl }] : []),
    ...(isHttps(cur.linkedinUrl) ? [{ key: 'li', label: 'LinkedIn', icon: P.link, href: cur.linkedinUrl }] : []),
    ...(digits(cur.phone) ? [{ key: 'wa', label: 'WhatsApp', icon: P.whatsapp, href: `https://wa.me/${digits(cur.phone)}` }, { key: 'tel', label: 'Call', icon: P.call, href: `tel:${cur.phone}` }] : []),
    ...(cur.email ? [{ key: 'mail', label: 'Email', icon: P.mail, href: `mailto:${cur.email}` }] : []),
  ] as { key: string; label: string; icon: string; href?: string; onClick?: () => void }[] : []

  return (
    <div className="page">
      <PageHeader title="Candidates" sub={`${inPipeline} in pipeline · applications from the Careers page arrive automatically`}
        actions={<button type="button" className="btn btn--primary" onClick={openAdd}><Ic d={P.plus} size={15} />Add candidate</button>} />
      {notice && <Banner onClose={() => setNotice(null)}>{notice}</Banner>}
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}

      {candidates === null ? (
        <div className="kanban">{STAGES.map(s => <div key={s.key} className="kanban__col"><Skel w={90} h={14} /><div className="kanban__card"><Skel w="70%" h={14} /><Skel w="50%" h={11} /></div></div>)}</div>
      ) : mobile ? (
        <>
          <Chips value={mStage} onChange={setMStage} options={STAGES.map(s => ({ value: s.key, label: s.label, count: byStage(s.key).length }))} />
          <div className="mcards">
            {byStage(mStage).length === 0 ? <EmptyState>No candidates in {stageLabel(mStage)}.</EmptyState> : byStage(mStage).map(c => (
              <button type="button" key={c.id} className="mcard ppl-mcand" onClick={() => setOpenId(c.id)}>
                <span className="ppl-mcand__name">{c.name}</span>
                <span className="mcard__meta">{[c.role, c.source].filter(Boolean).join(' · ') || c.email || '—'}</span>
                {c.staffRequestId && openings[c.staffRequestId] && <span className="pill pill--teal ppl-cand__tag">{openings[c.staffRequestId].client}</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="kanban ppl-kanban">
          {STAGES.map(({ key, label }) => (
            <div key={key} className={`kanban__col${dropOn === key ? ' kanban__col--drop' : ''}`}
              onDragOver={e => { e.preventDefault(); if (dropOn !== key) setDropOn(key) }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn(d => (d === key ? null : d)) }}
              onDrop={() => onDrop(key)} aria-label={label}>
              <div className="kanban__head"><span className="row ppl-col-label"><span className={`ppl-stage-dot ppl-stage-dot--${key}`} />{label}<span className="kanban__count">{byStage(key).length}</span></span></div>
              {byStage(key).map(card)}
              {byStage(key).length === 0 && <div className="kanban__empty">Drop here</div>}
            </div>
          ))}
        </div>
      )}

      {/* Candidate drawer */}
      <Drawer open={!!cur} onClose={() => setOpenId(null)} size="narrow" title={cur?.name ?? ''} sub={cur ? `${cur.role || 'No role'} · ${stageLabel(cur.stage)}` : undefined}
        footer={cur && <>
          <button type="button" className="btn btn--ghost btn--danger" onClick={() => setConfirmDelete(cur)}>Remove</button>
          <span className="spacer" />
          <button type="button" className="btn btn--ghost hide-phone" onClick={() => navigate('/candidates/' + cur.id)}>Open full profile</button>
          {cur.stage !== 'rejected' && <button type="button" className="btn" onClick={() => moveStage(cur.id, 'rejected')}>Reject</button>}
          {next && <button type="button" className="btn btn--primary" onClick={() => moveStage(cur.id, next.key)}>Move to {next.label}</button>}
        </>}>
        {cur && <>
          <div className="info-grid ppl-drawer-info">
            <div className="info"><span className="info__label">Email</span><span className="info__value">{cur.email || '—'}</span></div>
            <div className="info"><span className="info__label">Phone</span><span className="info__value">{cur.phone || '—'}</span></div>
            <div className="info"><span className="info__label">Source</span><span className="info__value">{cur.source || '—'}</span></div>
            <div className="info"><span className="info__label">Applied</span><span className="info__value">{cur.appliedAt ? `${cur.appliedAt} · ${appliedAgo(cur)}` : '—'}</span></div>
            <div className="info"><span className="info__label">Stage</span><span className="info__value"><Pill status={cur.stage}>{stageLabel(cur.stage)}</Pill></span></div>
            {cur.staffRequestId && openings[cur.staffRequestId] && <div className="info"><span className="info__label">Opening</span><span className="info__value">{openings[cur.staffRequestId].client} · {openings[cur.staffRequestId].role}</span></div>}
          </div>
          <OpeningPicker key={cur.id} bare candidateId={cur.id} onSaved={v => setCandidates(cs => (cs || []).map(c => c.id === cur.id ? { ...c, staffRequestId: v } : c))} />
          {contactLinks.length > 0 && (
            <div className="ppl-linkrow">
              {contactLinks.map(l => l.href
                ? <a key={l.key} className="btn btn--sm" href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"><Ic d={l.icon} size={14} />{l.label}</a>
                : <button key={l.key} type="button" className="btn btn--sm ppl-linkrow__file" onClick={l.onClick}><Ic d={l.icon} size={14} /><span>{l.label}</span></button>)}
            </div>
          )}
          <Field label="Notes">
            <textarea className="textarea" rows={5} value={notesDraft} onChange={e => setNotesDraft(e.target.value)} placeholder="Interview notes, impressions…" />
          </Field>
          {notesDraft !== (cur.notes ?? '') && (
            <div className="row"><span className="spacer" />
              <button type="button" className="btn btn--sm" onClick={() => setNotesDraft(cur.notes ?? '')}>Discard</button>
              <button type="button" className="btn btn--sm btn--primary" onClick={() => void persist(list.map(c => c.id === cur.id ? { ...c, notes: notesDraft || undefined, updatedAt: Date.now() } : c), 'Notes saved.')}>Save notes</button>
            </div>
          )}
          <button type="button" className="link only-phone" onClick={() => navigate('/candidates/' + cur.id)}>Open full profile →</button>
        </>}
      </Drawer>

      {/* Add candidate */}
      <Drawer open={adding} onClose={() => setAdding(false)} title="Add candidate" sub="Careers-page applications are added automatically."
        footer={<><span className="spacer" /><button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button><button type="button" className="btn btn--primary" onClick={() => void saveForm()} disabled={!form.name.trim()}>Add candidate</button></>}>
        <div className="form-grid">
          <Field label="Name *"><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></Field>
          <Field label="Role / position"><input className="input" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} placeholder="e.g. Virtual Assistant" /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" /></Field>
          <Field label="Stage">
            <select className="select" value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value as CandidateStage })}>{STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          </Field>
          <Field label="Source"><input className="input" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="e.g. LinkedIn, Referral" /></Field>
          <Field label="Applied date"><input className="input" type="date" value={form.appliedAt} onChange={e => setForm({ ...form, appliedAt: e.target.value })} /></Field>
          <Field label="LinkedIn URL"><input className="input" value={form.linkedinUrl} onChange={e => setForm({ ...form, linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/..." /></Field>
          <Field label="Resume URL" full><input className="input" value={form.resumeUrl} onChange={e => setForm({ ...form, resumeUrl: e.target.value })} placeholder="https://drive.google.com/..." /></Field>
          <Field label="Notes" full><textarea className="textarea" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Interview notes, comments..." /></Field>
        </div>
        <section className="form-section">
          <div className="row row--between">
            <h3 className="form-section__title">Files &amp; documents {attachments.length > 0 && `(${attachments.length})`}</h3>
            <button type="button" className="btn btn--sm" onClick={() => fileInputRef.current?.click()}><Ic d={P.upload} size={14} />Upload</button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
          </div>
          <AttachmentList compact items={attachments} onRemove={id => setAttachments(prev => prev.filter(a => a.id !== id))} empty="No files. Accepts images, PDFs, audio (max 5 MB each). For videos, paste a link in Resume URL." />
        </section>
      </Drawer>

      <HireModal open={!!hiring} candidate={hiring} busy={hireBusy} pay={can.viewPayRates(role)} onClose={() => !hireBusy && setHiring(null)} onConfirm={d => void confirmHire(d)} />
      <OnboardingModal candidate={onboarding?.cand ?? null} employee={onboarding?.employee} onClose={() => setOnboarding(null)}
        onOpenEmployee={onboarding && can.viewEmployees(role) ? () => { const id = onboarding.employee.id; setOnboarding(null); navigate('/employees/' + id) } : undefined} />

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title={`Remove ${confirmDelete?.name ?? 'candidate'}?`} sub="This action cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button><button type="button" className="btn btn--danger" onClick={() => confirmDelete && void deleteCandidate(confirmDelete)}>Remove</button></>} />
    </div>
  )
}
