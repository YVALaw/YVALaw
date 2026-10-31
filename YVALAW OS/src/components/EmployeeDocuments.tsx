import { useEffect, useRef, useState } from 'react'
import { usePermission } from '../context/RoleContext'
import { deleteEmployeeDocument, loadEmployeeDocuments, openEmployeeDocument, uploadEmployeeDocument, type EmployeeDocument } from '../services/workspace'

const CAT: Record<EmployeeDocument['category'], string> = { contract: 'Contract', policy: 'Policy', tax: 'Tax', id: 'ID', other: 'Other' }

/** Employee profile → Documents shown in their My workspace (documents.manage) */
export default function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const allowed = usePermission()
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [cat, setCat] = useState<EmployeeDocument['category']>('contract')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const load = async () => { const r = await loadEmployeeDocuments(employeeId); setDocs(r.rows); setError(r.error) }
  const canDocs = allowed('documents.manage')   // arrives after the first render for non-CEO roles
  useEffect(() => { if (canDocs) void load() }, [employeeId, canDocs])   // eslint-disable-line react-hooks/exhaustive-deps
  if (!canDocs) return null
  async function upload() {
    const f = file.current?.files?.[0]; if (!f) return
    setBusy(true); setError(null)
    try { await uploadEmployeeDocument(employeeId, f, title, cat); setTitle(''); if (file.current) file.current.value = ''; await load() } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  return (
    <div className="data-card">
      <div className="data-card-title">Documents <span style={{ fontWeight: 500, fontSize: 12, color: 'var(--muted)' }}>· the employee sees these in My workspace</span></div>
      {error && <div className="portal-message portal-message-error" style={{ margin: '6px 0' }}>{error}</div>}
      {docs.map(d => (
        <div key={d.id} className="approval-row" style={{ fontSize: 13 }}>
          <span style={{ flex: 1, minWidth: 160 }}><strong>{d.title}</strong> · {CAT[d.category]}</span>
          <button className="btn-ghost btn-sm" onClick={() => void openEmployeeDocument(d).catch(e => setError(e.message))}>Open</button>
          <button className="btn-ghost btn-sm" onClick={() => { if (window.confirm(`Delete "${d.title}"?`)) void deleteEmployeeDocument(d).then(load).catch(e => setError(e.message)) }}>Delete</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
        <input aria-label="Document title" className="form-input form-input-sm" style={{ flex: 1, minWidth: 140 }} placeholder="Title (e.g. Employment contract)" value={title} onChange={e => setTitle(e.target.value)} />
        <select aria-label="Category" className="form-select form-input-sm" style={{ width: 'auto' }} value={cat} onChange={e => setCat(e.target.value as EmployeeDocument['category'])}>{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input aria-label="File" ref={file} type="file" style={{ fontSize: 13 }} />
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => void upload()}>{busy ? 'Uploading…' : 'Upload'}</button>
      </div>
    </div>
  )
}
