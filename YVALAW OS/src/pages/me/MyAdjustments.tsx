import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

type Adj = { id: string; day: string; seconds_delta: number; kind: string; note: string; project_id: string | null; work_type: string | null; created_at: string }
const T = {
  en: { none: 'YVA has not changed any of your time.', moved: 'Moved to next week', movedIn: 'Moved in from last week', added: 'Added', removed: 'Removed', late: 'Late time added' },
  es: { none: 'YVA no ha cambiado tu tiempo.', moved: 'Movido a la próxima semana', movedIn: 'Movido desde la semana pasada', added: 'Agregado', removed: 'Quitado', late: 'Tiempo tardío agregado' },
}
const hm = (s: number) => { const m = Math.round(Math.abs(s) / 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` }

/** My workspace: time YVA adjusted, with YVA's note (time_adjustments, own rows only) */
export default function MyAdjustments({ projectNames, lang = 'en' }: { projectNames: Record<string, string>; lang?: 'en' | 'es' }) {
  const t = T[lang]
  const [rows, setRows] = useState<Adj[] | null>(null)
  useEffect(() => {
    void supabase.from('time_adjustments').select('id,day,seconds_delta,kind,note,project_id,work_type,created_at').eq('status', 'applied')
      .order('day', { ascending: false }).limit(30).then(({ data }) => setRows((data || []) as Adj[]))
  }, [])
  if (rows === null) return null
  if (rows.length === 0) return <div style={{ fontSize: 14, color: 'var(--muted)' }}>{t.none}</div>
  return (
    <div>
      {rows.map(a => (
        <div key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13, flexWrap: 'wrap' }}>
          <strong style={{ minWidth: 92 }}>{new Date(`${a.day}T12:00:00`).toLocaleDateString(lang === 'es' ? 'es-DO' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
          <span style={{ color: a.seconds_delta > 0 ? '#15803d' : '#b45309', fontWeight: 600 }}>
            {a.kind === 'defer_out' ? t.moved : a.kind === 'defer_in' ? t.movedIn : a.kind === 'late_add' ? t.late : a.seconds_delta > 0 ? t.added : t.removed} {hm(a.seconds_delta)}
          </span>
          <span style={{ color: 'var(--muted)' }}>{a.project_id ? projectNames[a.project_id] ?? '' : a.work_type ?? ''}</span>
          <span style={{ flexBasis: '100%', color: 'var(--text2)' }}>“{a.note}” — YVA</span>
        </div>
      ))}
    </div>
  )
}
