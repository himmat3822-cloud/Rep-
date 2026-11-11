import Link from 'next/link'
import type { TenantDb } from '@/lib/db/tenant-core'
import { formatInr } from '@/lib/money'
import { formatIstDate } from '@/lib/time'
import { ClaimActions, FreezeActions } from './request-actions'

// Member requests waiting for the gym: "I've paid" UPI claims and freeze
// requests. Shown on Payments (owner) and the desk home.

const when = (date: Date) => formatIstDate(date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const day = (date: Date) => formatIstDate(date, { day: 'numeric', month: 'short' })

export async function pendingCounts(db: TenantDb) {
  const [claims, freezes] = await Promise.all([db.memberPaymentClaim.count({ where: { status: 'PENDING' } }), db.freezeRequest.count({ where: { status: 'PENDING' } })])
  return { claims, freezes }
}

export async function ClaimsQueue({ db, memberHref }: { db: TenantDb; memberHref?: (id: string) => string }) {
  const claims = await db.memberPaymentClaim.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 50 })
  if (claims.length === 0) return <div className="table-empty">No UPI payments waiting. When a member taps "I&apos;ve paid" in the app, it shows up here.</div>
  const [athletes, plans, dues] = await Promise.all([
    db.athlete.findMany({ where: { id: { in: claims.map((c) => c.athleteId) } }, select: { id: true, name: true, memberCode: true, phone: true } }),
    db.membershipPlan.findMany({ where: { id: { in: claims.map((c) => c.planId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } }),
    db.due.findMany({ where: { id: { in: claims.map((c) => c.dueId).filter((id): id is string => Boolean(id)) } }, select: { id: true, amountPaise: true, dueDate: true } }),
  ])
  const athleteById = new Map(athletes.map((a) => [a.id, a]))
  const planById = new Map(plans.map((p) => [p.id, p.name]))
  const dueById = new Map(dues.map((d) => [d.id, d]))
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Sent</th>
            <th>Member</th>
            <th>For</th>
            <th className="num">Amount</th>
            <th>UPI reference</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => {
            const athlete = athleteById.get(claim.athleteId)
            const due = claim.dueId ? dueById.get(claim.dueId) : null
            return (
              <tr key={claim.id}>
                <td>{when(claim.createdAt)}</td>
                <td>
                  {athlete && memberHref ? <Link href={memberHref(athlete.id)}>{athlete.name}</Link> : (athlete?.name ?? '-')}
                  <span className="sub">{athlete?.memberCode}</span>
                </td>
                <td>
                  {claim.kind === 'DUE' ? `Due ${due ? `of ${formatInr(due.amountPaise)} (${day(due.dueDate)})` : ''}` : `Renewal: ${planById.get(claim.planId ?? '') ?? 'plan'}`}
                  {claim.discountPaise ? <span className="sub">Early renewal discount {formatInr(claim.discountPaise)}</span> : null}
                  {claim.note ? <span className="sub">&quot;{claim.note}&quot;</span> : null}
                </td>
                <td className="num">{formatInr(claim.amountPaise)}</td>
                <td>
                  <code className="utr">{claim.utr}</code>
                  <span className="sub">Match it in your bank / UPI app</span>
                </td>
                <td>
                  <ClaimActions id={claim.id} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export async function FreezeQueue({ db, memberHref }: { db: TenantDb; memberHref?: (id: string) => string }) {
  const requests = await db.freezeRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 50 })
  if (requests.length === 0) return <div className="table-empty">No freeze requests waiting.</div>
  const [athletes, memberships] = await Promise.all([
    db.athlete.findMany({ where: { id: { in: requests.map((r) => r.athleteId) } }, select: { id: true, name: true, memberCode: true } }),
    db.membership.findMany({ where: { id: { in: requests.map((r) => r.membershipId) } }, select: { id: true, endsAt: true, freezeDaysUsed: true } }),
  ])
  const athleteById = new Map(athletes.map((a) => [a.id, a]))
  const membershipById = new Map(memberships.map((m) => [m.id, m]))
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Asked</th>
            <th>Member</th>
            <th>Freeze</th>
            <th>Reason</th>
            <th>Plan ends</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const athlete = athleteById.get(request.athleteId)
            const membership = membershipById.get(request.membershipId)
            return (
              <tr key={request.id}>
                <td>{when(request.createdAt)}</td>
                <td>
                  {athlete && memberHref ? <Link href={memberHref(athlete.id)}>{athlete.name}</Link> : (athlete?.name ?? '-')}
                  <span className="sub">{athlete?.memberCode}</span>
                </td>
                <td>
                  {request.days} days from {day(request.fromDate)}
                </td>
                <td>{request.reason || '-'}</td>
                <td>
                  {membership ? day(membership.endsAt) : '-'}
                  {membership ? <span className="sub">moves to {day(new Date(membership.endsAt.getTime() + request.days * 86400000))}</span> : null}
                </td>
                <td>
                  <FreezeActions id={request.id} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
