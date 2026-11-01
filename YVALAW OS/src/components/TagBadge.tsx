import { Ic, P } from './Icon'

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

/** A tag chip: the dot carries the tag's own colour (a data colour, so it stays inline) */
export function TagBadge({ label, color, onRemove }: TagBadgeProps) {
  return (
    <span className="ops-tag">
      <span className="ops-tag__dot" style={{ background: color }} aria-hidden />
      {label}
      {onRemove && (
        <button type="button" className="ops-tag__x" onClick={e => { e.stopPropagation(); onRemove() }} aria-label={`Remove tag ${label}`}>
          <Ic d={P.x} size={11} stroke={2.4} />
        </button>
      )}
    </span>
  )
}
