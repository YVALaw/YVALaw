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
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        className="form-input"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={{ width: '100%', resize: 'vertical' }}
      />
      {dropdownOpen && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 200,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,.12)',
            minWidth: 180,
            maxWidth: 280,
            overflow: 'hidden',
          }}
        >
          {filtered.map((name, i) => (
            <div
              key={name}
              onPointerDown={e => { e.preventDefault(); insertMention(name) }}
              style={{
                padding: '7px 12px',
                fontSize: 13,
                cursor: 'pointer',
                background: i === activeIndex ? 'rgba(250,204,21,.15)' : 'transparent',
                color: i === activeIndex ? '#a16207' : '#1e293b',
                fontWeight: i === activeIndex ? 600 : 400,
              }}
            >
              @{name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
