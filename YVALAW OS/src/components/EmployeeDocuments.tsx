import { useEffect, useRef, useState } from 'react'
import { usePermission } from '../context/RoleContext'
import { deleteEmployeeDocument, loadEmployeeDocuments, openEmployeeDocument, uploadEmployeeDocument, type EmployeeDocument } from '../services/workspace'
import { Card, Menu } from './ui'
import { Ic, P } from './Icon'
import { fileTag } from './people/attachments'

const CAT: Record<EmployeeDocument['category'], string> = { contract: 'Contract', policy: 'Policy', tax: 'Tax', id: 'ID', other: 'Other' }
const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Employee profile → Documents shown in their My workspace (documents.manage) */
export default function EmployeeDocuments({ employeeId, firstName }: { employeeId: string; firstName?: string }) {
  const allowed = usePermission()
  const [docs, setDocs] = useState<EmployeeDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [cat, setCat] = useState<EmployeeDocument['category']>('contract')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string>('')
  const file = useRef<HTMLInputElement>(null)
  const load = async () => { const r = await loadEmployeeDocuments(employeeId); setDocs(r.rows); setError(r.error) }
  const canDocs = allowed('documents.manage')   // arrives after the first render for non-CEO roles
  useEffect(() => { if (canDocs) void load() }, [employeeId, canDocs])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!canDocs) return null
  async function upload() {
    const f = file.current?.files?.[0]; if (!f) return
    setBusy(true); setError(null)
    try { await uploadEmployeeDocument(employeeId, f, title, cat); setTitle(''); setPicked(''); if (file.current) file.current.value = ''; await load() } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  return (
    <Card title="Shared documents" meta={`${firstName ? `${firstName} sees` : 'The employee sees'} these in My workspace`} className="ppl-docs">
      {error && <div className="card__body t-danger" role="alert">{error}</div>}
      {docs === null ? <div className="card__body muted">Loading…</div> : docs.length === 0 && <div className="card-empty">No documents shared yet.</div>}
      {(docs || []).map(d => (
        <div key={d.id} className="list-row">
          <span className="ppl-file__tag mono">{fileTag(d.storage_path, d.mime_type)}</span>
          <div className="list-row__main">
            <span className="list-row__title">{d.title}</span>
            <span className="list-row__meta">{CAT[d.category]} · visible to {firstName || 'them'} · {when(d.created_at)}</span>
          </div>
          <button type="button" className="link" onClick={() => void openEmployeeDocument(d).catch(e => setError(e.message))}>Open</button>
          <Menu label={`More actions for ${d.title}`} buttonClass="btn btn--icon btn--sm btn--ghost" items={[{ label: 'Delete', icon: P.trash, danger: true, onClick: () => { if (window.confirm(`Delete "${d.title}"?`)) void deleteEmployeeDocument(d).then(load).catch(e => setError(e.message)) } }]} />
        </div>
      ))}
      <div className="card__foot ppl-docs__upload">
        <input aria-label="Document title" className="input input--sm" placeholder="Title (e.g. Employment contract)" value={title} onChange={e => setTitle(e.target.value)} />
        <select aria-label="Category" className="select select--sm" value={cat} onChange={e => setCat(e.target.value as EmployeeDocument['category'])}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className="btn btn--sm ppl-file-pick">
          <Ic d={P.file} size={14} /><span className="ppl-file-pick__name">{picked || 'Choose file'}</span>
          <input aria-label="File" ref={file} type="file" className="sr-only" onChange={e => setPicked(e.target.files?.[0]?.name ?? '')} />
        </label>
        <button type="button" className="btn btn--sm btn--primary" disabled={busy || !picked} onClick={() => void upload()}><Ic d={P.upload} size={14} />{busy ? 'Uploading…' : 'Upload document'}</button>
      </div>
    </Card>
  )
}
