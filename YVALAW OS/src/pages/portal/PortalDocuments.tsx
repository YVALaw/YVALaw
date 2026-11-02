// Portal → Documents: upload drop zone (category + upload) and the shared document list (signed URLs, audit log).
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { auditPortalActivity, loadPortalClient, loadPortalDocuments, uploadPortalDocument } from '../../services/portalStorage'
import type { Client, ClientDocument } from '../../data/types'
import { Chips, Pill, type Tone } from '../../components/ui'
import { usePortal, PortalSkeleton } from '../../components/PortalSection'
import { dateShort } from '../../utils/format'
import { useToast } from '../../context/ToastContext'

type Category = 'all' | ClientDocument['category']

const CATEGORY_META: Record<ClientDocument['category'], { label: string; tone: Tone }> = {
  contract: { label: 'Contract', tone: 'info' },
  nda:      { label: 'NDA',      tone: 'viewed' },
  report:   { label: 'Report',   tone: 'success' },
  invoice:  { label: 'Invoice',  tone: 'gold' },
  other:    { label: 'Other',    tone: 'neutral' },
}
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg'

function fmtSize(bytes?: number) {
  if (!bytes) return null
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE')

export default function PortalDocuments() {
  const { clientId, roleClientId, previewId } = usePortal()

  const [client,    setClient]    = useState<Client | null>(null)
  const [documents, setDocuments] = useState<ClientDocument[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState<Category>('all')

  // Upload state
  const [uploadFile,  setUploadFile]  = useState<File | null>(null)
  const [uploadCat,   setUploadCat]   = useState<ClientDocument['category']>('other')
  const [uploading,   setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const toast = useToast()
  const [dragOver,    setDragOver]    = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const [c, docs] = await Promise.all([loadPortalClient(clientId), loadPortalDocuments(clientId)])
      setClient(c)
      setDocuments(docs)
      setLoading(false)
    })()
  }, [clientId])

  function pick(file: File | null | undefined) {
    setUploadError(null)
    setUploadFile(file ?? null)
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    pick(e.dataTransfer.files?.[0])
  }
  function resetUpload() {
    setUploadFile(null)
    setUploadCat('other')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleUpload() {
    if (!uploadFile || !clientId) return
    setUploading(true)
    setUploadError(null)
    try {
      const doc = await uploadPortalDocument({
        clientId,
        file:       uploadFile,
        category:   uploadCat,
        uploadedBy: client?.name ?? 'Client',
      })
      if (roleClientId && !previewId) {
        void auditPortalActivity({ clientId: roleClientId, eventType: 'document_upload', documentId: doc.id })
          .catch(err => console.warn('portal document upload audit skipped', err))
      }
      setDocuments(prev => [doc, ...prev])
      toast.success(`${doc.name} uploaded. Your YVA team can see it now.`)
      resetUpload()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function handleDownload(doc: ClientDocument) {
    if (!roleClientId || previewId) return
    void auditPortalActivity({ clientId: roleClientId, eventType: 'document_download', documentId: doc.id })
      .catch(err => console.warn('portal document download audit skipped', err))
  }

  if (loading) return <PortalSkeleton />

  const filtered = filter === 'all' ? documents : documents.filter(d => d.category === filter)
  const count = (c: ClientDocument['category']) => documents.filter(d => d.category === c).length
  const fromClient = (d: ClientDocument) => !d.uploadedBy || d.uploadedBy === 'Client' || d.uploadedBy === client?.name

  return (
    <div className="por-page por-page--narrow">
      <p className="por-summary">{client?.company ? `${client.company} · ` : ''}{documents.length} document{documents.length !== 1 ? 's' : ''}</p>


      <div className={`por-drop${dragOver ? ' por-drop--over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}>
        <input ref={fileInputRef} type="file" accept={ACCEPT} className="sr-only" aria-label="Choose a document to upload" tabIndex={-1}
          onChange={e => pick(e.target.files?.[0])} />
        {uploadFile ? (
          <>
            <span className="por-drop__title">{uploadFile.name}</span>
            <span className="por-drop__sub">{fmtSize(uploadFile.size) ?? ''}</span>
            <div className="por-drop__row">
              <label className="field por-drop__cat">
                <span className="sr-only">Category</span>
                <select className="select" aria-label="Category" value={uploadCat} onChange={e => setUploadCat(e.target.value as ClientDocument['category'])}>
                  <option value="contract">Contract</option>
                  <option value="nda">NDA</option>
                  <option value="report">Report</option>
                  <option value="invoice">Invoice</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <button type="button" className="btn btn--primary por-btn-lg" disabled={uploading} onClick={() => void handleUpload()}>{uploading ? 'Uploading…' : 'Upload'}</button>
              <button type="button" className="btn btn--ghost por-btn-lg" disabled={uploading} onClick={resetUpload}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <span className="por-drop__title">Upload a document for YVA</span>
            <span className="por-drop__sub">Schedules, policies, anything your team needs. PDF, Word, Excel or images.</span>
            <button type="button" className="btn btn--primary por-btn-lg" onClick={() => fileInputRef.current?.click()}>Choose file</button>
          </>
        )}
        {uploadError && <div className="banner banner--danger por-drop__err" role="alert">{uploadError}</div>}
      </div>

      {documents.length > 0 && (
        <Chips value={filter} onChange={setFilter} small options={[
          { value: 'all' as Category, label: 'All', count: documents.length },
          ...(Object.keys(CATEGORY_META) as ClientDocument['category'][]).filter(c => count(c) > 0).map(c => ({ value: c as Category, label: CATEGORY_META[c].label, count: count(c) })),
        ]} />
      )}

      {filtered.length === 0 ? (
        <div className="card card-empty por-empty">
          <strong>No documents yet</strong>
          <span>Upload a file above, or documents shared by your account manager will appear here automatically.</span>
        </div>
      ) : (
        <div className="card por-docs">
          {filtered.map(doc => {
            const size = fmtSize(doc.fileSize)
            return (
              <div key={doc.id} className="por-doc">
                <span className="por-doc__ext mono" aria-hidden>{extOf(doc.name)}</span>
                <div className="por-doc__main">
                  <span className="por-doc__name">{doc.name}</span>
                  <span className="por-doc__meta">
                    {fromClient(doc) ? 'Uploaded by you' : 'From YVA'} · {dateShort(doc.uploadedAt)}{size ? ` · ${size}` : ''}
                    {' '}<Pill tone={CATEGORY_META[doc.category]?.tone ?? 'neutral'}>{CATEGORY_META[doc.category]?.label ?? 'Other'}</Pill>
                  </span>
                </div>
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" download onClick={() => handleDownload(doc)} className="btn por-doc__dl">Download</a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
