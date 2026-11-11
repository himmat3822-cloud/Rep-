import type { Metadata } from 'next'
import Link from 'next/link'
import { TrainerShell } from '@/components/trainer/trainer-shell'
import { DeleteButton, PtLogForm } from '@/components/trainer/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { getGymFeatures } from '@/lib/gym/features'
import { loadRoster } from '@/lib/trainer/roster'
import { monthRange, ptStatus, ptSummaries } from '@/lib/trainer/service'
import { formatInr } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'PT sessions - Rep+' }

export default async function PtSessionsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { user, gym } = await requireStaffPage(['TRAINER', 'OWNER'])
  const db = tenantDb(gym.id)
  const offset = Math.max(-12, Math.min(0, Number((await searchParams).m ?? 0) || 0))
  const range = monthRange(new Date(), offset)
  const features = await getGymFeatures(gym.id)
  if (!features.includes('pt_tracking')) {
    return (
      <TrainerShell gym={gym} user={user} title="PT sessions">
        <div className="table-empty">PT tracking is not in this gym&apos;s Rep+ plan.</div>
      </TrainerShell>
    )
  }
  const [roster, sessions, summaries, me] = await Promise.all([
    loadRoster(db, { sub: user.id, kind: user.kind, name: user.name }),
    db.ptSession.findMany({ where: { trainerId: user.id, sessionAt: { gte: range.start, lt: range.end } }, orderBy: { sessionAt: 'desc' } }),
    ptSummaries(db, range, user.id),
    db.gymUser.findFirst({ where: { id: user.id }, select: { ptSessionFeePaise: true, commissionPct: true } }),
  ])
  const names = new Map((await db.athlete.findMany({ where: { id: { in: [...new Set(sessions.map((s) => s.athleteId))] } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]))
  const sum = summaries.get(user.id)
  return (
    <TrainerShell gym={gym} user={user} title="PT sessions">
      <section className="panel" style={{ marginBottom: 14 }}>
        <p className="kicker">LOG A SESSION</p>
        <PtLogForm athletes={roster.map((r) => ({ id: r.id, name: r.name }))} />
        <p className="hint" style={{ marginTop: 8 }}>
          The member gets a notification to confirm it. Commission ({me?.commissionPct ?? 0}% of {formatInr(me?.ptSessionFeePaise ?? 0)} per session) counts only once they confirm.
        </p>
      </section>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <div className="tab-links" style={{ margin: 0 }}>
          <Link href={`/trainer/sessions?m=${offset - 1}`}>Previous</Link>
          <Link className="active" href={`/trainer/sessions?m=${offset}`}>{range.label}</Link>
          {offset < 0 ? <Link href={`/trainer/sessions?m=${offset + 1}`}>Next</Link> : null}
        </div>
      </div>
      <div className="sum-strip">
        <div>Sessions<strong>{sum?.total ?? 0}</strong></div>
        <div>Confirmed<strong>{sum?.signed ?? 0}</strong></div>
        <div>Waiting<strong>{sum?.pending ?? 0}</strong></div>
        <div>Disputed<strong>{sum?.disputed ?? 0}</strong></div>
        <div>Commission earned<strong>{formatInr(sum?.commissionPaise ?? 0)}</strong></div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>When</th><th>Member</th><th>Minutes</th><th>Notes</th><th>Status</th><th className="num">Commission</th><th /></tr></thead>
          <tbody>
            {sessions.map((s) => {
              const status = ptStatus(s)
              return (
                <tr key={s.id}>
                  <td>{formatIstDate(s.sessionAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td><Link href={`/trainer/athletes/${s.athleteId}?tab=pt`}>{names.get(s.athleteId) ?? 'Member'}</Link></td>
                  <td>{s.durationMin}</td>
                  <td>{s.notes || '-'}{s.disputeNote ? <span className="sub">Member: &quot;{s.disputeNote}&quot;</span> : null}</td>
                  <td><StatusBadge value={status === 'signed' ? 'APPROVED' : status === 'disputed' ? 'REJECTED' : 'PENDING'} label={status === 'signed' ? 'Confirmed' : status === 'disputed' ? 'Disputed' : 'Waiting'} /></td>
                  <td className="num">{status === 'signed' ? formatInr(s.commissionPaise) : '-'}</td>
                  <td>{status === 'pending' ? <DeleteButton url={`/api/gym/pt-sessions/${s.id}`} label="Delete session" confirm="Delete this session?" done="Session deleted" /> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {sessions.length === 0 ? <div className="table-empty">No sessions in {range.label}.</div> : null}
      </div>
    </TrainerShell>
  )
}
