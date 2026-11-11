import type { Metadata } from 'next'
import Link from 'next/link'
import { StaffShell } from '@/components/staff/staff-shell'
import { AssignMembers } from '@/components/trainer/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { monthRange, ptStatus, ptSummaries } from '@/lib/trainer/service'
import { formatInr } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Trainers and PT - Rep+' }

export default async function OwnerTrainersPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await requireStaffPage(['OWNER'])
  const db = tenantDb(ctx.gym.id)
  const offset = Math.max(-12, Math.min(0, Number((await searchParams).m ?? 0) || 0))
  const range = monthRange(new Date(), offset)
  const [trainers, athletes, summaries, disputed] = await Promise.all([
    db.gymUser.findMany({ where: { kind: { in: ['TRAINER', 'OWNER'] }, active: true }, orderBy: [{ kind: 'desc' }, { name: 'asc' }], select: { id: true, name: true, kind: true, commissionPct: true, ptSessionFeePaise: true } }),
    db.athlete.findMany({ where: { archived: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, memberCode: true, trainerId: true, status: true } }),
    ptSummaries(db, range),
    db.ptSession.findMany({ where: { athleteDisputedAt: { not: null }, sessionAt: { gte: range.start, lt: range.end } }, orderBy: { sessionAt: 'desc' }, take: 20, include: { trainer: { select: { name: true } } } }),
  ])
  const trainerName = new Map(trainers.map((t) => [t.id, t.name]))
  const athleteName = new Map(athletes.map((a) => [a.id, a.name]))
  const counts = new Map<string, { total: number; slipping: number }>()
  for (const a of athletes) {
    if (!a.trainerId) continue
    const row = counts.get(a.trainerId) ?? { total: 0, slipping: 0 }
    row.total += 1
    if (a.status === 'SLIPPING' || a.status === 'INACTIVE') row.slipping += 1
    counts.set(a.trainerId, row)
  }
  const unassigned = athletes.filter((a) => !a.trainerId).length
  const totalCommission = [...summaries.values()].reduce((sum, row) => sum + row.commissionPaise, 0)

  return (
    <StaffShell ctx={ctx} title="Trainers and PT">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="tab-links" style={{ margin: 0 }}>
          <Link href={`/owner/trainers?m=${offset - 1}`}>Previous</Link>
          <Link className="active" href={`/owner/trainers?m=${offset}`}>{range.label}</Link>
          {offset < 0 ? <Link href={`/owner/trainers?m=${offset + 1}`}>Next</Link> : null}
        </div>
        <span className="muted">Commission to pay for {range.label}: <strong>{formatInr(totalCommission)}</strong> (confirmed sessions only)</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Trainer</th><th className="num">Members</th><th className="num">Slipping</th><th className="num">PT sessions</th><th className="num">Confirmed</th><th className="num">Waiting</th><th className="num">Disputed</th><th className="num">Fee / %</th><th className="num">Commission</th></tr>
          </thead>
          <tbody>
            {trainers.map((t) => {
              const s = summaries.get(t.id)
              const c = counts.get(t.id)
              return (
                <tr key={t.id}>
                  <td>{t.name}<span className="sub">{t.kind === 'OWNER' ? 'Owner' : 'Trainer'}</span></td>
                  <td className="num">{c?.total ?? 0}</td>
                  <td className="num">{c?.slipping ?? 0}</td>
                  <td className="num">{s?.total ?? 0}</td>
                  <td className="num">{s?.signed ?? 0}</td>
                  <td className="num">{s?.pending ?? 0}</td>
                  <td className="num">{s?.disputed ?? 0}</td>
                  <td className="num">{formatInr(t.ptSessionFeePaise)} / {t.commissionPct}%</td>
                  <td className="num"><strong>{formatInr(s?.commissionPaise ?? 0)}</strong></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted" style={{ padding: '0 16px 14px' }}>Set each trainer&apos;s PT session fee and commission % in <Link href="/owner/settings/staff">Settings &gt; Staff</Link>.</p>
      </div>

      {disputed.length ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <p className="kicker">DISPUTED BY MEMBERS</p>
          <ul className="t-list">
            {disputed.map((s) => (
              <li key={s.id}>
                <StatusBadge value="REJECTED" label="Disputed" />
                <span className="grow">{athleteName.get(s.athleteId) ?? 'Member'} with {s.trainer.name}, {formatIstDate(s.sessionAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}<small>{s.disputeNote ? `"${s.disputeNote}"` : 'No reason given'}</small></span>
                <small>{ptStatus(s)}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel" style={{ marginTop: 18 }}>
        <p className="kicker">ASSIGN MEMBERS ({unassigned} WITHOUT A TRAINER)</p>
        <h2>Who trains whom</h2>
        <AssignMembers trainers={trainers.map((t) => ({ id: t.id, name: t.name }))} athletes={athletes.map((a) => ({ id: a.id, name: a.name, memberCode: a.memberCode, trainerName: a.trainerId ? (trainerName.get(a.trainerId) ?? 'Inactive trainer') : null }))} />
      </section>
    </StaffShell>
  )
}
