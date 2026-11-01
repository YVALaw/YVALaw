import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadCandidates, loadExpenses, loadGeneralExpenses, loadSnapshot } from '../../services/storage'
import { Ic, P } from '../Icon'
import { Banner, Modal, Skel } from '../ui'
import { clearAllData, exportBackup, importBackup } from './backup'
import { scanInlineFiles, slimInlineFiles, type SlimScan } from '../../services/slimRecords'

type Stat = { label: string; count: number }

export default function DataTab({ isCeo, canImportLeads }: { isCeo: boolean; canImportLeads: boolean }) {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [stats, setStats] = useState<Stat[] | null>(null)
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  // Photos/files saved inside records (older versions) — slow down every list
  const [slim, setSlim] = useState<SlimScan | null>(null)
  const [slimming, setSlimming] = useState<{ done: number; total: number } | null>(null)
  const [slimResult, setSlimResult] = useState<{ moved: number; failed: string[] } | null>(null)

  useEffect(() => { if (isCeo) void scanInlineFiles().then(setSlim).catch(() => setSlim(null)) }, [isCeo])

  async function doSlim() {
    setSlimming({ done: 0, total: (slim?.photos ?? 0) + (slim?.files ?? 0) }); setSlimResult(null)
    try { setSlimResult(await slimInlineFiles((done, total) => setSlimming({ done, total }))) }
    catch (e) { setSlimResult({ moved: 0, failed: [(e as Error).message] }) }
    setSlimming(null)
    setSlim(await scanInlineFiles().catch(() => null))
  }

  useEffect(() => {
    void (async () => {
      const [snap, candidates, expenses, generalExpenses] = await Promise.all([
        loadSnapshot(), loadCandidates(), loadExpenses(), loadGeneralExpenses(),
      ])
      setStats([
        { label: 'Employees',  count: snap.employees.length },
        { label: 'Clients',    count: snap.clients.length },
        { label: 'Projects',   count: snap.projects.length },
        { label: 'Invoices',   count: snap.invoices.length },
        { label: 'Candidates', count: candidates.length },
        { label: 'Expenses',   count: expenses.length + generalExpenses.length },
      ])
    })().catch(() => setStats([]))
  }, [])

  async function doExport() {
    setExporting(true); setExportError(null)
    try { await exportBackup() } catch (e) { setExportError(`Export failed — ${e instanceof Error ? e.message : 'Unknown error'}`) }
    setExporting(false)
  }

  async function doImport(file: File) {
    setImporting(true); setImportStatus(null)
    setImportStatus(await importBackup(file))
    setImporting(false)
  }

  async function doClear() {
    setClearing(true); setClearError(null)
    try {
      const ok = await clearAllData()
      setConfirmClear(false)
      if (!ok) { setClearError('Only the CEO can clear all data.'); return }
      setCleared(true)
      setTimeout(() => setCleared(false), 4000)
    } catch (e) {
      setClearError(e instanceof Error ? e.message : 'Could not clear the data.')
    } finally { setClearing(false) }
  }

  return (
    <>
      <section className="set-card set-card--mid" aria-label="Data">
        <div className="set-card__titles">
          <h2 className="set-card__title">Data</h2>
          <span className="set-card__sub">What is stored in YVA OS right now</span>
        </div>
        <div className="set-stats">
          {(stats ?? [0, 1, 2, 3, 4, 5].map(i => ({ label: String(i), count: -1 }))).map(s => (
            <div key={s.label} className="set-stat">
              {s.count < 0 ? <><Skel w={36} h={22} /><Skel w={64} h={12} /></> : <>
                <span className="set-stat__value">{s.count}</span>
                <span className="set-stat__label">{s.label}</span>
              </>}
            </div>
          ))}
        </div>

        <div>
          <div className="set-data-row">
            <div className="set-data-row__text">
              <span className="set-data-row__title">Export all data</span>
              <span className="set-data-row__sub">Download a full JSON backup you can re-import at any time.</span>
            </div>
            <button type="button" className="btn btn--sm" disabled={exporting} onClick={() => void doExport()}>
              <Ic d={P.download} size={14} /> {exporting ? 'Exporting…' : 'Export JSON'}
            </button>
          </div>
          <div className="set-data-row">
            <div className="set-data-row__text">
              <span className="set-data-row__title">Restore from backup</span>
              <span className="set-data-row__sub">Import a previously exported file. Existing data will be overwritten.</span>
            </div>
            <button type="button" className="btn btn--sm" disabled={importing} onClick={() => fileRef.current?.click()}>
              <Ic d={P.upload} size={14} /> {importing ? 'Importing…' : 'Choose File'}
            </button>
            <input ref={fileRef} className="set-file" type="file" accept=".json" aria-label="Backup file"
              onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
          </div>
          {canImportLeads && (
            <div className="set-data-row">
              <div className="set-data-row__text">
                <span className="set-data-row__title">Import leads</span>
                <span className="set-data-row__sub">Netlify Forms export or any sheet with name/email — on the Leads page.</span>
              </div>
              <button type="button" className="btn btn--sm" onClick={() => navigate('/leads')}>Open Leads →</button>
            </div>
          )}
        </div>
        {exportError && <Banner tone="danger">{exportError}</Banner>}
        {importStatus && <Banner tone={importStatus.startsWith('Import failed') ? 'danger' : 'success'}>{importStatus}</Banner>}
      </section>

      {isCeo && (
        <section className="set-card set-card--mid" aria-label="Speed">
          <div className="set-card__titles">
            <h2 className="set-card__title">Make lists load faster</h2>
            <span className="set-card__sub">Older versions saved photos and attached files inside employee, client and candidate records. Every list downloads them, even when they're not on screen.</span>
          </div>
          <div className="set-data-row">
            <div className="set-data-row__text">
              {slim == null ? <Skel w={260} h={14} /> : slim.photos + slim.files === 0
                ? <span className="set-data-row__title">All photos and files are stored the fast way. Nothing to do.</span>
                : <>
                  <span className="set-data-row__title">{[slim.photos && `${slim.photos} photo${slim.photos === 1 ? '' : 's'}`, slim.files && `${slim.files} file${slim.files === 1 ? '' : 's'}`].filter(Boolean).join(' and ')} stored inside records · {(slim.bytes / 1048576).toFixed(1)} MB</span>
                  <span className="set-data-row__sub">Moves them to file storage and keeps a link. Photos are resized to 320 px (they only show as small pictures); files are moved unchanged.</span>
                </>}
            </div>
            {slim != null && slim.photos + slim.files > 0 && (
              <button type="button" className="btn btn--sm btn--primary" disabled={!!slimming} onClick={() => void doSlim()}>
                {slimming ? `Moving ${slimming.done} of ${slimming.total}…` : 'Move to file storage'}
              </button>
            )}
          </div>
          {slimResult && slimResult.failed.length === 0 && <Banner tone="success">Moved {slimResult.moved} record{slimResult.moved === 1 ? '' : 's'}. Lists load faster now.</Banner>}
          {slimResult && slimResult.failed.length > 0 && <Banner tone="warning">Moved {slimResult.moved}. These could not be moved and were left as they were: {slimResult.failed.slice(0, 5).join('; ')}{slimResult.failed.length > 5 ? ` and ${slimResult.failed.length - 5} more` : ''}</Banner>}
        </section>
      )}

      {isCeo && (
        <section className="set-card set-card--mid set-danger" aria-label="Danger zone">
          <div className="set-card__titles">
            <h2 className="set-card__title">Danger zone</h2>
            <span className="set-card__sub">Only the CEO can do this.</span>
          </div>
          <div className="set-data-row">
            <div className="set-data-row__text">
              <span className="set-data-row__title">Clear all data</span>
              <span className="set-data-row__sub">Permanently deletes employees, clients, projects, invoices, candidates and more from the database. Export first.</span>
            </div>
            <button type="button" className="btn btn--sm btn--danger" onClick={() => setConfirmClear(true)}>Clear all…</button>
          </div>
          {cleared && <Banner tone="success">All data cleared. Reload the page.</Banner>}
          {clearError && <Banner tone="danger">{clearError}</Banner>}
        </section>
      )}

      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear all data?"
        footer={<>
          <button type="button" className="btn" onClick={() => setConfirmClear(false)}>Cancel</button>
          <button type="button" className="btn btn--danger" disabled={clearing} onClick={() => void doClear()}>{clearing ? 'Clearing…' : 'Yes, clear everything'}</button>
        </>}>
        <p className="set-hint">This will permanently delete all employees, clients, projects, invoices, and candidates from the database. This cannot be undone. Export a backup first.</p>
      </Modal>
    </>
  )
}
