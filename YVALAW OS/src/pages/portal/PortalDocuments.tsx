import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useRole } from '../../context/RoleContext'
import { auditPortalActivity, loadPortalClient, loadPortalDocuments, uploadPortalDocument } from '../../services/portalStorage'
import type { Client, ClientDocument } from '../../data/types'

type Category = 'all' | ClientDocument['category']

const CATEGORY_META: Record<ClientDocument['category'], { label: string; color: string; bg: string; icon: string }> = {
  contract: { label: 'Contract',  color: '#3b82f6', bg: 'rgba(59,130,246,.1)',  icon: '📋' },
  nda:      { label: 'NDA',       color: '#a855f7', bg: 'rgba(168,85,247,.1)',  icon: '🔒' },
  report:   { label: 'Report',    color: '#22c55e', bg: 'rgba(34,197,94,.1)',   icon: '📊' },
  invoice:  { label: 'Invoice',   color: '#f5b533', bg: 'rgba(245,181,51,.1)',  icon: '🧾' },
  other:    { label: 'Other',     color: '#94a3b8', bg: 'rgba(148,163,184,.1)', icon: '📄' },
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading documents…</div>
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
        <button
          className="btn-ghost btn-sm"
          onClick={() => navigate(portalNav('/portal/dashboard'))}
          style={{ fontSize: 12 }}
        >
          ← Dashboard
        </button>
      </div>

      {/* Upload card */}
      <div className="portal-panel">
        <div className="portal-panel-title" style={{ marginBottom: 14 }}>Upload a Document</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
          style={{ display: 'none' }}
          onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
        />
        <div className="portal-upload-row">
          <button
            className="btn-ghost btn-sm"
            onClick={() => fileInputRef.current?.click()}
            style={{ fontSize: 13 }}
          >
            Choose File
          </button>
          <span className="portal-upload-name" style={{ color: uploadFile ? 'var(--text)' : 'var(--muted)' }}>
            {uploadFile ? uploadFile.name : 'No file selected'}
          </span>
          <select
            value={uploadCat}
            onChange={e => setUploadCat(e.target.value as ClientDocument['category'])}
            style={{
              fontSize: 13, padding: '7px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surf2)',
              color: 'var(--text)', cursor: 'pointer',
            }}
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
            style={{ fontSize: 13, whiteSpace: 'nowrap' }}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {uploadError && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#ef4444', padding: '8px 12px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8 }}>
            {uploadError}
          </div>
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
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, color: 'var(--muted)',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
            No documents yet
          </div>
          <div style={{ fontSize: 13, maxWidth: 360, margin: '0 auto' }}>
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
                    <span className="portal-document-name">
                      {doc.name}
                    </span>
                    <span style={{
                      padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                      color: meta.color, background: meta.bg,
                    }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="portal-document-meta">
                    <span>{fmtDate(doc.uploadedAt)}</span>
                    {doc.uploadedBy && (
                      <span>{doc.uploadedBy}</span>
                    )}
                    {size && (
                      <span>{size}</span>
                    )}
                  </div>
                </div>

                <a
                  href={doc.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  onClick={() => handleDownload(doc)}
                  className="btn-ghost btn-sm"
                  style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, textDecoration: 'none' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" x2="12" y1="15" y2="3"/>
                  </svg>
                  Download
                </a>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
