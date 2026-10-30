import { useEffect, useState } from 'react'
import { loadTrackerBlocks, type TrackerBlock } from '../../services/trackerStorage'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function mondayOf(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime()
}
function addDays(ms: number, n: number): number { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime() }
function sameDay(a: number, b: number): boolean { return new Date(a).toDateString() === new Date(b).toDateString() }
const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`

/** My workspace → My hours: the employee's own YVA Time hours by day (RLS: own rows only) */
export default function MyHours({ employeeId }: { employeeId: string }) {
  const [week, setWeek] = useState(() => mondayOf(Date.now()))
  const [blocks, setBlocks] = useState<TrackerBlock[]>([])

  useEffect(() => {
    void loadTrackerBlocks(week, addDays(week, 7), employeeId).then(setBlocks)
  }, [week, employeeId])

  const counted = blocks.filter(b => b.status === 'tracked' || b.status === 'approved')
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const sum = (list: TrackerBlock[]) => list.reduce((s, b) => s + b.seconds, 0)
  const total = sum(counted), approved = sum(counted.filter(b => b.status === 'approved'))
  const thisWeek = mondayOf(Date.now())

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={`filter-tab${week === thisWeek ? ' active' : ''}`} onClick={() => setWeek(thisWeek)}>This week</button>
        <button className={`filter-tab${week === addDays(thisWeek, -7) ? ' active' : ''}`} onClick={() => setWeek(addDays(thisWeek, -7))}>Last week</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
        {days.map((d, i) => {
          const s = sum(counted.filter(b => sameDay(b.blockStart, d)))
          return (
            <div key={d} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 6px', textAlign: 'center', background: sameDay(d, Date.now()) ? 'var(--surf2)' : undefined }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{DAY_NAMES[i]} {new Date(d).getDate()}</div>
              <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>{s ? hm(s) : '—'}</div>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 10 }}>
        Week total <strong style={{ color: 'var(--text)' }}>{hm(total)}</strong> · approved by YVA <strong style={{ color: 'var(--text)' }}>{hm(approved)}</strong>
      </div>
    </>
  )
}
