import type { Metadata } from 'next'
import { Download, Search } from 'lucide-react'
import { AdminFrame } from '@/components/admin/admin-frame'
import { StatusBadge } from '@/components/kit/status-badge'
import { Pager } from '@/components/kit/pager'
import { prisma } from '@/lib/db/client'
import { auditQuerySchema } from '@/lib/validation/admin'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Audit log - Rep+ Admin' }

const PAGE_SIZE = 50

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const parsed = auditQuerySchema.safeParse(await searchParams)
  const filter = parsed.success ? parsed.data : { page: 1 }
  const where = { ...(filter.gymId ? { gymId: filter.gymId } : {}), ...(filter.action ? { action: { contains: filter.action } } : {}) }
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (filter.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ])
  const gymIds = [...new Set(rows.map((row) => row.gymId).filter(Boolean))] as string[]
  const adminIds = [...new Set(rows.map((row) => row.adminUserId).filter(Boolean))] as string[]
  const [gyms, admins] = await Promise.all([
    prisma.gym.findMany({ where: { id: { in: gymIds } }, select: { id: true, name: true } }),
    prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, adminId: true } }),
  ])
  const gymName = new Map(gyms.map((gym) => [gym.id, gym.name]))
  const adminName = new Map(admins.map((admin) => [admin.id, admin.adminId]))

  return (
    <AdminFrame title="Audit log">
      <div className="page-head">
        <form className="toolbar" method="get">
          <input name="action" defaultValue={filter.action ?? ''} placeholder="Filter by action, e.g. gym.suspend" />
          {filter.gymId ? <input type="hidden" name="gymId" value={filter.gymId} /> : null}
          <button className="btn btn-dark" type="submit">
            <Search /> Filter
          </button>
        </form>
        <a className="btn btn-outline" href="/api/admin/export/audit">
          <Download /> CSV
        </a>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>When (IST)</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Gym</th>
              <th>Reason</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatIstDate(row.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>
                  <StatusBadge value={row.actorType} />
                  <span className="sub">{row.adminUserId ? adminName.get(row.adminUserId) ?? row.actorId : row.actorId}</span>
                </td>
                <td className="mono">{row.action}</td>
                <td>{row.gymId ? gymName.get(row.gymId) ?? row.gymId : '-'}</td>
                <td>{row.reason ?? '-'}</td>
                <td>
                  <pre className="meta-pre">{row.meta ? JSON.stringify(row.meta) : row.entityId ?? ''}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="table-empty">No audit entries match.</div> : null}
        <Pager page={filter.page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} basePath="/admin/audit" params={{ action: filter.action, gymId: filter.gymId }} />
      </div>
    </AdminFrame>
  )
}
