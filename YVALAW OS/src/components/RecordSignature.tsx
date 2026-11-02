// "Created by Hans Esmel · Last changed by Paola, 2h ago" under a record's title, from the change history.
// Shown only with the history.view permission (the database enforces the same rule); nothing while loading,
// when nothing was recorded (records made before history started) or when the history can't be read.
import { useEffect, useState } from 'react'
import { usePermission } from '../context/RoleContext'
import { actorName, loadPeopleByLogin, loadSignature, type PersonRef, type Signature } from '../services/auditTrail'
import { ago, dateMed } from '../utils/format'

export default function RecordSignature({ table, recordId, refreshKey }: { table: string; recordId: string; refreshKey?: unknown }) {
  const allowed = usePermission()
  const canSee = allowed('history.view')
  const [sig, setSig] = useState<Signature | null>(null)
  const [people, setPeople] = useState<Map<string, PersonRef>>(new Map())

  useEffect(() => {
    if (!canSee || !recordId) { setSig(null); return }
    let alive = true
    void Promise.all([loadSignature(table, recordId), loadPeopleByLogin()])
      .then(([s, p]) => { if (alive) { setSig(s); setPeople(p) } })
      .catch(() => { if (alive) setSig(null) })
    return () => { alive = false }
  }, [canSee, table, recordId, refreshKey])

  if (!canSee || !sig) return null
  const who = (x: NonNullable<Signature['created']>) => actorName(x.actorId, x.actorEmail, people)
  const sameAsCreated = sig.created && sig.changed && sig.created.at === sig.changed.at
  return (
    <p className="set-sign" data-testid="record-signature">
      {sig.created && <span className="set-sign__part" title={new Date(sig.created.at).toLocaleString()}>Created by <strong>{who(sig.created)}</strong>, {dateMed(sig.created.at)}</span>}
      {sig.changed && !sameAsCreated && <span className="set-sign__part" title={new Date(sig.changed.at).toLocaleString()}>Last changed by <strong>{who(sig.changed)}</strong>, {ago(sig.changed.at)}</span>}
    </p>
  )
}
