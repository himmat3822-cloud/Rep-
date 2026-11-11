import Link from 'next/link'
import { StaffShell, type StaffPageContext } from '@/components/staff/staff-shell'
import { ComplaintActions } from '@/components/growth/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { tenantDb } from '@/lib/db/tenant'
import { privateImageUrl } from '@/lib/integrations/cloudinary'
import { formatIstDate } from '@/lib/time'

// Complaints and equipment issues board, shared by owner and desk.
const KIND_LABEL: Record<string, string> = { FEEDBACK: 'Feedback', EQUIPMENT: 'Equipment', CLEANLINESS: 'Cleanliness', STAFF: 'Staff', OTHER: 'Other' }
const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
] as const

export async function ComplaintsScreen({ ctx, filter }: { ctx: StaffPageContext; filter?: string }) {
  const base = ctx.user.kind === 'OWNER' ? '/owner' : '/desk'
  const showResolved = filter === 'resolved'
  const db = tenantDb(ctx.gym.id)
  const [rows, openCount, branches] = await Promise.all([
    db.complaint.findMany({ where: showResolved ? { status: 'RESOLVED' } : { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: showResolved ? { resolvedAt: 'desc' } : [{ status: 'asc' }, { createdAt: 'asc' }], take: 100 }),
    db.complaint.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    db.branch.findMany({ select: { id: true, name: true } }),
  ])
  const athletes = rows.some((r) => r.athleteId) ? await db.athlete.findMany({ where: { id: { in: rows.map((r) => r.athleteId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }) : []
  const who = new Map(athletes.map((a) => [a.id, a.name]))
  const branchName = new Map(branches.map((b) => [b.id, b.name]))
  const fmt = (d: Date) => formatIstDate(d, { day: 'numeric', month: 'short' })

  return (
    <StaffShell ctx={ctx} title="Complaints and equipment">
      <div className="tab-links" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <Link key={f.key} className={(f.key === 'resolved') === showResolved ? 'active' : ''} href={`${base}/complaints?filter=${f.key}`}>
            {f.label}
            {f.key === 'open' && openCount ? <span className="tab-count">{openCount}</span> : null}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <section className="panel empty-panel">
          <h2>{showResolved ? 'Nothing resolved yet' : 'No open complaints'}</h2>
          <p>Members report broken equipment, cleanliness and feedback from Profile in their app. Each one shows up here.</p>
        </section>
      ) : (
        <ul className="complaint-list">
          {rows.map((c) => {
            const photo = c.photoPublicId ? privateImageUrl(c.photoPublicId, 'c_fill,w_240,h_240,q_auto,f_auto') : null
            return (
              <li key={c.id} className="panel">
                <div className="row-between">
                  <div>
                    <span className="tag">{KIND_LABEL[c.kind] ?? c.kind}</span> <strong>{c.title}</strong>
                    <small className="sub">
                      {c.athleteId ? who.get(c.athleteId) ?? 'Member' : 'Staff note'} - {fmt(c.createdAt)}
                      {c.branchId ? ` - ${branchName.get(c.branchId) ?? ''}` : ''}
                    </small>
                  </div>
                  <StatusBadge value={c.status === 'RESOLVED' ? 'APPROVED' : c.status === 'IN_PROGRESS' ? 'SENT' : 'PENDING'} label={c.status === 'IN_PROGRESS' ? 'In progress' : c.status === 'RESOLVED' ? 'Resolved' : 'Open'} />
                </div>
                <div className="complaint-body">
                  {photo ? <a href={privateImageUrl(c.photoPublicId!) ?? '#'} target="_blank" rel="noreferrer"><img src={photo} alt="" loading="lazy" /></a> : null}
                  <p>{c.body}</p>
                </div>
                {c.resolutionNote ? <p className="hint">Fix: {c.resolutionNote}{c.resolvedAt ? ` (${fmt(c.resolvedAt)})` : ''}</p> : null}
                <ComplaintActions id={c.id} status={c.status} />
              </li>
            )
          })}
        </ul>
      )}
    </StaffShell>
  )
}
