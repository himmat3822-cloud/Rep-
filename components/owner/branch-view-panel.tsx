import { Users, Wallet, Zap } from 'lucide-react'
import { getBranchComparison } from '@/lib/owner/overview'
import type { BranchView } from '@/lib/owner/branch-view'
import { formatInrCompact } from '@/lib/money'
import { DashboardStylePicker, OpenBranchButton } from './branch-view-controls'

// Branch view page for owners of a multi-branch gym: choose the dashboard
// style and (in "one branch at a time") which branch to open. Also shown by
// app/owner/layout.tsx in place of any page until a branch is chosen.

export async function BranchViewPanel({ gymId, sessionMinutes, view }: { gymId: string; sessionMinutes: number; view: BranchView }) {
  const separate = view.mode === 'separate'
  const cards = separate ? await getBranchComparison(gymId, sessionMinutes) : []
  return (
    <div className="bv-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="kicker">DASHBOARD STYLE</p>
            <h3>How do you want to see your branches?</h3>
          </div>
        </div>
        <DashboardStylePicker mode={view.mode} />
      </section>

      {separate ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="kicker">YOUR BRANCHES</p>
              <h3>{view.branchName ? `Now open: ${view.branchName}` : 'Which branch do you want to open?'}</h3>
            </div>
          </div>
          <div className="branch-cards">
            {cards.map((card) => (
              <div key={card.id} className={`branch-card bv-card ${card.id === view.branchId ? 'on' : ''}`}>
                <div className="branch-card-head">
                  <strong>{card.name}</strong>
                  <span className={`branch-floor ${card.percent >= 75 ? 'hot' : card.percent >= 35 ? 'warm' : ''}`}>
                    <Zap /> {card.inside} inside
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
                <OpenBranchButton branchId={card.id} label={card.name} current={card.id === view.branchId} />
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
