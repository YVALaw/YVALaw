import { useState } from 'react'
import { usePermission } from '../context/RoleContext'
import HistoryList from './HistoryList'

/** "Change history" card at the bottom of a profile page (only with the history.view permission) */
export default function RecordHistory({ table, recordId }: { table: string; recordId: string }) {
  const allowed = usePermission()
  const [open, setOpen] = useState(false)
  if (!allowed('history.view')) return null
  return (
    <div className="data-card" style={{ marginTop: 20 }}>
      <button className="btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>{open ? 'Hide change history' : 'Show change history'}</button>
      {open && <div style={{ marginTop: 12 }}><HistoryList table={table} recordId={recordId} limit={50} /></div>}
    </div>
  )
}
