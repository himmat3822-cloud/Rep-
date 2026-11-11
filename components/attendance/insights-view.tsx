import type { AttendanceInsights } from '@/lib/attendance/insights'

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const METHOD_LABEL: Record<string, string> = { QR_ROTATING: 'QR at desk', QR_ENTRANCE: 'Self (entrance QR)', GEO_SELF: 'Self (location)', MANUAL: 'Desk search', REGISTER: 'Paper register', BIOMETRIC: 'Biometric' }
const hourLabel = (hour: number) => `${((hour + 11) % 12) + 1}${hour < 12 ? 'a' : 'p'}`

export function InsightsView({ data }: { data: AttendanceInsights }) {
  const pvaMax = Math.max(1, ...data.plannedVsActual.map((row) => Math.max(row.planned, row.actual)))
  const trendMax = Math.max(1, ...data.trend.map((row) => row.avgPerDay))
  const methodTotal = data.methods.reduce((sum, row) => sum + row.count, 0) || 1
  return (
    <div className="stack">
      <section className="panel">
        <p className="kicker">PEAK HOURS - LAST 4 WEEKS (AVERAGE CHECK-INS)</p>
        <h2>
          Busiest {data.busiest ?? '-'} - quietest {data.quietest ?? '-'}
        </h2>
        <div className="heatmap" style={{ gridTemplateColumns: `36px repeat(${data.hours.length}, 1fr)` }}>
          <span />
          {data.hours.map((hour) => (
            <span key={hour} className="hlbl">
              {hourLabel(hour)}
            </span>
          ))}
          {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
            <div key={weekday} style={{ display: 'contents' }}>
              <span className="lbl">{DAY[weekday]}</span>
              {data.hours.map((hour) => {
                const cell = data.heatmap.find((item) => item.weekday === weekday && item.hour === hour)
                const intensity = (cell?.avg ?? 0) / data.heatMax
                return <span key={hour} className="cell" title={`${DAY[weekday]} ${hourLabel(hour)}: ${cell?.avg ?? 0}`} style={{ background: intensity ? `rgba(155, 189, 43, ${0.15 + intensity * 0.85})` : undefined }} />
              })}
            </div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <p className="kicker">TODAY</p>
          <h2>Planned (slot bookings) vs actual</h2>
          <div className="pva">
            {data.plannedVsActual.map((row) => (
              <div key={row.hour} title={`${row.label}: ${row.planned} booked, ${row.actual} came, capacity ${row.capacity}`}>
                <span className="planned" style={{ height: `${(row.planned / pvaMax) * 100}%` }} />
                <span className="actual" style={{ height: `${(row.actual / pvaMax) * 100}%` }} />
                <small>{hourLabel(row.hour)}</small>
              </div>
            ))}
          </div>
          <div className="legend">
            <span>
              <i style={{ background: '#c7d2c3' }} />
              Booked
            </span>
            <span>
              <i style={{ background: 'var(--lime)' }} />
              Came
            </span>
          </div>
        </section>
        <section className="panel">
          <p className="kicker">WHEN PEOPLE TRAIN</p>
          <h2>Morning, afternoon, evening</h2>
          <div className="split-bar">
            {data.dayparts.map((part) => (
              <span key={part.label} style={{ width: `${part.pct}%` }} />
            ))}
          </div>
          <div className="list-rows">
            {data.dayparts.map((part) => (
              <div className="list-row" key={part.label}>
                <span>{part.label}</span>
                <strong>
                  {part.pct}% <small>({part.count})</small>
                </strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="two-col">
        <section className="panel">
          <p className="kicker">TREND</p>
          <h2>Average check-ins per day, by week</h2>
          <div className="chart-wrap chart-card">
            <div className="bar-chart">
              {data.trend.map((row, index) => (
                <div className="bar-group" key={row.label}>
                  <div className={`bar ${index === data.trend.length - 1 ? 'bar-active' : ''}`} style={{ height: `${Math.max(2, (row.avgPerDay / trendMax) * 100)}%` }}>
                    <span>{row.avgPerDay}</span>
                  </div>
                  <small>{row.label}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="panel">
          <p className="kicker">HOW THEY CHECK IN (8 WEEKS)</p>
          <h2>Methods used</h2>
          <div className="list-rows">
            {data.methods.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>No check-ins yet.</p> : null}
            {data.methods.map((row) => (
              <div className="list-row" key={row.method}>
                <span>
                  {METHOD_LABEL[row.method] ?? row.method}
                  <div className="usage-bar" style={{ width: 160 }}>
                    <span style={{ width: `${(row.count / methodTotal) * 100}%` }} />
                  </div>
                </span>
                <strong>{Math.round((row.count / methodTotal) * 100)}%</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
