// Predefined tag color palette
export const TAG_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#f97316', '#ec4899', '#6366f1', '#84cc16',
]

interface TagBadgeProps {
  label: string
  color: string
  onRemove?: () => void
}

export function TagBadge({ label, color, onRemove }: TagBadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: color + '20',
        border: `1px solid ${color}40`,
        color,
        borderRadius: 999,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {onRemove && (
        <span
          onClick={onRemove}
          style={{ cursor: 'pointer', lineHeight: 1, fontSize: 13, marginLeft: 2 }}
        >
          ×
        </span>
      )}
    </span>
  )
}
