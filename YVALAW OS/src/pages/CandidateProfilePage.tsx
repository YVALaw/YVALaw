import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { OpeningPicker } from '../components/OpeningCandidates'
import type { Attachment, Candidate, CandidateStage } from '../data/types'
import { loadCandidates, saveCandidates } from '../services/storage'
import { uploadFile, deleteFile } from '../services/fileStorage'
import { Ic, P } from '../components/Icon'
import { Banner, Card, EmptyState, Field, Menu, Modal, Pill, Skel } from '../components/ui'
import { AttachmentList } from '../components/people/attachments'
import { OnboardingChecklist } from '../components/people/hire'
import { PersonAvatar } from '../components/people/common'
import { useToast } from '../context/ToastContext'

function uid() { return crypto.randomUUID() }

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

type Form = { name: string; email: string; phone: string; role: string; source: string; stage: CandidateStage; notes: string; resumeUrl: string; linkedinUrl: string; appliedAt: string }
const toForm = (c: Candidate): Form => ({
  name: c.name ?? '', email: c.email ?? '', phone: c.phone ?? '', role: c.role ?? '', source: c.source ?? '', stage: c.stage ?? 'applied',
  notes: c.notes ?? '', resumeUrl: c.resumeUrl ?? '', linkedinUrl: c.linkedinUrl ?? '', appliedAt: c.appliedAt ?? '',
})

