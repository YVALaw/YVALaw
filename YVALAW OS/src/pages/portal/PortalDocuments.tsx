import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import { auditPortalActivity, loadPortalClient, loadPortalDocuments, uploadPortalDocument } from '../../services/portalStorage'
import type { Client, ClientDocument } from '../../data/types'
import { IconClipboard, IconLock, IconBarChart, IconReceipt, IconFile, IconFolder, IconChevronLeft, IconDownload } from '../../components/Icon'

type Category = 'all' | ClientDocument['category']

const CATEGORY_META: Record<ClientDocument['category'], { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  contract: { label: 'Contract',  color: '#3b82f6', bg: 'rgba(59,130,246,.1)',  icon: <IconClipboard size={16} /> },
  nda:      { label: 'NDA',       color: '#a855f7', bg: 'rgba(168,85,247,.1)',  icon: <IconLock size={16} /> },
  report:   { label: 'Report',    color: '#22c55e', bg: 'rgba(34,197,94,.1)',   icon: <IconBarChart size={16} /> },
  invoice:  { label: 'Invoice',   color: '#f5b533', bg: 'rgba(245,181,51,.1)',  icon: <IconReceipt size={16} /> },
  other:    { label: 'Other',     color: '#94a3b8', bg: 'rgba(148,163,184,.1)', icon: <IconFile size={16} /> },
}

function fmtDate(ts?: number) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtSize(bytes?: number) {
  if (!bytes) return null
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PortalDocuments() {
  const { clientId: roleClientId } = useRole()
  const [searchParams] = useSearchParams()
  const previewId = searchParams.get('preview')
  const clientId  = roleClientId ?? previewId
  const navigate  = useNavigate()

  function portalNav(path: string) {
    return previewId ? `${path}?preview=${previewId}` : path
  }

  const [client,      setClient]      = useState<Client | null>(null)
  const [documents,   setDocuments]   = useState<ClientDocument[]>([])
  const [loading,     setLoading]     = useState(true)
  const [filter,      setFilter]      = useState<Category>('all')

  // Upload state
  const [uploadFile,    setUploadFile]    = useState<File | null>(null)
  const [uploadCat,     setUploadCat]     = useState<ClientDocument['category']>('other')
  const [uploading,     setUploading]     = useState(false)
  const [uploadError,   setUploadError]   = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!clientId) return
    void (async () => {
      setLoading(true)
      const [c, docs] = await Promise.all([
        loadPortalClient(clientId),
        loadPortalDocuments(clientId),
      ])
      setClient(c)
      setDocuments(docs)
      setLoading(false)
    })()
  }, [clientId])

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
      setUploadFile(null)
      setUploadCat('other')
      if (fileInputRef.current) fileInputRef.current.value = ''
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

  const filtered = filter === 'all' ? documents : documents.filter(d => d.category === filter)

  const counts = {
    all:      documents.length,
    contract: documents.filter(d => d.category === 'contract').length,
    nda:      documents.filter(d => d.category === 'nda').length,
    report:   documents.filter(d => d.category === 'report').length,
    invoice:  documents.filter(d => d.category === 'invoice').length,
    other:    documents.filter(d => d.category === 'other').length,
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <div className="loading-text">Loading documents…</div>
      </div>
    )
  }

  return (
    <div className="page-wrap">

      {/* Header */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-title">Documents</div>
          <div className="page-sub">
            {client?.company ? client.company + ' · ' : ''}
            {documents.length} document{documents.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => navigate(portalNav('/portal/dashboard'))}>
          <IconChevronLeft size={13} /> Dashboard
        </button>
      </div>

      {/* Upload card */}
      <div className="portal-panel">
        <div className="portal-panel-title-main">Upload a Document</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
          style={{ display: 'none' }}
          onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
        />
        <div className="portal-upload-row">
          <button className="btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
            Choose File
          </button>
          <span className="portal-upload-name" style={{ color: uploadFile ? 'var(--text)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {uploadFile ? uploadFile.name : 'No file selected'}
          </span>
          <select
            value={uploadCat}
            onChange={e => setUploadCat(e.target.value as ClientDocument['category'])}
            className="form-input form-input-sm"
            style={{ cursor: 'pointer' }}
          >
            <option value="contract">Contract</option>
            <option value="nda">NDA</option>
            <option value="report">Report</option>
            <option value="invoice">Invoice</option>
            <option value="other">Other</option>
          </select>
          <button
            className="btn-primary"
            onClick={() => void handleUpload()}
            disabled={!uploadFile || uploading}
            style={{ whiteSpace: 'nowrap' }}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {uploadError && (
          <div className="portal-message portal-message-error mt-10">{uploadError}</div>
        )}
      </div>

      {/* Category filter tabs */}
      {documents.length > 0 && (
        <div className="portal-chip-tabs">
          {(['all', 'contract', 'nda', 'report', 'invoice', 'other'] as Category[]).map(f => {
            const count = counts[f as keyof typeof counts]
            if (f !== 'all' && count === 0) return null
            const meta  = f !== 'all' ? CATEGORY_META[f as ClientDocument['category']] : null
            const label = f === 'all' ? `All (${counts.all})` : `${meta!.label} (${count})`
            const active = filter === f
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`portal-chip-tab${active ? ' portal-chip-tab-active' : ''}`}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Document list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><IconFolder size={28} /></div>
          <div className="empty-state-title">No documents yet</div>
          <div className="empty-state-message">
            Upload a file above, or documents shared by your account manager will appear here automatically.
          </div>
        </div>
      ) : (
        <div className="portal-card-list">
          {filtered.map(doc => {
            const meta = CATEGORY_META[doc.category]
            const size = fmtSize(doc.fileSize)
            return (
              <div key={doc.id} className="portal-document-card">
                {/* Category icon */}
                <div className="portal-document-icon" style={{ background: meta.bg }}>
                  {meta.icon}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="portal-document-title-row" style={{ alignItems: 'center', marginBottom: 4 }}>
                    <span className="portal-document-name">{doc.name}</span>
                    <span className="badge" style={{ color: meta.color, background: meta.bg, borderColor: meta.color + '33' }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="portal-document-meta">
                    <span>{fmtDate(doc.uploadedAt)}</span>
                    {doc.uploadedBy && <span>{doc.uploadedBy}</span>}
                    {size && <span>{size}</span>}
                  </div>
                </div>

                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  onClick={() => handleDownload(doc)}
                  className="btn-ghost btn-sm"
                  style={{ flexShrink: 0, textDecoration: 'none' }}
                >
                  <IconDownload size={13} /> Download
                </a>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
