import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Cand = { id: string; name: string; stage: string; staff_request_id: string | null }

/** Requests page: the candidates attached to a client's staff request (the opening) — Step 9 */
export function OpeningCandidates({ requestId }: { requestId: string }) {
  const navigate = useNavigate()
  const [list, setList] = useState<Cand[] | null>(null)
  useEffect(() => { void supabase.from('candidates').select('id,name,stage,staff_request_id').eq('staff_request_id', requestId).then(({ data, error }) => setList(error ? [] : (data || []) as Cand[])) }, [requestId])
  if (!list) return null
  return (
    <div style={{ marginTop: 10, fontSize: 13 }}>
      <strong>Candidates for this opening ({list.length})</strong>
      {list.length === 0 ? <span className="td-muted"> — attach candidates from their profile ("Opening")</span> : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {list.map(c => <button key={c.id} className="btn-ghost btn-sm" onClick={() => navigate(`/candidates/${c.id}`)}>{c.name} · {c.stage}</button>)}
        </div>
      )}
    </div>
  )
}

type Req = { id: string; client_name: string | null; role: string | null; status: string }

/** Candidate profile: attach the candidate to an open client staff request */
export function OpeningPicker({ candidateId }: { candidateId: string }) {
  const [requests, setRequests] = useState<Req[]>([])
  const [value, setValue] = useState<string>('')
  const [ready, setReady] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    void Promise.all([
      supabase.from('staff_requests').select('id,client_name,role,status').in('status', ['pending', 'in_review']).order('created_at', { ascending: false }),
      supabase.from('candidates').select('staff_request_id').eq('id', candidateId).maybeSingle(),
    ]).then(([r, c]) => {
      setRequests((r.data || []) as Req[])
      if (c.error) { setMsg(null); return }
      setValue(((c.data as { staff_request_id?: string } | null)?.staff_request_id) ?? ''); setReady(true)
    })
  }, [candidateId])
  if (!ready) return null
  async function save(v: string) {
    setValue(v)
    const { error } = await supabase.from('candidates').update({ staff_request_id: v || null }).eq('id', candidateId)
    setMsg(error ? error.message : 'Saved')
  }
  return (
    <div className="data-card">
      <div className="data-card-title">Opening {msg && <span style={{ fontWeight: 500, fontSize: 12, color: msg === 'Saved' ? '#15803d' : '#dc2626' }}>· {msg}</span>}</div>
      <select aria-label="Opening" className="form-select" value={value} onChange={e => void save(e.target.value)}>
        <option value="">Not for a specific client request</option>
        {requests.map(r => <option key={r.id} value={r.id}>{r.client_name ?? 'Client'} — {r.role ?? 'staff request'}</option>)}
        {value && !requests.some(r => r.id === value) && <option value={value}>(a closed request)</option>}
      </select>
    </div>
  )
}
