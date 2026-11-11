import type { Metadata } from 'next'
import Link from 'next/link'
import { TrainerShell } from '@/components/trainer/trainer-shell'
import { NudgeButton } from '@/components/trainer/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { loadRoster } from '@/lib/trainer/roster'
import { formatHour } from '@/lib/time'

export const metadata: Metadata = { title: 'My members - Rep+' }

const FILTERS = [
  ['all', 'All'],
  ['in', 'In today'],
  ['nudge', 'Need a nudge'],
  ['noplan', 'No plan'],
  ['pt', 'PT to confirm'],
] as const

export default async function RosterPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const { user, gym } = await requireStaffPage(['TRAINER', 'OWNER'])
  const { f = 'all', q = '' } = await searchParams
  const roster = await loadRoster(tenantDb(gym.id), { sub: user.id, kind: user.kind, name: user.name })
  const query = q.trim().toLowerCase()
  const rows = roster.filter((r) => {
    if (query && !`${r.name} ${r.memberCode}`.toLowerCase().includes(query)) return false
    if (f === 'in') return r.inToday
    if (f === 'nudge') return r.status === 'SLIPPING' || r.status === 'INACTIVE' || (r.idleDays !== null && r.idleDays >= 4)
    if (f === 'noplan') return !r.hasPlan
    if (f === 'pt') return r.pendingPt > 0
    return true
  })
  return (
    <TrainerShell gym={gym} user={user} title={`My ${gym.athleteLabelPlural.toLowerCase()}`}>
      <form className="filter-row" method="get">
        <input className="search-input" name="q" defaultValue={q} placeholder="Search name or code" />
        <input type="hidden" name="f" value={f} />
        <button className="btn btn-dark btn-sm">Search</button>
      </form>
      <div className="tab-links" style={{ marginBottom: 14 }}>
        {FILTERS.map(([key, label]) => (
          <Link key={key} className={f === key ? 'active' : ''} href={`/trainer/athletes?f=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>
            {label}
          </Link>
        ))}
      </div>
      {roster.length === 0 ? (
        <div className="table-empty">No members are assigned to you yet. The owner assigns them from Members or Trainers and PT.</div>
      ) : (
        <div className="roster-grid">
          {rows.map((r) => (
            <div key={r.id} className={`roster-card ${r.inToday ? 'in' : ''}`}>
              <div className="row-between">
                <Link href={`/trainer/athletes/${r.id}`} className="roster-name">
                  <strong>{r.name}</strong>
                  <small>{r.memberCode}</small>
                </Link>
                <StatusBadge value={r.status} />
              </div>
              <dl className="roster-facts">
                <div><dt>Last visit</dt><dd>{r.inToday ? 'Today' : r.idleDays === null ? 'Never' : `${r.idleDays}d ago`}</dd></div>
                <div><dt>Streak</dt><dd>{r.streakDays}d</dd></div>
                <div><dt>Plan ends</dt><dd>{r.daysLeft === null ? 'No plan' : `${r.daysLeft}d`}</dd></div>
                <div><dt>Slot today</dt><dd>{r.slotToday === null ? '-' : formatHour(r.slotToday)}</dd></div>
              </dl>
              <div className="row-between">
                <div className="tag-row">
                  {!r.hasPlan ? <span className="tag warn">No workout plan</span> : <span className="tag">Plan set</span>}
                  {r.pendingPt ? <span className="tag">{r.pendingPt} PT to confirm</span> : null}
                  {r.ptLeft ? <span className="tag">{r.ptLeft} PT left</span> : null}
                </div>
                <NudgeButton athleteId={r.id} name={r.name} compact />
              </div>
            </div>
          ))}
          {rows.length === 0 ? <div className="table-empty">Nobody matches this filter.</div> : null}
        </div>
      )}
    </TrainerShell>
  )
}
