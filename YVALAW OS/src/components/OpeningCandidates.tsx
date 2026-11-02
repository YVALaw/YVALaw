import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../context/ToastContext'

type Cand = { id: string; name: string; stage: string; staff_request_id: string | null }

/** Requests page: the candidates attached to a client's staff request (the opening) — Step 9 */
export function OpeningCandidates({ requestId }: { requestId: string }) {
  const navigate = useNavigate()
  const [list, setList] = useState<Cand[] | null>(null)
  useEffect(() => { void supabase.from('candidates').select('id,name,stage,staff_request_id').eq('staff_request_id', requestId).then(({ data, error }) => setList(error ? [] : (data || []) as Cand[])) }, [requestId])
  if (!list) return null
  return (
    <div className="ppl-opening-list">
      <span className="section-label">Candidates for this opening ({list.length})</span>
      {list.length === 0 ? <span className="ppl-fine"> — attach candidates from their profile ("Opening")</span> : (
        <div className="ppl-opening-list__chips">
          {list.map(c => <button type="button" key={c.id} className="chip chip--sm" onClick={() => navigate(`/candidates/${c.id}`)}>{c.name} · {c.stage}</button>)}
        </div>
      )}
    </div>
  )
}

type Req = { id: string; client_name: string | null; role: string | null; status: string; start_date?: string | null }

/** Candidate profile / drawer: attach the candidate to an open client staff request.
 *  `bare` renders just the labelled select (for the Candidates drawer); `onSaved` reports the new value. */
export function OpeningPicker({ candidateId, bare = false, onSaved }: { candidateId: string; bare?: boolean; onSaved?: (requestId: string | null) => void }) {
  const [requests, setRequests] = useState<Req[]>([])
  const [value, setValue] = useState<string>('')
  const [ready, setReady] = useState(false)
  const toast = useToast()
  useEffect(() => {
    void Promise.all([
      supabase.from('staff_requests').select('id,client_name,role,status').in('status', ['pending', 'in_review']).order('created_at', { ascending: false }),
      supabase.from('candidates').select('staff_request_id').eq('id', candidateId).maybeSingle(),
    ]).then(([r, c]) => {
      setRequests((r.data || []) as Req[])
      if (c.error) return
      setValue(((c.data as { staff_request_id?: string } | null)?.staff_request_id) ?? ''); setReady(true)
    })
  }, [candidateId])
  if (!ready) return null
  async function save(v: string) {
    const before = value
    setValue(v)
    const { error } = await supabase.from('candidates').update({ staff_request_id: v || null }).eq('id', candidateId)
    if (error) { setValue(before); toast.error(error.message) } else { toast.success('Opening saved.'); onSaved?.(v || null) }
  }
  const field = (
    <label className="field">
      <span className="field__label">Opening (staff request)</span>
      <select aria-label="Opening" className="select" value={value} onChange={e => void save(e.target.value)}>
        <option value="">Not for a specific client request</option>
        {requests.map(r => <option key={r.id} value={r.id}>{r.client_name ?? 'Client'} — {r.role ?? 'staff request'}</option>)}
        {value && !requests.some(r => r.id === value) && <option value={value}>(a closed request)</option>}
      </select>
    </label>
  )
  if (bare) return field
  return (
    <section className="card card--pad ppl-opening">
      <h2 className="card__title">Opening</h2>
      {field}
    </section>
  )
}

/** Candidates board: short labels for every staff request ("Halavi Law"), keyed by id, for the opening tag on cards */
export async function loadOpeningLabels(): Promise<Record<string, { client: string; role: string; open: boolean }>> {
  const { data, error } = await supabase.from('staff_requests').select('id,client_name,role,status')
  if (error) return {}
  const out: Record<string, { client: string; role: string; open: boolean }> = {}
  for (const r of (data || []) as Req[]) out[r.id] = { client: r.client_name ?? 'Client', role: r.role ?? 'staff request', open: r.status === 'pending' || r.status === 'in_review' }
  return out
}
