import { useEffect, useState } from 'react'
import { usePermission } from '../context/RoleContext'
import { deleteAnnouncement, deleteHoliday, loadAnnouncements, loadHolidays, saveAnnouncement, saveHoliday, type Announcement, type Holiday } from '../services/workspace'

const AUD: Record<Announcement['audience'], string> = { all: 'Everyone', client: 'Client team', yva: 'YVA team' }

/** HR → Announcements: news and holidays shown in My workspace → Company (Step 7) */
export default function AnnouncementsPage() {
  const allowed = usePermission()
  const [items, setItems] = useState<Announcement[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ id?: string; title: string; body: string; audience: Announcement['audience']; pinned: boolean }>({ title: '', body: '', audience: 'all', pinned: false })
  const [hForm, setHForm] = useState({ day: '', name: '', paid: true })

  async function load() {
    const r = await loadAnnouncements(true); setItems(r.rows); setError(r.error)
    setHolidays(await loadHolidays(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)))
  }
  useEffect(() => { void load() }, [])
  if (!allowed('announcements.manage')) return <div className="page-wrap"><div className="data-card td-muted">Needs the "Post announcements" permission (Settings → Team Access → Permissions).</div></div>

  async function save(publish: boolean) {
    try {
      const existing = items.find(i => i.id === form.id)
      await saveAnnouncement({ ...form, published_at: publish ? existing?.published_at ?? new Date().toISOString() : null })
      setForm({ title: '', body: '', audience: 'all', pinned: false }); await load()
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <div className="page-wrap">
      <div className="page-header"><div className="page-header-left"><h1 className="page-title">Announcements</h1><p className="page-sub">Shown in My workspace → Company · publishing notifies the employees it's for</p></div></div>
      {error && <div className="portal-message portal-message-error" style={{ marginBottom: 12 }}>{error}</div>}
      <div className="data-card" style={{ marginBottom: 16 }}>
        <div className="data-card-title">{form.id ? 'Edit announcement' : 'New announcement'}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <input aria-label="Title" className="form-input" placeholder="Title (e.g. Office closed on Friday)" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <textarea aria-label="Message" className="form-input" rows={4} placeholder="Message (Spanish and/or English)" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select aria-label="Who sees it" className="form-select" style={{ width: 'auto' }} value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value as Announcement['audience'] }))}>
              {Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} /> Pin to the top</label>
            <button className="btn-primary btn-sm" disabled={form.title.trim().length < 2} onClick={() => void save(true)}>{form.id ? 'Save' : 'Publish'}</button>
            <button className="btn-ghost btn-sm" disabled={form.title.trim().length < 2} onClick={() => void save(false)}>Save as draft</button>
            {form.id && <button className="btn-ghost btn-sm" onClick={() => setForm({ title: '', body: '', audience: 'all', pinned: false })}>Cancel</button>}
          </div>
        </div>
      </div>
      <div className="data-card" style={{ marginBottom: 16 }}>
        {items.length === 0 && <div className="td-muted">No announcements yet.</div>}
        {items.map(a => (
          <div key={a.id} className="approval-row">
            <div style={{ flex: 1, minWidth: 220 }}>
              <strong>{a.title}</strong> {a.pinned && <span className="badge badge-yellow">Pinned</span>} {!a.published_at && <span className="badge badge-gray">Draft</span>}
              <div className="td-muted" style={{ fontSize: 13 }}>{AUD[a.audience]}{a.published_at ? ` · ${new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''} · {a.body.slice(0, 120)}</div>
            </div>
            <button className="btn-ghost btn-sm" onClick={() => setForm({ id: a.id, title: a.title, body: a.body, audience: a.audience, pinned: a.pinned })}>Edit</button>
            <button className="btn-ghost btn-sm" onClick={() => { if (window.confirm('Delete this announcement?')) void deleteAnnouncement(a.id).then(load).catch(e => setError(`Could not delete: ${(e as Error).message}`)) }}>Delete</button>
          </div>
        ))}
      </div>
      <div className="data-card">
        <div className="data-card-title">Holidays</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input aria-label="Holiday date" className="form-input" type="date" style={{ width: 'auto' }} value={hForm.day} onChange={e => setHForm(f => ({ ...f, day: e.target.value }))} />
          <input aria-label="Holiday name" className="form-input" style={{ flex: 1, minWidth: 160 }} placeholder="e.g. Día de la Independencia" value={hForm.name} onChange={e => setHForm(f => ({ ...f, name: e.target.value }))} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={hForm.paid} onChange={e => setHForm(f => ({ ...f, paid: e.target.checked }))} /> Paid</label>
          <button className="btn-primary btn-sm" disabled={!hForm.day || hForm.name.trim().length < 2} onClick={() => void saveHoliday(hForm).then(() => { setHForm({ day: '', name: '', paid: true }); return load() }).catch(e => setError(e.message))}>Add</button>
        </div>
        {holidays.map(h => (
          <div key={h.id} className="approval-row" style={{ fontSize: 14 }}>
            <strong style={{ minWidth: 120 }}>{new Date(`${h.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong>
            <span style={{ flex: 1 }}>{h.name}</span>{h.paid && <span className="badge badge-green">Paid</span>}
            <button className="btn-ghost btn-sm" onClick={() => void deleteHoliday(h.id).then(load).catch(e => setError(`Could not delete: ${(e as Error).message}`))}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  )
}
