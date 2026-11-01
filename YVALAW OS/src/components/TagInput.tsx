import { useRef, useState } from 'react'
import type { Tag } from '../data/types'
import { TagBadge, TAG_COLORS } from './TagBadge'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  allTags: Tag[]
  onTagCreated?: (tag: Tag) => void
}

export function TagInput({ tags, onChange, allTags, onTagCreated }: TagInputProps) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const query = input.trim().toLowerCase()

  const suggestions = allTags.filter(
    (t) => !tags.includes(t.label) && t.label.toLowerCase().includes(query),
  )

  const exactMatch = allTags.find((t) => t.label.toLowerCase() === query)
  const showAddNew = query.length > 0 && !exactMatch

  function addTag(label: string) {
    if (!label || tags.includes(label)) return
    onChange([...tags, label])
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function createAndAdd() {
    if (!query) return
    const color = TAG_COLORS[allTags.length % TAG_COLORS.length]
    const newTag: Tag = { id: crypto.randomUUID(), label: query, color }
    onTagCreated?.(newTag)
    addTag(query)
  }

  function removeTag(label: string) {
    onChange(tags.filter((t) => t !== label))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length > 0) {
        addTag(suggestions[0].label)
      } else if (showAddNew) {
        createAndAdd()
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setInput('')
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  function getColor(label: string): string {
    return allTags.find((t) => t.label === label)?.color ?? TAG_COLORS[0]
  }

  return (
    <div className="ops-combo">
      <div className="ops-taginput" onClick={() => inputRef.current?.focus()}>
        {tags.map((label) => (
          <TagBadge key={label} label={label} color={getColor(label)} onRemove={() => removeTag(label)} />
        ))}
        <input
          ref={inputRef}
          className="ops-taginput__field"
          aria-label="Add tag"
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Add tags…' : ''}
        />
      </div>

      {open && (suggestions.length > 0 || showAddNew) && (
        <div className="ops-combo__list" role="listbox">
          {suggestions.map((tag) => (
            <button type="button" key={tag.id} className="ops-combo__opt" onMouseDown={() => addTag(tag.label)}>
              <span className="ops-tag__dot" style={{ background: tag.color }} aria-hidden />
              {tag.label}
            </button>
          ))}
          {showAddNew && (
            <button type="button" className="ops-combo__opt ops-combo__opt--add" onMouseDown={createAndAdd}>
              + Add "{input.trim()}" as new tag
            </button>
          )}
        </div>
      )}
    </div>
  )
}
