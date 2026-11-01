import { useEffect, useRef, useState } from 'react'

interface MentionInputProps {
  value: string
  onChange: (val: string) => void
  employees: string[]
  placeholder?: string
  rows?: number
}

export default function MentionInput({ value, onChange, employees, placeholder, rows = 3 }: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  // The cursor position where the current @trigger started
  const triggerPosRef = useRef<number>(-1)

  const filtered = employees.filter(name =>
    name.toLowerCase().startsWith(query.toLowerCase())
  )

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    onChange(text)

    const cursor = e.target.selectionStart ?? text.length

    // Look backwards from the cursor for an @ trigger
    const textBeforeCursor = text.slice(0, cursor)
    const match = textBeforeCursor.match(/@(\w[\w ]*)$/)

    if (match) {
      triggerPosRef.current = cursor - match[0].length
      setQuery(match[1])
      setActiveIndex(0)
      setDropdownOpen(true)
    } else {
      // Check if there's a bare @ with no letters yet
      const bareMatch = textBeforeCursor.match(/@$/)
      if (bareMatch) {
        triggerPosRef.current = cursor - 1
        setQuery('')
        setActiveIndex(0)
        setDropdownOpen(true)
      } else {
        setDropdownOpen(false)
        triggerPosRef.current = -1
      }
    }
  }

  function insertMention(name: string) {
    const triggerPos = triggerPosRef.current
    if (triggerPos === -1) return

    const cursor = textareaRef.current?.selectionStart ?? value.length
    const before = value.slice(0, triggerPos)
    const after = value.slice(cursor)
    const inserted = `@${name} `
    const next = before + inserted + after

    onChange(next)
    setDropdownOpen(false)
    triggerPosRef.current = -1

    // Restore cursor after the inserted mention
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        const pos = triggerPos + inserted.length
        ta.setSelectionRange(pos, pos)
        ta.focus()
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!dropdownOpen || filtered.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      insertMention(filtered[activeIndex])
    } else if (e.key === 'Escape') {
      setDropdownOpen(false)
    }
  }

  // Close dropdown if click outside
  useEffect(() => {
    if (!dropdownOpen) return
    function handlePointerDown(e: MouseEvent) {
      const ta = textareaRef.current
      if (ta && ta.contains(e.target as Node)) return
      setDropdownOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [dropdownOpen])

  return (
    <div className="ops-combo">
      <textarea
        ref={textareaRef}
        className="textarea ops-mention"
        rows={rows}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder ?? 'Description'}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {dropdownOpen && filtered.length > 0 && (
        <div className="ops-combo__list ops-combo__list--narrow" role="listbox">
          {filtered.map((name, i) => (
            <div
              key={name}
              role="option"
              aria-selected={i === activeIndex}
              className={`ops-combo__opt${i === activeIndex ? ' ops-combo__opt--on' : ''}`}
              onPointerDown={e => { e.preventDefault(); insertMention(name) }}
            >
              @{name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
