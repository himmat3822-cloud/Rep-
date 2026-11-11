import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { AnnouncementForm, EndAnnouncement } from '@/components/growth/actions'
import { StatusBadge } from '@/components/kit/status-badge'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Announcements - Rep+' }

export default async function AnnouncementsPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const db = tenantDb(ctx.gym.id)
  const now = new Date()
  const [rows, branches] = await Promise.all([
    db.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
    db.branch.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  const branchName = new Map(branches.map((b) => [b.id, b.name]))
  const live = rows.filter((r) => !r.expiresAt || r.expiresAt > now)
  const past = rows.filter((r) => r.expiresAt && r.expiresAt <= now)

  return (
    <StaffShell ctx={ctx} title="Announcements">
      <div className="two-col">
        <section className="panel">
          <p className="kicker">NEW ANNOUNCEMENT</p>
          <h2>Tell every member at once</h2>
          <AnnouncementForm branches={branches} />
        </section>
        <section className="panel">
          <p className="kicker">LIVE IN THE MEMBER APP ({live.length})</p>
          <h2>{live.length ? 'Members see the newest pinned one on their home screen' : 'Nothing live'}</h2>
          <ul className="t-list">
            {live.map((a) => (
              <li key={a.id}>
                {a.pinned ? <StatusBadge value="ACTIVE" label="Pinned" /> : <StatusBadge value="SENT" label="Live" />}
                <span className="grow">
                  <strong>{a.title}</strong>
                  <small>{a.body}</small>
                  <small>
                    {formatIstDate(a.createdAt, { day: 'numeric', month: 'short' })}
                    {a.branchId ? ` - ${branchName.get(a.branchId) ?? 'branch'} only` : ''}
                    {a.expiresAt ? ` - until ${formatIstDate(a.expiresAt, { day: 'numeric', month: 'short' })}` : ''}
                    {a.pushed ? ` - pushed to ${a.pushed} phones` : ''}
                  </small>
                </span>
                <EndAnnouncement id={a.id} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      {past.length ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <p className="kicker">ENDED</p>
          <ul className="t-list">
            {past.map((a) => (
              <li key={a.id}>
                <StatusBadge value="EXPIRED" label="Ended" />
                <span className="grow"><strong>{a.title}</strong><small>{a.body}</small></span>
                <small>{formatIstDate(a.createdAt, { day: 'numeric', month: 'short' })}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </StaffShell>
  )
}
