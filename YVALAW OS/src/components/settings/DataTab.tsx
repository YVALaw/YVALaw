import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadCandidates, loadExpenses, loadGeneralExpenses, loadSnapshot } from '../../services/storage'
import { Ic, P } from '../Icon'
import { Banner, Checkbox, Modal, Skel } from '../ui'
import { clearAllData, exportBackup, importBackup } from './backup'
import { scanInlineFiles, slimInlineFiles, type SlimScan } from '../../services/slimRecords'
import { previewOldCrmImport, runOldCrmImport, type ImportPreview, type ImportProgress, type ImportResult } from '../../services/oldCrmImport'

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

  // Import from the old CRM (CEO): preview first, nothing is written until "Import"
  const oldRef = useRef<HTMLInputElement>(null)
  const [oldPreview, setOldPreview] = useState<ImportPreview | null>(null)
  const [oldError, setOldError] = useState<string | null>(null)
  const [oldReading, setOldReading] = useState(false)
  const [copyOldFiles, setCopyOldFiles] = useState(true)
  const [oldProgress, setOldProgress] = useState<ImportProgress | null>(null)
  const [oldResult, setOldResult] = useState<ImportResult | null>(null)

  async function readOldFile(file: File) {
    setOldError(null); setOldResult(null); setOldReading(true)
    try { setOldPreview(await previewOldCrmImport(await file.text())) } catch (e) { setOldError((e as Error).message) }
    setOldReading(false)
  }
  async function doOldImport() {
    if (!oldPreview) return
    setOldError(null)
    try { setOldResult(await runOldCrmImport(oldPreview, { copyFiles: copyOldFiles }, setOldProgress)) }
    catch (e) { setOldError((e as Error).message) }
    setOldProgress(null)
  }

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
              <span className="set-data-row__sub">A file exported from YVA OS (Export JSON above). Existing data will be overwritten. For a file from the old CRM, use Import from old CRM below.</span>
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
        <section className="set-card set-card--mid" aria-label="Import from old CRM">
          <div className="set-card__titles">
            <h2 className="set-card__title">Import from old CRM</h2>
            <span className="set-card__sub">Brings in employees, clients, projects, invoices and candidates from an old-CRM backup file. You see what will happen before anything is saved; it never deletes anything, and importing the same file again updates instead of duplicating.</span>
          </div>
          <div className="set-data-row">
            <div className="set-data-row__text">
              <span className="set-data-row__title">Choose the backup file (.json)</span>
              <span className="set-data-row__sub">Hours are converted to the way YVA OS reads them; résumés and videos are copied into YVA OS.</span>
            </div>
            <button type="button" className="btn btn--sm" disabled={oldReading} onClick={() => oldRef.current?.click()}>
              <Ic d={P.upload} size={14} /> {oldReading ? 'Reading…' : 'Choose file'}
            </button>
            <input ref={oldRef} className="set-file" type="file" accept=".json,application/json" aria-label="Old CRM backup file"
              onChange={e => { const f = e.target.files?.[0]; if (f) void readOldFile(f); e.target.value = '' }} />
          </div>
          {oldError && !oldPreview && <Banner tone="danger">{oldError}</Banner>}
        </section>
      )}

      <Modal open={!!oldPreview} onClose={() => { if (!oldProgress) { setOldPreview(null); setOldResult(null); setOldError(null) } }} size="wide"
        title={oldResult ? (oldResult.verified.ok ? 'Import finished' : 'Import finished — please check') : 'Import from old CRM — preview'}
        sub={oldResult ? undefined : 'Nothing has been saved yet.'}
        footer={oldResult
          ? <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Done — reload YVA OS</button>
          : <>
            <button type="button" className="btn" disabled={!!oldProgress} onClick={() => setOldPreview(null)}>Cancel</button>
            <button type="button" className="btn btn--primary" disabled={!!oldProgress} onClick={() => void doOldImport()}>{oldProgress ? 'Importing…' : 'Import'}</button>
          </>}>
        {oldPreview && !oldResult && (() => {
          const d = oldPreview.data, s = d.summary
          const anyExisting = Object.values(oldPreview.existing).some(n => n > 0)
          const anyAgain = Object.values(oldPreview.alreadyImported).some(n => n > 0)
          return (
            <div className="set-import">
              <table className="set-import__table">
                <thead><tr><th>In the file</th><th className="t-num">Records</th><th className="t-num">Already in YVA OS</th></tr></thead>
                <tbody>
                  {(['employees', 'clients', 'projects', 'invoices', 'candidates'] as const).map(t => (
                    <tr key={t}><td className="set-import__cap">{t}</td><td className="t-num">{(d[t] as unknown[]).length}</td><td className="t-num">{oldPreview.existing[t]}</td></tr>
                  ))}
                </tbody>
              </table>
              <ul className="set-import__list">
                <li>Invoices: <b>${s.billed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b> billed{s.dateRange ? `, ${s.dateRange[0]} to ${s.dateRange[1]}` : ''}. Every invoice keeps its recorded total.</li>
                <li>Hours converted: {s.invoicesByFormat.hm} invoices written as hours.minutes (“39.51” = 39 h 51 min), {s.invoicesByFormat.decimal} in decimal hours{s.invoicesByFormat.whole ? `, ${s.invoicesByFormat.whole} with whole hours only` : ''}.</li>
                {s.statusesFixed > 0 && <li>{s.statusesFixed} invoice status{s.statusesFixed === 1 ? '' : 'es'} spelled “Paid” → “paid”.</li>}
                {s.formerStaff.length > 0 && <li>Invoice lines of people no longer in the employee list keep their names: {s.formerStaff.join(', ')}.</li>}
                {s.duplicateEmployeeNumbers.length > 0 && <li>Employee numbers used twice in the old CRM (kept as they are — fix them on the employee pages if you like): {s.duplicateEmployeeNumbers.join(', ')}.</li>}
                {s.invoicesWithoutClient.length > 0 && <li>{s.invoicesWithoutClient.length} invoice(s) name a client that isn't in the file: {s.invoicesWithoutClient.slice(0, 6).join(', ')}.</li>}
                {d.employeeCounter != null && <li>New employee numbers will continue at YVA{String(new Date().getFullYear()).slice(2)}{String(d.employeeCounter).padStart(3, '0')}.</li>}
              </ul>
              {d.files.length > 0 && (
                <Checkbox checked={copyOldFiles} onChange={setCopyOldFiles} disabled={!!oldProgress}
                  label={<span>Copy {d.files.length} résumé/video file{d.files.length === 1 ? '' : 's'} into YVA OS ({(oldPreview.fileBytes / 1e6).toFixed(0)} MB) — otherwise they stay linked to the old CRM's storage</span>} />
              )}
              {anyAgain && <Banner tone="info">Some of these records were imported before — they'll be updated, not duplicated.</Banner>}
              {anyExisting && !anyAgain && <Banner tone="warning">YVA OS already has records. They are kept; the file's records are added next to them.</Banner>}
              {oldProgress && (
                <div className="set-import__progress">
                  <span>{oldProgress.step}{oldProgress.total > 1 ? ` — ${oldProgress.done} of ${oldProgress.total}` : ''}</span>
                  <div className="progress"><div className="progress__fill" style={{ width: `${oldProgress.total ? Math.round((oldProgress.done / oldProgress.total) * 100) : 0}%` }} /></div>
                </div>
              )}
              {oldError && <Banner tone="danger">{oldError} Nothing after this step was saved; you can run the import again.</Banner>}
            </div>
          )
        })()}
        {oldResult && (
          <div className="set-import">
            <Banner tone={oldResult.verified.ok ? 'success' : 'warning'}>
              {oldResult.verified.ok
                ? `Everything is in YVA OS: ${oldResult.verified.counts.employees} employees, ${oldResult.verified.counts.clients} clients, ${oldResult.verified.counts.projects} projects, ${oldResult.verified.counts.invoices} invoices ($${oldResult.verified.billed.toLocaleString('en-US', { minimumFractionDigits: 2 })}), ${oldResult.verified.counts.candidates} candidates.`
                : `Saved, but the check found a difference: ${JSON.stringify(oldResult.verified.counts)} · billed $${oldResult.verified.billed}. Tell Claude what this says.`}
            </Banner>
            {oldResult.filesCopied > 0 && <p className="set-hint">{oldResult.filesCopied} file{oldResult.filesCopied === 1 ? '' : 's'} copied into YVA OS.</p>}
            {oldResult.filesKept.length > 0 && <Banner tone="warning">Not copied (still linked where they were): {oldResult.filesKept.join('; ')}</Banner>}
            {oldResult.skippedFields.length > 0 && <p className="set-hint">Fields YVA OS doesn't use were left out: {oldResult.skippedFields.join(', ')}.</p>}
          </div>
        )}
      </Modal>

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
