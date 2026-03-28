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
    <div style={{ position: 'relative' }}>
      {/* Tag pills + input in one row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          padding: '5px 8px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: 'var(--surface)',
          minHeight: 38,
          cursor: 'text',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((label) => (
          <TagBadge
            key={label}
            label={label}
            color={getColor(label)}
            onRemove={() => removeTag(label)}
          />
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Add tags...' : ''}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: 13,
            color: 'var(--soft)',
            minWidth: 80,
            flex: 1,
          }}
        />
      </div>

      {/* Dropdown */}
      {open && (suggestions.length > 0 || showAddNew) && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 60,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,.25)',
            marginTop: 2,
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {suggestions.map((tag) => (
            <div
              key={tag.id}
              onMouseDown={() => addTag(tag.label)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surf2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: tag.color,
                  flexShrink: 0,
                }}
              />
              {tag.label}
            </div>
          ))}
          {showAddNew && (
            <div
              onMouseDown={createAndAdd}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--gold)',
                fontWeight: 600,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surf2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              + Add "{input.trim()}" as new tag
            </div>
          )}
        </div>
      )}
    </div>
  )
}
