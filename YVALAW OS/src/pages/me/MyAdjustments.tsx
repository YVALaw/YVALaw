import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Skel } from '../../components/ui'
import { DICT, dateLabel, hm, type Lang } from './i18n'

type Adj = { id: string; day: string; seconds_delta: number; kind: string; note: string; project_id: string | null; work_type: string | null; created_at: string }

/** My workspace → My time: time YVA adjusted, with YVA's note (time_adjustments, own rows only) */
export default function MyAdjustments({ projectNames, lang = 'en' }: { projectNames: Record<string, string>; lang?: Lang }) {
  const t = DICT[lang]
  const [rows, setRows] = useState<Adj[] | null>(null)
  useEffect(() => {
    void supabase.from('time_adjustments').select('id,day,seconds_delta,kind,note,project_id,work_type,created_at').eq('status', 'applied')
      .order('day', { ascending: false }).limit(30).then(({ data }) => setRows((data || []) as Adj[]))
  }, [])
  return (
    <section className="card">
      <h2 className="mw-card-title">{t.time.changes}</h2>
      <p className="mw-card-sub">{t.time.changesSub}</p>
      {rows === null && <div className="mw-row"><Skel h={32} /></div>}
      {rows?.length === 0 && <p className="mw-empty">{t.adjust.none}</p>}
      {rows?.map(a => {
        const what = a.kind === 'defer_out' ? t.adjust.moved : a.kind === 'defer_in' ? t.adjust.movedIn : a.kind === 'late_add' ? t.adjust.late : a.seconds_delta > 0 ? t.adjust.added : t.adjust.removed
        const target = a.project_id ? projectNames[a.project_id] ?? '' : a.work_type ?? ''
        return (
          <div key={a.id} className="mw-row">
            <div className="mw-row__main">
              <span className="mw-row__title">
                {dateLabel(a.day, lang)} · <span className={a.seconds_delta > 0 ? 't-success' : 't-warning'}>{what} {hm(Math.abs(a.seconds_delta))}</span>
              </span>
              <span className="mw-row__meta">{target ? `${target} · ` : ''}“{a.note}” — YVA</span>
            </div>
          </div>
        )
      })}
    </section>
  )
}
