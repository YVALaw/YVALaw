import type { CSSProperties } from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string | number
  className?: string
  style?: CSSProperties
}

export default function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 8,
  className = '',
  style,
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  )
}

// ── Preset skeleton layouts ───────────────────────────────────────────────────

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-card">
      <Skeleton width="60%" height={18} borderRadius={6} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '40%' : '100%'} height={14} borderRadius={6} />
      ))}
    </div>
  )
}

export function SkeletonKpi({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kpi-card">
          <Skeleton width="50%" height={12} borderRadius={6} />
          <Skeleton width="70%" height={28} borderRadius={8} style={{ marginTop: 8 }} />
          <Skeleton width="40%" height={12} borderRadius={6} style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}><Skeleton width="80%" height={12} borderRadius={4} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}><Skeleton width={c === 0 ? '70%' : '50%'} height={12} borderRadius={4} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
