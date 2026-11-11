import Link from 'next/link'
import { CalendarClock, Dumbbell, Flame, MoreHorizontal, Play, QrCode, Receipt, Users, Wallet, Zap, type LucideIcon } from 'lucide-react'
import { initials } from '@/components/brand'
import { describeChange, type OwnerOverview } from '@/lib/owner/overview'
import { formatInr, formatInrCompact } from '@/lib/money'

function Metric({ label, value, note, icon: Icon, accent = '' }: { label: string; value: string; note: string; icon: LucideIcon; accent?: string }) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${accent}`}>
        <Icon />
      </div>
      <div className="metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      <MoreHorizontal className="more-icon" />
    </div>
  )
}


const AVATAR_COLORS = ['bg-lime-300', 'bg-sky-300', 'bg-orange-300', 'bg-fuchsia-300', 'bg-emerald-300']

function crowdWord(percent: number): string {
  if (percent < 35) return 'Quiet'
  if (percent < 75) return 'Comfortably busy'
  return 'Packed'
}

export function OwnerOverviewView({ data, firstName, dateLine, greeting, athleteLabelPlural, deskTools }: { data: OwnerOverview; firstName: string; dateLine: string; greeting: string; athleteLabelPlural: string; deskTools: boolean }) {
  const max = Math.max(1, ...data.week.map((day) => day.count))
  const top = Math.max(10, Math.ceil(max / 10) * 10)
  const peak = data.week.reduce((a, b) => (b.count > a.count ? b : a), data.week[0])

  return (
    <div className="dashboard-grid">
      <section className="hero-card">
        <div className="hero-noise" />
        <div className="hero-content">
          <div className="eyebrow">
            <span className="live-dot" /> LIVE BUSINESS PULSE
          </div>
          <h1>
            {greeting},<br />
            <em>{firstName}.</em>
          </h1>
          <p>
            {dateLine}. {data.todayCheckIns} check-ins so far, {data.floor.inside} on the floor right now.
          </p>
          <div className="hero-actions">
            {deskTools ? (
              <Link href="/desk" className="button-link lime">
                <QrCode /> Quick check-in
              </Link>
            ) : null}
            <span className="button-link" style={{ color: '#fff' }}>
              <Play /> {data.floor.percent}% floor occupancy
            </span>
          </div>
        </div>
        <div className="hero-orbit">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <Dumbbell className="orbit-dumbbell" />
        </div>
      </section>

      <section className="panel pulse-panel">
        <div className="panel-heading">
          <div>
            <p className="kicker">RIGHT NOW</p>
            <h2>Floor pulse</h2>
          </div>
          <span className="status-pill">
            <span className="live-dot" /> Live
          </span>
        </div>
        <div className="pulse-number">
          {data.floor.percent}
          <span>%</span>
        </div>
        <p className="muted">
          {crowdWord(data.floor.percent)} - {data.floor.inside} of {data.floor.capacity} hourly capacity
        </p>
        <div className="meter">
          <span style={{ width: `${data.floor.percent}%` }} />
        </div>
        <div className="pulse-footer">
          <span>Best time to train</span>
          <strong>{data.floor.bestTime ?? 'Closing soon'}</strong>
        </div>
        <div className="pulse-footer">
          <span>Next rush</span>
          <strong>{data.floor.nextRush ? `${data.floor.nextRush} - ${data.floor.nextRushPercent}% expected` : 'No more rush today'}</strong>
        </div>
      </section>

      <div className="metric-row">
        <Metric label={`Active ${athleteLabelPlural.toLowerCase()}`} value={data.activeMembers.toLocaleString('en-IN')} note={`${data.newThisMonth} joined this month`} icon={Users} />
        <Metric label="Collected this month" value={formatInrCompact(data.collectedThisMonthPaise)} note={describeChange(data.collectedThisMonthPaise, data.collectedLastMonthSamePeriodPaise, 'vs last month')} icon={Wallet} accent="orange" />
        <Metric label="Today's check-ins" value={String(data.todayCheckIns)} note={describeChange(data.todayCheckIns, data.sameDayLastWeekCheckIns, 'vs same time last week')} icon={Zap} accent="blue" />
      </div>
      <div className="metric-row">
        <Metric label="Pending dues" value={formatInr(data.pendingDuesPaise)} note={`${data.pendingDuesCount} open dues`} icon={Receipt} accent="orange" />
        <Metric label="Renewals in 7 days" value={String(data.renewalsNext7Days)} note="Plans ending this week" icon={CalendarClock} />
        <Metric label="At risk" value={String(data.atRisk)} note="To call this week" icon={Flame} accent="orange" />
      </div>

      <section className="panel attendance-panel">
        <div className="panel-heading">
          <div>
            <p className="kicker">MEMBER RHYTHM</p>
            <h2>Attendance flow</h2>
          </div>
          <span className="select-button">Last 7 days</span>
        </div>
        <div className="chart-wrap">
          <div className="chart-y">
            <span>{top}</span>
            <span>{Math.round(top * 0.75)}</span>
            <span>{Math.round(top * 0.5)}</span>
            <span>{Math.round(top * 0.25)}</span>
            <span>0</span>
          </div>
          <div className="bar-chart">
            {data.week.map((day) => (
              <div className="bar-group" key={day.label + String(day.isToday)}>
                <div className={`bar ${day === peak ? 'bar-active' : ''}`} style={{ height: `${Math.max(2, (day.count / top) * 100)}%` }}>
                  <span>{day.count}</span>
                </div>
                <small>{day.isToday ? 'Today' : day.label}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="chart-note">
          <span className="pulse-line" /> Busiest day this week: <strong>{peak.isToday ? 'today' : peak.label}</strong> with {peak.count} check-ins
        </div>
      </section>

      <section className="panel risk-panel">
        <div className="panel-heading">
          <div>
            <p className="kicker accent-kicker">NEEDS ATTENTION</p>
            <h2>At-risk {athleteLabelPlural.toLowerCase()}</h2>
          </div>
          <span className="count-badge">{data.atRisk}</span>
        </div>
        <div className="risk-copy">
          <div className="risk-icon">
            <Flame />
          </div>
          <p>
            <strong>
              {data.atRisk} {athleteLabelPlural.toLowerCase()}
            </strong>{' '}
            are on this week&apos;s call list: attendance dropping, dues late or plan ending soon. A call today saves more renewals than a discount later.
          </p>
        </div>
        <Link className="button-link outline" href="/owner/at-risk" style={{ width: '100%', justifyContent: 'space-between' }}>
          Ranked call list <span>Open</span>
        </Link>
      </section>
      <section className="panel checkins-panel">
        <div className="panel-heading">
          <div>
            <p className="kicker">JUST IN</p>
            <h2>Latest check-ins</h2>
          </div>
        </div>
        <div className="checkin-list">
          {data.latest.length === 0 ? <p className="muted" style={{ paddingTop: 12 }}>No check-ins yet today.</p> : null}
          {data.latest.map((item, index) => (
            <div className="checkin" key={item.id}>
              <div className={`avatar ${AVATAR_COLORS[index % AVATAR_COLORS.length]}`}>{initials(item.name)}</div>
              <div className="checkin-name">
                <strong>{item.name}</strong>
                <span>{item.branch}</span>
              </div>
              <time>{item.time}</time>
              <span className="checkmark">+</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
