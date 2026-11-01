import { useState } from 'react'
import { usePermission } from '../context/RoleContext'
import HistoryList from './HistoryList'

/** Change history of one record (only with the history.view permission).
 *  Default: a card with Show/Hide at the bottom of a profile page. `inline`: the list right away (a History tab). */
export default function RecordHistory({ table, recordId, inline = false, limit = 50 }: { table: string; recordId: string; inline?: boolean; limit?: number }) {
  const allowed = usePermission()
  const [open, setOpen] = useState(inline)
  if (!allowed('history.view')) return null
  return (
    <section className={`card ppl-history${inline ? ' ppl-history--inline' : ''}`}>
      <div className="card__head">
        <h2 className="card__title">Change history</h2>
        {!inline && <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(o => !o)}>{open ? 'Hide change history' : 'Show change history'}</button>}
      </div>
      {open && <div className="card__body"><HistoryList table={table} recordId={recordId} limit={limit} /></div>}
    </section>
  )
}
