import { useEffect, useState } from 'react'
import { usePermission } from '../context/RoleContext'
import { deleteAnnouncement, deleteHoliday, loadAnnouncements, loadHolidays, saveAnnouncement, saveHoliday, type Announcement, type Holiday } from '../services/workspace'
import { Banner, Card, Checkbox, EmptyState, Field, Menu, Modal, PageHeader, Pill, Segmented, Skel, Switch } from '../components/ui'
import { P } from '../components/Icon'
import { useToast } from '../context/ToastContext'

const AUD: Record<Announcement['audience'], string> = { all: 'Everyone', client: 'Client team', yva: 'YVA team' }
type Status = 'published' | 'scheduled' | 'draft'
const statusOf = (a: Announcement, now = Date.now()): Status => (!a.published_at ? 'draft' : Date.parse(a.published_at) > now ? 'scheduled' : 'published')
const STATUS_PILL: Record<Status, { label: string; tone: 'success' | 'sent' | 'neutral' }> = { published: { label: 'Published', tone: 'success' }, scheduled: { label: 'Scheduled', tone: 'sent' }, draft: { label: 'Draft', tone: 'neutral' } }
const dt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
/** datetime-local value (local time) for a moment */
const localInput = (ms: number) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const EMPTY = { title: '', body: '', audience: 'all' as Announcement['audience'], pinned: false }

