import Link from 'next/link'
import { Building2, MapPin, Users, Wallet, Zap } from 'lucide-react'
import type { BranchCard } from '@/lib/owner/overview'
import { formatInrCompact } from '@/lib/money'

// Multi-branch owners: switch the whole Overview between "All branches" and
// one branch, and compare branches side by side.

export function BranchSwitch({ base, branches, active }: { base: string; branches: { id: string; name: string }[]; active: string | null }) {
  return (
    <nav className="branch-switch" aria-label="Branch">
      <Link href={base} className={active ? '' : 'on'} scroll={false}>
        <Building2 /> All branches
      </Link>
      {branches.map((branch) => (
        <Link key={branch.id} href={`${base}?branch=${branch.id}`} className={active === branch.id ? 'on' : ''} scroll={false}>
          <MapPin /> {branch.name}
        </Link>
      ))}
    </nav>
  )
}

export function BranchCompare({ base, cards }: { base: string; cards: BranchCard[] }) {
  const most = Math.max(1, ...cards.map((card) => card.collectedThisMonthPaise))
  return (
    <section className="panel branch-compare">
      <div className="panel-heading">
        <div>
          <p className="kicker">YOUR BRANCHES</p>
          <h3>Side by side, right now</h3>
        </div>
      </div>
      <div className="branch-cards">
        {cards.map((card) => (
          <Link key={card.id} href={`${base}?branch=${card.id}`} className="branch-card" scroll={false}>
            <div className="branch-card-head">
              <strong>{card.name}</strong>
              <span className={`branch-floor ${card.percent >= 75 ? 'hot' : card.percent >= 35 ? 'warm' : ''}`}>
                <Zap /> {card.inside} inside - {card.percent}%
              </span>
            </div>
            <dl>
              <div>
                <dt>
                  <Users /> Active
                </dt>
                <dd>{card.activeMembers}</dd>
              </div>
              <div>
                <dt>Check-ins today</dt>
                <dd>{card.todayCheckIns}</dd>
              </div>
              <div>
                <dt>
                  <Wallet /> Collected
                </dt>
                <dd>{formatInrCompact(card.collectedThisMonthPaise)}</dd>
              </div>
              <div>
                <dt>Pending dues</dt>
                <dd className={card.pendingDuesPaise ? 'warn' : ''}>{formatInrCompact(card.pendingDuesPaise)}</dd>
              </div>
            </dl>
            <div className="branch-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((card.collectedThisMonthPaise / most) * 100)}%` }} />
            </div>
            <small>{card.atRisk ? `${card.atRisk} members to call this week` : 'No one on the call list'}</small>
          </Link>
        ))}
      </div>
    </section>
  )
}
