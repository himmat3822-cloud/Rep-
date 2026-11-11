import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageCircle, Phone } from 'lucide-react'
import { StaffShell } from '@/components/staff/staff-shell'
import { FeatureLocked } from '@/components/growth/locked'
import { RecalculateRisk, RiskOutcome } from '@/components/growth/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { atRiskList } from '@/lib/owner/engagement'
import { riskLevel } from '@/lib/owner/risk'
import { daysBetween, formatIstDate, istDateOnly } from '@/lib/time'

export const metadata: Metadata = { title: 'At-risk list - Rep+' }

const OUTCOME_LABEL: Record<string, string> = { REACHED_COMING_BACK: 'Coming back', REACHED_NOT_INTERESTED: 'Not interested', NO_ANSWER: 'No answer, try again', RENEWED: 'Renewed' }

export default async function AtRiskPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const features = await getGymFeatures(ctx.gym.id)
  if (!features.includes('at_risk')) {
    return (
      <StaffShell ctx={ctx} title="At-risk list">
        <FeatureLocked title="Know who is about to quit" plan="Pro">
          Every Monday Rep+ ranks members by how likely they are to leave: attendance dropping against their own normal, late payments, plan ending soon and not opening the app. You get a short call list with the reason for each.
        </FeatureLocked>
      </StaffShell>
    )
  }
  const db = tenantDb(ctx.gym.id)
  const { weekOf, rows } = await atRiskList(db)
  const today = istDateOnly()
  const open = rows.filter((r) => !r.contacted)
  const done = rows.filter((r) => r.contacted)
  const saved = done.filter((r) => r.outcome === 'RENEWED' || r.outcome === 'REACHED_COMING_BACK').length

  return (
    <StaffShell ctx={ctx} title="At-risk list" kicker={`Week of ${formatIstDate(weekOf, { day: 'numeric', month: 'short' })}`}>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ fontSize: 12 }}>
          <strong>{open.length}</strong> to call this week. {done.length ? `${done.length} contacted, ${saved} coming back or renewed.` : 'Highest risk first.'} The list refreshes every night.
        </p>
        <RecalculateRisk />
      </div>

      {rows.length === 0 ? (
        <section className="panel empty-panel">
          <h2>Nobody at risk this week</h2>
          <p>Attendance and payments look healthy. Check again next Monday, or press Refresh after a busy day at the desk.</p>
        </section>
      ) : null}

      {open.length ? (
        <ul className="risk-list">
          {open.map((r) => {
            const level = riskLevel(r.score)
            return (
              <li key={r.id} className={`risk-card ${level}`}>
                <div className="risk-head">
                  <span className={`risk-score ${level}`}>{r.score}</span>
                  <div className="grow">
                    <Link href={`/owner/members/${r.athleteId}`}><strong>{r.name}</strong></Link>
                    <small>
                      {r.plan ?? 'No plan'}
                      {r.endsAt ? ` - ends ${formatIstDate(r.endsAt, { day: 'numeric', month: 'short' })}` : ''}
                      {r.lastVisitAt ? ` - last visit ${daysBetween(istDateOnly(r.lastVisitAt), today)}d ago` : ' - never visited'}
                      {r.trainer ? ` - trainer ${r.trainer}` : ''}
                    </small>
                  </div>
                  <div className="row-actions">
                    <a className="btn btn-outline btn-sm" href={`tel:${r.phone}`}><Phone /> Call</a>
                    <a className="btn btn-outline btn-sm" href={`https://wa.me/${r.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a>
                  </div>
                </div>
                <div className="tag-row">
                  {r.reasons.map((reason) => (
                    <span key={reason} className="tag">{reason}</span>
                  ))}
                </div>
                {r.outcome === 'NO_ANSWER' ? <p className="hint">Tried {r.contactedAt ? formatIstDate(r.contactedAt, { day: 'numeric', month: 'short' }) : ''}{r.contactedBy ? ` by ${r.contactedBy}` : ''}: no answer.{r.note ? ` "${r.note}"` : ''}</p> : null}
                <RiskOutcome id={r.id} name={r.name} />
              </li>
            )
          })}
        </ul>
      ) : null}

      {done.length ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <p className="kicker">CONTACTED THIS WEEK</p>
          <ul className="t-list">
            {done.map((r) => (
              <li key={r.id}>
                <StatusBadge value={r.outcome === 'REACHED_NOT_INTERESTED' ? 'REJECTED' : 'APPROVED'} label={OUTCOME_LABEL[r.outcome] ?? r.outcome} />
                <span className="grow">
                  <Link href={`/owner/members/${r.athleteId}`}>{r.name}</Link>
                  <small>{r.note ? `"${r.note}" - ` : ''}{r.contactedBy ?? 'Staff'}, {r.contactedAt ? formatIstDate(r.contactedAt, { day: 'numeric', month: 'short' }) : ''}</small>
                </span>
                <small>score {r.score}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </StaffShell>
  )
}