/** People → Announcements: posts on the team's My workspace home (notifies on publish) + holidays (Step 7) */
export default function AnnouncementsPage() {
  const allowed = usePermission()
  const canManage = allowed('announcements.manage')
  const [items, setItems] = useState<Announcement[] | null>(null)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)   // could not load: stays as a banner
  const toast = useToast()
  const [form, setForm] = useState<{ id?: string; title: string; body: string; audience: Announcement['audience']; pinned: boolean }>(EMPTY)
  const [hForm, setHForm] = useState({ day: '', name: '', paid: true })
  const [addingHoliday, setAddingHoliday] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const r = await loadAnnouncements(true); setItems(r.rows); setLoadError(r.error)
    setHolidays(await loadHolidays(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)))
  }
  useEffect(() => { if (canManage) void load() }, [canManage])   // permissions arrive after the first render for non-CEO roles
  if (!canManage) return <div className="page"><PageHeader title="Announcements" /><EmptyState>Needs the "Post announcements" permission (Settings → Team Access → Permissions).</EmptyState></div>

  const editing = items?.find(i => i.id === form.id)
  const valid = form.title.trim().length >= 2

  /** publish: 'now' | ISO time (scheduled) | null (draft) | 'keep' (save an edit, keep its publish time) */
  async function save(when: 'now' | 'keep' | null | string) {
    if (!valid || busy) return
    setBusy(true)
    const published_at = when === 'now' ? (editing && editing.published_at && statusOf(editing) === 'published' ? editing.published_at : new Date().toISOString())
      : when === 'keep' ? editing?.published_at ?? null
      : when
    try {
      await saveAnnouncement({ ...form, published_at })
      const st = !published_at ? 'Saved as a draft.' : Date.parse(published_at) > Date.now() ? `Scheduled for ${dt(published_at)} — the team is notified then.` : 'Published — the team is notified.'
      setForm(EMPTY); toast.success(st); await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  async function publishNow(a: Announcement) {
    try { await saveAnnouncement({ ...a, published_at: new Date().toISOString() }); toast.success('Published — the team is notified.'); await load() } catch (e) { toast.error((e as Error).message) }
  }
  function openSchedule() {
    const base = editing?.published_at && statusOf(editing) === 'scheduled' ? Date.parse(editing.published_at) : Date.now() + 86400000
    const d = new Date(base); if (!(editing?.published_at && statusOf(editing) === 'scheduled')) d.setHours(8, 0, 0, 0)
    setScheduleAt(localInput(d.getTime())); setScheduleOpen(true)
  }
  const scheduleMs = scheduleAt ? new Date(scheduleAt).getTime() : NaN
  const scheduleOk = Number.isFinite(scheduleMs) && scheduleMs > Date.now() + 60_000

  const now = Date.now()
  return (
    <div className="page">
      <PageHeader title="Announcements" sub="Posts shown on the team's My workspace home. Publishing sends a notification." />
      {loadError && <Banner tone="danger" onClose={() => setLoadError(null)}>{loadError}</Banner>}

      <div className="grid-auto">
        <Card title={form.id ? 'Edit announcement' : 'New announcement'} className="ppl-composer">
          <div className="card__body stack">
            <input aria-label="Title" className="input ppl-composer__title" placeholder="Title (e.g. Office closed on Friday)" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea aria-label="Message" className="textarea" rows={5} placeholder="What should the team know? (Spanish and/or English)" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            <div className="field">
              <span className="field__label">Who sees it</span>
              <Segmented label="Who sees it" value={form.audience} onChange={v => setForm(f => ({ ...f, audience: v }))} options={(Object.keys(AUD) as Announcement['audience'][]).map(k => ({ value: k, label: AUD[k] }))} />
            </div>
            <div className="ppl-switch-row"><Switch label="Pin to top" checked={form.pinned} onChange={v => setForm(f => ({ ...f, pinned: v }))} /><span onClick={() => setForm(f => ({ ...f, pinned: !f.pinned }))}>Pin to top</span></div>
            {editing && <span className="ppl-fine">Editing a {STATUS_PILL[statusOf(editing)].label.toLowerCase()} post{editing.published_at ? ` (${dt(editing.published_at)})` : ''}.</span>}
            <div className="row row--wrap">
              {editing && statusOf(editing) !== 'draft'
                ? <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={() => void save('keep')}>Save</button>
                : <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={() => void save('now')}>Publish now</button>}
              {editing && statusOf(editing) === 'scheduled' && <button type="button" className="btn" disabled={!valid || busy} onClick={() => void save('now')}>Publish now</button>}
              <button type="button" className="btn" disabled={!valid || busy} onClick={openSchedule}>Schedule…</button>
              <button type="button" className="btn btn--ghost" disabled={!valid || busy} onClick={() => void save(null)}>{editing && statusOf(editing) !== 'draft' ? 'Unpublish (draft)' : 'Save draft'}</button>
              {form.id && <button type="button" className="btn btn--ghost" onClick={() => setForm(EMPTY)}>Cancel</button>}
            </div>
          </div>
        </Card>

        <div className="stack stack--lg">
          <section className="card ppl-posts">
            {items === null ? [0, 1, 2].map(i => <div key={i} className="ppl-post"><Skel w={90} h={12} /><Skel w="70%" h={14} /><Skel w="90%" h={12} /></div>)
              : items.length === 0 ? <div className="card-empty">No announcements yet.</div>
              : items.map(a => {
                const st = statusOf(a, now)
                return (
                  <article key={a.id} className="ppl-post">
                    <div className="ppl-post__top">
                      <Pill tone={STATUS_PILL[st].tone}>{STATUS_PILL[st].label}</Pill>
                      <span className="ppl-post__aud">{AUD[a.audience]}{st !== 'draft' && a.published_at ? ` · ${dt(a.published_at)}` : ''}</span>
                      {a.pinned && <span className="ppl-post__pin">PINNED</span>}
                      <span className="spacer" />
                      <Menu label={`Actions for ${a.title}`} buttonClass="btn btn--icon btn--sm btn--ghost" items={[
                        { label: 'Edit', icon: P.edit, onClick: () => setForm({ id: a.id, title: a.title, body: a.body, audience: a.audience, pinned: a.pinned }) },
                        { label: 'Publish now', icon: P.send, onClick: () => void publishNow(a), hidden: st === 'published' },
                        'sep',
                        { label: 'Delete', icon: P.trash, danger: true, onClick: () => { if (window.confirm('Delete this announcement?')) void deleteAnnouncement(a.id).then(load).catch(e => toast.error(`Could not delete: ${(e as Error).message}`)) } },
                      ]} />
                    </div>
                    <span className="ppl-post__title">{a.title}</span>
                    {a.body && <span className="ppl-post__body">{a.body}</span>}
                  </article>
                )
              })}
          </section>

          <Card title="Holidays" actions={!addingHoliday && <button type="button" className="link" onClick={() => setAddingHoliday(true)}>+ Add</button>}>
            {addingHoliday && (
              <div className="ppl-inline-form">
                <Field label="Date"><input aria-label="Holiday date" className="input input--sm" type="date" value={hForm.day} onChange={e => setHForm(f => ({ ...f, day: e.target.value }))} /></Field>
                <Field label="Name"><input aria-label="Holiday name" className="input input--sm" placeholder="e.g. Día de la Independencia" value={hForm.name} onChange={e => setHForm(f => ({ ...f, name: e.target.value }))} /></Field>
                <Checkbox label="Paid" checked={hForm.paid} onChange={v => setHForm(f => ({ ...f, paid: v }))} />
                <div className="ppl-inline-form__btns">
                  <button type="button" className="btn btn--sm" onClick={() => setAddingHoliday(false)}>Cancel</button>
                  <button type="button" className="btn btn--sm btn--primary" disabled={!hForm.day || hForm.name.trim().length < 2}
                    onClick={() => void saveHoliday(hForm).then(() => { setHForm({ day: '', name: '', paid: true }); setAddingHoliday(false); return load() }).catch(e => toast.error(e.message))}>Add</button>
                </div>
              </div>
            )}
            {holidays.length === 0 && !addingHoliday && <div className="card-empty">No upcoming holidays.</div>}
            {holidays.map(h => (
              <div key={h.id} className="list-row">
                <div className="list-row__main"><span className="list-row__title">{h.name}</span>{h.paid && <span className="list-row__meta">Paid</span>}</div>
                <span className="muted">{new Date(`${h.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <Menu label={`Actions for ${h.name}`} buttonClass="btn btn--icon btn--sm btn--ghost" items={[{ label: 'Delete', icon: P.trash, danger: true, onClick: () => void deleteHoliday(h.id).then(load).catch(e => toast.error(`Could not delete: ${(e as Error).message}`)) }]} />
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Schedule announcement" sub="It appears in My workspace and notifies the team at this time (your time zone)."
        footer={<>
          <button type="button" className="btn" onClick={() => setScheduleOpen(false)}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!scheduleOk} onClick={() => { setScheduleOpen(false); void save(new Date(scheduleMs).toISOString()) }}>Schedule</button>
        </>}>
        <Field label="Publish at" error={scheduleAt && !scheduleOk ? 'Pick a time in the future.' : undefined}>
          <input aria-label="Publish at" className="input" type="datetime-local" value={scheduleAt} min={localInput(Date.now())} onChange={e => setScheduleAt(e.target.value)} />
        </Field>
      </Modal>
    </div>
  )
}
