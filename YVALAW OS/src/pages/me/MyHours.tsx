import { useEffect, useState } from 'react'
import { loadTrackerBlocks, type TrackerBlock } from '../../services/trackerStorage'
import { Segmented, Skel } from '../../components/ui'
import { DICT, hm, type Lang } from './i18n'

export function mondayOf(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime()
}
export function addDays(ms: number, n: number): number { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime() }
function sameDay(a: number, b: number): boolean { return new Date(a).toDateString() === new Date(b).toDateString() }
/** A full bar = 10 hours (as in the mockup) */
const FULL_DAY = 10 * 3600

/** My workspace → My time: the employee's own YVA Time hours by day, this or last week (RLS: own rows only).
 *  Green = approved by YVA, amber = tracked, not approved yet. */
export default function MyHours({ employeeId, lang = 'en' }: { employeeId: string; lang?: Lang }) {
  const t = DICT[lang]
  const thisWeek = mondayOf(Date.now())
  const [which, setWhich] = useState<'this' | 'last'>('this')
  const week = which === 'this' ? thisWeek : addDays(thisWeek, -7)
  const [blocks, setBlocks] = useState<TrackerBlock[] | null>(null)

  useEffect(() => {
    let alive = true
    setBlocks(null)
    void loadTrackerBlocks(week, addDays(week, 7), employeeId).then(b => { if (alive) setBlocks(b) })
    return () => { alive = false }
  }, [week, employeeId])

  const counted = (blocks || []).filter(b => b.status === 'tracked' || b.status === 'approved')
  const sum = (list: TrackerBlock[]) => list.reduce((s, b) => s + b.seconds, 0)
  const total = sum(counted), approved = sum(counted.filter(b => b.status === 'approved'))
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))

  return (
    <>
      <div className="mw-weeks">
        <Segmented label={t.time.weekToggle} value={which} onChange={setWhich}
          options={[{ value: 'this', label: t.time.thisWeek }, { value: 'last', label: t.time.lastWeek }]} />
      </div>
      <section className="card mw-days" aria-label={which === 'this' ? t.time.thisWeek : t.time.lastWeek}>
        {days.map((d, i) => {
          const list = counted.filter(b => sameDay(b.blockStart, d))
          const ok = sum(list.filter(b => b.status === 'approved')), all = sum(list), wait = all - ok
          return (
            <div key={d} className={`mw-day${sameDay(d, Date.now()) ? ' mw-day--today' : ''}`}>
              <span className="mw-day__name">{t.time.days[i]} <span className="mw-day__date">{new Date(d).getDate()}</span></span>
              <span className="mw-bar" aria-hidden>
                {blocks && ok > 0 && <span className="mw-bar__ok" style={{ width: `${Math.min(100, (ok / FULL_DAY) * 100)}%` }} />}
                {blocks && wait > 0 && <span className="mw-bar__wait" style={{ width: `${Math.min(100 - Math.min(100, (ok / FULL_DAY) * 100), (wait / FULL_DAY) * 100)}%` }} />}
              </span>
              <span className="mw-day__hours mono">{blocks === null ? <Skel w={40} h={12} /> : all ? hm(all) : '—'}</span>
              <span className={`mw-day__status ${wait > 0 ? 't-warning' : 't-success'}`}>{all === 0 ? '' : wait > 0 ? t.status.waiting : t.status.approved}</span>
            </div>
          )
        })}
        <div className="mw-total">
          <span>{which === 'this' ? t.time.thisWeek : t.time.lastWeek}</span>
          <span className="num">{hm(total)}</span>
        </div>
        <div className="mw-total__sub">{hm(approved)} {t.time.approvedBy} · {t.time.sub}</div>
      </section>
    </>
  )
}
