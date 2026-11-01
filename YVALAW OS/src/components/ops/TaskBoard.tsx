import { useRef, useState } from 'react'
import type { Task, TaskStatus } from '../../data/types'
import MentionInput from '../MentionInput'
import { Menu, onEnter } from '../ui'
import { dateShort } from '../../utils/format'

export const TASK_COLS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'in-progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
]
export type TaskDraft = { title: string; description: string; assigneeName: string; dueDate: string }
const EMPTY: TaskDraft = { title: '', description: '', assigneeName: '', dueDate: '' }

/** @Name mentions highlighted in task descriptions */
export function renderWithMentions(text: string) {
  return text.split(/(@\w[\w\s]*)/g).map((part, i) => (part.startsWith('@') ? <span key={i} className="ops-mention-tag">{part}</span> : part))
}
/** Names mentioned with @ in a description (stored on the task) */
export function mentionsIn(text: string): string[] {
  return (text.match(/@(\w[\w ]*)/g) ?? []).map(m => m.slice(1).trim()).filter(Boolean)
}

/** Three-column task board with drag and drop and inline add (project page tab and the Projects page modal) */
export default function TaskBoard({ tasks, names, onAdd, onMove, onDelete }: {
  tasks: Task[]; names: string[]
  onAdd: (status: TaskStatus, draft: TaskDraft) => Promise<boolean> | boolean
  onMove: (id: string, status: TaskStatus) => void
  onDelete: (id: string) => void
}) {
  const [addCol, setAddCol] = useState<TaskStatus | null>(null)
  const [draft, setDraft] = useState<TaskDraft>(EMPTY)
  const [over, setOver] = useState<TaskStatus | null>(null)
  const dragId = useRef<string | null>(null)

  async function add(status: TaskStatus) {
    if (!draft.title.trim()) return
    if (await onAdd(status, draft)) { setDraft(EMPTY); setAddCol(null) }
  }

  return (
    <div className="ops-taskboard">
      {TASK_COLS.map(({ key, label }) => {
        const col = tasks.filter(t => t.status === key)
        return (
          <div key={key} className={`kanban__col${over === key ? ' kanban__col--drop' : ''}`} aria-label={label}
            onDragOver={e => { e.preventDefault(); setOver(key) }}
            onDragLeave={() => setOver(o => (o === key ? null : o))}
            onDrop={() => { setOver(null); if (dragId.current) { onMove(dragId.current, key); dragId.current = null } }}>
            <div className="kanban__head"><span>{label}</span><span className="kanban__count">{col.length}</span></div>
            {col.map(t => (
              <div key={t.id} className="kanban__card ops-task" draggable onDragStart={() => { dragId.current = t.id }}>
                <div className="ops-task__top">
                  <span className="ops-task__title">{t.title}</span>
                  <Menu label={`Task actions for ${t.title}`} buttonClass="btn btn--xs btn--icon btn--ghost ops-xs-icon" items={[
                    ...TASK_COLS.filter(c => c.key !== key).map(c => ({ label: `Move to ${c.label}`, onClick: () => onMove(t.id, c.key) })),
                    'sep' as const,
                    { label: 'Delete task', danger: true, onClick: () => onDelete(t.id) },
                  ]} />
                </div>
                {t.description && <div className="ops-task__desc">{renderWithMentions(t.description)}</div>}
                {(t.assigneeName || t.dueDate) && (
                  <div className="ops-task__meta">
                    {t.assigneeName && <span>{t.assigneeName}</span>}
                    {t.dueDate && <span className={t.status !== 'done' && t.dueDate < new Date().toISOString().slice(0, 10) ? 't-danger' : 't-gold'}>Due {dateShort(t.dueDate)}</span>}
                  </div>
                )}
              </div>
            ))}
            {col.length === 0 && addCol !== key && <div className="kanban__empty">Drop here</div>}
            {addCol === key ? (
              <div className="ops-task-add">
                <input className="input input--sm" placeholder="Task title" aria-label="Task title" value={draft.title} autoFocus
                  onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} onKeyDown={onEnter(() => void add(key))} />
                <MentionInput value={draft.description} onChange={v => setDraft(d => ({ ...d, description: v }))} employees={names} placeholder="Description (type @ to mention someone)" rows={2} />
                <input className="input input--sm" placeholder="Assignee" aria-label="Assignee" value={draft.assigneeName} onChange={e => setDraft(d => ({ ...d, assigneeName: e.target.value }))} />
                <input className="input input--sm" type="date" aria-label="Due date" value={draft.dueDate} onChange={e => setDraft(d => ({ ...d, dueDate: e.target.value }))} />
                <div className="row">
                  <button type="button" className="btn btn--primary btn--sm" disabled={!draft.title.trim()} onClick={() => void add(key)}>Add</button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAddCol(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm ops-task-addbtn" onClick={() => { setAddCol(key); setDraft(EMPTY) }}>+ Add task</button>
            )}
          </div>
        )
      })}
    </div>
  )
}
