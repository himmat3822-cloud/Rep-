import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarCheck, ClipboardCheck, Flame, IndianRupee, Users, Zap } from 'lucide-react'
import { TrainerShell } from '@/components/trainer/trainer-shell'
import { NudgeButton, PtLogForm } from '@/components/trainer/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { loadRoster } from '@/lib/trainer/roster'
import { monthRange, ptStatus, ptSummaries } from '@/lib/trainer/service'
import { formatInr } from '@/lib/money'
import { formatHour, formatIstDate, istStartOfDay } from '@/lib/time'

export const metadata: Metadata = { title: 'Trainer desk - Rep+' }

export default async function TrainerHomePage() {
  const { user, gym, claims } = await requireStaffPage(['TRAINER', 'OWNER'])
  const db = tenantDb(gym.id)
  const staff = { sub: user.id, kind: user.kind, name: user.name }
  const [roster, features, todaySessions, summary] = await Promise.all([
    loadRoster(db, staff),
    getGymFeatures(gym.id),
    db.ptSession.findMany({ where: { trainerId: user.id, sessionAt: { gte: istStartOfDay() } }, orderBy: { sessionAt: 'asc' } }),
    ptSummaries(db, monthRange(), user.id),
  ])
  const mine = summary.get(user.id)
  const inToday = roster.filter((r) => r.inToday)
  const slotsToday = roster.filter((r) => r.slotToday !== null && !r.inToday).sort((a, b) => (a.slotToday ?? 0) - (b.slotToday ?? 0))
  const needNudge = roster.filter((r) => r.status === 'SLIPPING' || r.status === 'INACTIVE' || (r.idleDays !== null && r.idleDays >= 4)).sort((a, b) => (b.idleDays ?? 99) - (a.idleDays ?? 99)).slice(0, 8)
  const noPlan = roster.filter((r) => !r.hasPlan).length
  const names = new Map(roster.map((r) => [r.id, r.name]))
  const pt = features.includes('pt_tracking')
  const plural = gym.athleteLabelPlural.toLowerCase()
  void claims

  return (
    <TrainerShell gym={gym} user={user} title="Today">
      <div className="metric-row" style={{ marginBottom: 18 }}>
        <div className="metric-card">
          <div className="metric-icon"><Users /></div>
          <div className="metric-copy"><span>My {plural}</span><strong>{roster.length}</strong><small>{noPlan ? `${noPlan} without a plan` : 'All have a plan'}</small></div>
        </div>
        <div className="metric-card">
          <div className="metric-icon blue"><Zap /></div>
          <div className="metric-copy"><span>Trained today</span><strong>{inToday.length}</strong><small>{slotsToday.length} more booked</small></div>
        </div>
        <div className="metric-card">
          <div className="metric-icon orange"><Flame /></div>
          <div className="metric-copy"><span>Need a nudge</span><strong>{needNudge.length}</strong><small>4+ days away or slipping</small></div>
        </div>
        {pt ? (
          <div className="metric-card">
            <div className="metric-icon"><IndianRupee /></div>
            <div className="metric-copy"><span>PT this month</span><strong>{mine?.signed ?? 0} / {mine?.total ?? 0}</strong><small>{formatInr(mine?.commissionPaise ?? 0)} earned (confirmed)</small></div>
          </div>
        ) : null}
      </div>

      <div className="two-col">
        <section className="panel">
          <p className="kicker">COMING IN TODAY</p>
          <h2>Booked slots</h2>
          {slotsToday.length === 0 ? <p className="muted">No more bookings from your {plural} today.</p> : (
            <ul className="t-list">
              {slotsToday.map((r) => (
                <li key={r.id}>
                  <span className="pill"><CalendarCheck /> {formatHour(r.slotToday!)}</span>
                  <Link href={`/trainer/athletes/${r.id}`}>{r.name}</Link>
                  <small>{r.hasPlan ? '' : 'no plan yet'}</small>
                </li>
              ))}
            </ul>
          )}
          <p className="kicker" style={{ marginTop: 18 }}>ALREADY IN ({inToday.length})</p>
          <div className="chip-cloud">
            {inToday.map((r) => <Link key={r.id} href={`/trainer/athletes/${r.id}`} className="chip-link">{r.name}</Link>)}
            {inToday.length === 0 ? <span className="muted">Nobody yet.</span> : null}
          </div>
        </section>

        <section className="panel">
          <p className="kicker">NEED A NUDGE</p>
          <h2>Bring them back</h2>
          {needNudge.length === 0 ? <p className="muted">Everyone is showing up. Nice work.</p> : (
            <ul className="t-list">
              {needNudge.map((r) => (
                <li key={r.id}>
                  <StatusBadge value={r.status} />
                  <span className="grow">
                    <Link href={`/trainer/athletes/${r.id}`}>{r.name}</Link>
                    <small>{r.idleDays === null ? 'never checked in' : `${r.idleDays} days since last visit`}</small>
                  </span>
                  <NudgeButton athleteId={r.id} name={r.name} compact />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {pt ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <p className="kicker">PT SESSIONS</p>
          <h2>Log a session</h2>
          <PtLogForm athletes={roster.map((r) => ({ id: r.id, name: r.name }))} />
          {todaySessions.length ? (
            <ul className="t-list" style={{ marginTop: 14 }}>
              {todaySessions.map((s) => {
                const status = ptStatus(s)
                return (
                  <li key={s.id}>
                    <span className="pill"><ClipboardCheck /> {formatIstDate(s.sessionAt, { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="grow">{names.get(s.athleteId) ?? 'Member'} <small>{s.durationMin} min</small></span>
                    <StatusBadge value={status === 'signed' ? 'APPROVED' : status === 'disputed' ? 'REJECTED' : 'PENDING'} label={status === 'signed' ? 'Confirmed' : status === 'disputed' ? 'Disputed' : 'Waiting for member'} />
                  </li>
                )
              })}
            </ul>
          ) : null}
        </section>
      ) : null}
    </TrainerShell>
  )
}
