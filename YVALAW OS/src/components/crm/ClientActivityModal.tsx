// Clients page → ⋯ → Activity log: quick timeline of notes for one client (activity_log table).
import { useEffect, useState } from 'react'
import type { ActivityLogEntry, Client } from '../../data/types'
import { loadActivityLog, saveActivityLog } from '../../services/storage'
import { Banner, Modal, onEnter } from '../ui'
import { Ic, P } from '../Icon'

const fmt = (ts: number) => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function ClientActivityModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const [log, setLog] = useState<ActivityLogEntry[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!client) return
    setNote(''); setError(null)
    void loadActivityLog().then(all => setLog(all.filter(e => e.clientId === client.id).sort((a, b) => b.createdAt - a.createdAt)))
  }, [client])
  async function add() {
    if (!note.trim() || !client) return
    const entry: ActivityLogEntry = { id: crypto.randomUUID(), clientId: client.id, note: note.trim(), createdAt: Date.now() }
    const prev = log
    setLog([entry, ...log]); setNote('')
    try { const all = await loadActivityLog(); await saveActivityLog([entry, ...all]) }
    catch (e) { setLog(prev); setError(`Could not save the note: ${(e as Error).message}`) }
  }
  async function remove(id: string) {
    const prev = log
    setLog(log.filter(e => e.id !== id))
    try { const all = await loadActivityLog(); await saveActivityLog(all.filter(e => e.id !== id)) }
    catch (e) { setLog(prev); setError(`Could not delete the note: ${(e as Error).message}`) }
  }
  return (
    <Modal open={!!client} onClose={onClose} size="wide" title={`Activity — ${client?.name ?? ''}`} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      {error && <Banner tone="danger" onClose={() => setError(null)}>{error}</Banner>}
      <div className="crm-act-form">
        <input className="input crm-act-form__body" aria-label="Activity note" value={note} onChange={e => setNote(e.target.value)} onKeyDown={onEnter(() => void add())} placeholder="Add a note, call summary, update..." autoFocus />
        <button type="button" className="btn btn--primary" onClick={() => void add()} disabled={!note.trim()}>Add</button>
      </div>
      {log.length === 0 ? <div className="crm-muted-line">No activity yet. Add a note above.</div> : (
        <div>
          {log.map(e => (
            <div key={e.id} className="crm-comm">
              <span className="dot dot--info crm-comm__dot" />
              <div className="crm-comm__main"><span className="crm-comm__text">{e.note}</span><span className="crm-comm__meta">{fmt(e.createdAt)}</span></div>
              <button type="button" className="btn btn--ghost btn--xs" aria-label="Delete note" onClick={() => void remove(e.id)}><Ic d={P.x} size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