export default function CandidateProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [candidates, setCandidatesState] = useState<Candidate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)   // could not load: stays as a banner
  const toast = useToast()
  useEffect(() => { loadCandidates().then(setCandidatesState).catch(e => { setLoadError(`Could not load: ${(e as Error).message}`); setCandidatesState([]) }) }, [])
  const candidate = (candidates ?? []).find(c => c.id === id)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>({ name: '', email: '', phone: '', role: '', source: '', stage: 'applied', notes: '', resumeUrl: '', linkedinUrl: '', appliedAt: '' })
  const [attachments, setAttachments] = useState<Attachment[]>([])
  // Sync form from candidate once data loads (only when not actively editing)
  useEffect(() => {
    if (candidate && !editing) { setForm(toForm(candidate)); setAttachments(candidate.attachments ?? []) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [checkedTasks, setCheckedTasks] = useState<Set<number>>(new Set())

  if (candidates === null) {
    return <div className="page"><Skel w={110} h={14} /><div className="ppl-prof-head"><Skel w={64} h={64} r={32} /><div className="stack"><Skel w={220} h={24} /><Skel w={160} h={14} /></div></div><div className="card card--pad stack"><Skel h={14} /><Skel h={14} w="70%" /></div></div>
  }
  if (!candidate) {
    return <div className="page"><EmptyState action={<button type="button" className="btn" onClick={() => navigate('/candidates')}>← Back to Candidates</button>}>Candidate not found.</EmptyState></div>
  }

  // candidate is guaranteed non-null here (early return above handles null case)
  const candidateNN = candidate!

  async function persistUpdate(updated: Candidate, ok?: string) {
    const before = candidates
    const next = (candidates ?? []).map(c => c.id === updated.id ? updated : c)
    setCandidatesState(next)
    try { await saveCandidates(next); if (ok) toast.success(ok); return true }
    catch (e) { setCandidatesState(before); toast.error(`Could not save: ${(e as Error).message}`); return false }
  }

  async function handleSave() {
    if (!form.name.trim()) return
    const updated: Candidate = {
      ...candidateNN,
      name: form.name, email: form.email || undefined, phone: form.phone || undefined, role: form.role || undefined, source: form.source || undefined,
      stage: form.stage, notes: form.notes || undefined, resumeUrl: form.resumeUrl || undefined, linkedinUrl: form.linkedinUrl || undefined,
      appliedAt: form.appliedAt || undefined, updatedAt: Date.now(), attachments,
    }
    if (await persistUpdate(updated, 'Candidate saved.')) setEditing(false)
  }
  function handleCancel() { setForm(toForm(candidateNN)); setAttachments(candidateNN.attachments ?? []); setEditing(false) }

  async function handleDelete() {
    setConfirmDelete(false)
    const before = candidates
    const next = (candidates ?? []).filter(c => c.id !== candidateNN.id)
    setCandidatesState(next)
    try { await saveCandidates(next); navigate('/candidates') }
    catch (e) { setCandidatesState(before); toast.error(`Could not delete: ${(e as Error).message}`) }
  }

  function moveStage(stage: CandidateStage) {
    setForm(f => ({ ...f, stage }))
    void persistUpdate({ ...candidateNN, stage, updatedAt: Date.now() }, `Moved to ${stageLabel(stage)}.`)
  }

  function handleFileUpload(file: File) {
    if (file.size > 200 * 1024 * 1024) { alert('File too large (max 200 MB).'); return }
    void (async () => {
      try {
        const { storageUrl, storagePath } = await uploadFile(file, `candidates/${candidateNN.id}`)
        const att: Attachment = { id: uid(), name: file.name, mimeType: file.type, size: file.size, dataUrl: storageUrl, storageUrl, storagePath, uploadedAt: Date.now() }
        const next = [...attachments, att]
        setAttachments(next)
        if (!(await persistUpdate({ ...candidateNN, attachments: next }, `${file.name} uploaded.`))) setAttachments(attachments)
      } catch (e) {
        console.error('Upload failed', e)
        alert('Upload failed. Please try again.')
      }
    })()
  }

  function removeAttachment(attId: string) {
    const att = attachments.find(a => a.id === attId)
    if (att?.storagePath) void deleteFile(att.storagePath)
    const next = attachments.filter(a => a.id !== attId)
    setAttachments(next)
    void persistUpdate({ ...candidateNN, attachments: next }).then(ok => { if (!ok) setAttachments(attachments) })
  }

  function toggleOnboarding(i: number) {
    setCheckedTasks(prev => { const next = new Set(prev); if (next.has(i)) next.delete(i); else next.add(i); return next })
  }

  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }))
  const info: { k: string; v?: string; link?: boolean }[] = [
    { k: 'Stage', v: stageLabel(candidateNN.stage) },
    { k: 'Role', v: candidateNN.role },
    { k: 'Email', v: candidateNN.email },
    { k: 'Phone', v: candidateNN.phone },
    { k: 'Source', v: candidateNN.source },
    { k: 'Applied', v: candidateNN.appliedAt },
    { k: 'Resume URL', v: candidateNN.resumeUrl, link: true },
    { k: 'LinkedIn', v: candidateNN.linkedinUrl, link: true },
  ]

  return (
    <div className="page ppl-profile">
      <button type="button" className="back-link" onClick={() => navigate('/candidates')}><Ic d={P.chevL} size={15} />Candidates</button>
      {loadError && <Banner tone="danger" onClose={() => setLoadError(null)}>{loadError}</Banner>}

      <div className="ppl-prof-head">
        <div className="ppl-prof-head__who">
          <PersonAvatar name={candidateNN.name} size="xl" />
          <div className="ppl-prof-head__text">
            <h1 className="page-title">{candidateNN.name}</h1>
            <span className="page-sub">{[candidateNN.role, candidateNN.source && `via ${candidateNN.source}`].filter(Boolean).join(' · ') || 'Candidate'}</span>
            <div className="row row--wrap ppl-pills"><Pill status={candidateNN.stage}>{stageLabel(candidateNN.stage)}</Pill></div>
          </div>
        </div>
        <div className="page-actions">
          {editing ? (
            <>
              <button type="button" className="btn" onClick={handleCancel}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => void handleSave()} disabled={!form.name.trim()}>Save changes</button>
            </>
          ) : (
            <>
              <select aria-label="Move to stage" className="select ppl-stage-select" value={candidateNN.stage} onChange={e => moveStage(e.target.value as CandidateStage)}>
                {STAGES.map(s => <option key={s.key} value={s.key}>→ {s.label}</option>)}
              </select>
              <button type="button" className="btn btn--primary" onClick={() => setEditing(true)}>Edit profile</button>
              <Menu label="More candidate actions" items={[{ label: 'Delete candidate', icon: P.trash, danger: true, onClick: () => setConfirmDelete(true) }]} />
            </>
          )}
        </div>
      </div>

      <div className="grid-auto ppl-tabgrid">
        <div className="stack stack--lg">
          <Card title="Candidate information">
            <div className="card__body">
              {editing ? (
                <div className="form-grid">
                  <Field label="Name *"><input className="input" value={form.name} onChange={e => set({ name: e.target.value })} /></Field>
                  <Field label="Stage"><select className="select" value={form.stage} onChange={e => set({ stage: e.target.value as CandidateStage })}>{STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
                  <Field label="Role"><input className="input" value={form.role} onChange={e => set({ role: e.target.value })} placeholder="Position applied for" /></Field>
                  <Field label="Email"><input className="input" type="email" value={form.email} onChange={e => set({ email: e.target.value })} /></Field>
                  <Field label="Phone"><input className="input" value={form.phone} onChange={e => set({ phone: e.target.value })} /></Field>
                  <Field label="Source"><input className="input" value={form.source} onChange={e => set({ source: e.target.value })} placeholder="LinkedIn, referral, etc." /></Field>
                  <Field label="Applied date"><input className="input" type="date" value={form.appliedAt} onChange={e => set({ appliedAt: e.target.value })} /></Field>
                  <Field label="Resume URL"><input className="input" value={form.resumeUrl} onChange={e => set({ resumeUrl: e.target.value })} placeholder="https://..." /></Field>
                  <Field label="LinkedIn"><input className="input" value={form.linkedinUrl} onChange={e => set({ linkedinUrl: e.target.value })} placeholder="https://linkedin.com/in/..." /></Field>
                  <Field label="Notes" full><textarea className="textarea" rows={4} value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Interview notes, impressions..." /></Field>
                </div>
              ) : (
                <>
                  <div className="info-grid">
                    {info.filter(i => i.v).map(i => (
                      <div key={i.k} className="info">
                        <span className="info__label">{i.k}</span>
                        {i.link && isHttps(i.v)
                          ? <a className="info__value ppl-link" href={i.v} target="_blank" rel="noopener noreferrer">{i.v}</a>
                          : <span className="info__value">{i.v}</span>}
                      </div>
                    ))}
                  </div>
                  {candidateNN.notes && <div className="info ppl-notes"><span className="info__label">Notes</span><span className="info__value ppl-prewrap">{candidateNN.notes}</span></div>}
                </>
              )}
            </div>
          </Card>
          <OpeningPicker candidateId={candidateNN.id} />
        </div>
        <div className="stack stack--lg">
          <Card title="Attachments" actions={<button type="button" className="btn btn--sm" onClick={() => fileInputRef.current?.click()}><Ic d={P.upload} size={14} />Upload</button>}>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,audio/*,video/*,.mp4,.mov,.avi,.webm,.mkv,.m4v,.wmv" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = '' }} />
            <div className="card__body"><AttachmentList items={attachments} onRemove={removeAttachment} empty="No files yet. Upload CV, voice notes, videos, or documents." /></div>
          </Card>
          {candidateNN.stage === 'hired' && (
            <Card title="Onboarding checklist"><div className="card__body"><OnboardingChecklist checked={checkedTasks} toggle={toggleOnboarding} /></div></Card>
          )}
        </div>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${candidateNN.name}?`} sub="This cannot be undone."
        footer={<><button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button><button type="button" className="btn btn--danger" onClick={() => void handleDelete()}>Delete</button></>} />
    </div>
  )
}
