// Server-rendered bar chart using the existing .bar-chart styles.
export function BarChart({ points, format = (value) => String(value), highlightLast = true }: { points: { label: string; value: number }[]; format?: (value: number) => string; highlightLast?: boolean }) {
  const max = Math.max(1, ...points.map((point) => point.value))
  return (
    <div className="chart-wrap chart-card">
      <div className="bar-chart">
        {points.map((point, index) => (
          <div className="bar-group" key={`${point.label}-${index}`}>
            <div className={`bar ${highlightLast && index === points.length - 1 ? 'bar-active' : ''}`} style={{ height: `${Math.max(2, (point.value / max) * 100)}%` }} title={format(point.value)}>
              <span>{point.value > 0 ? format(point.value) : ''}</span>
            </div>
            <small>{point.label}</small>
          </div>
        ))}
      </div>
    </div>
  )
}
