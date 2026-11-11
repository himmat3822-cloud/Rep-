import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, Plus, Search } from 'lucide-react'
import { AdminFrame } from '@/components/admin/admin-frame'
import { StatusBadge } from '@/components/kit/status-badge'
import { Pager } from '@/components/kit/pager'
import { prisma } from '@/lib/db/client'
import { listGyms } from '@/lib/platform/gyms'
import { gymListQuerySchema } from '@/lib/validation/admin'
import { formatInr } from '@/lib/money'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Gyms - Rep+ Admin' }

const STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'READ_ONLY', 'SUSPENDED', 'CANCELLED']
const shortDate = (date: Date | null) => (date ? formatIstDate(date, { day: 'numeric', month: 'short', year: '2-digit' }) : '-')

export default async function AdminGymsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams
  const parsed = gymListQuerySchema.safeParse(raw)
  const filter = parsed.success ? parsed.data : { page: 1 }
  const result = await listGyms(prisma, filter)

  return (
    <AdminFrame title="Gyms">
      <div className="page-head">
        <form className="toolbar" method="get">
          <input name="q" defaultValue={filter.q ?? ''} placeholder="Search gym, link, city, owner, phone" aria-label="Search gyms" />
          <select name="status" defaultValue={filter.status ?? ''} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace('_', ' ')}
              </option>
            ))}
          </select>
          <button className="btn btn-dark" type="submit">
            <Search /> Search
          </button>
        </form>
        <div className="toolbar">
          <a className="btn btn-outline" href="/api/admin/export/gyms">
            <Download /> CSV
          </a>
          <Link className="btn btn-lime" href="/admin/gyms/new">
            <Plus /> New gym
          </Link>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Gym</th>
              <th>Owner</th>
              <th>Plan</th>
              <th>Status</th>
              <th className="num">Members</th>
              <th className="num">MRR</th>
              <th>Last paid</th>
              <th>Next due</th>
              <th>WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const pct = row.whatsappQuota ? Math.min(100, Math.round((row.whatsappUsed / row.whatsappQuota) * 100)) : 0
              return (
                <tr key={row.id}>
                  <td>
                    <Link href={`/admin/gyms/${row.id}`}>{row.name}</Link>
                    <span className="sub">
                      {row.city} - /g/{row.slug}
                    </span>
                  </td>
                  <td>
                    {row.ownerName}
                    <span className="sub">{row.ownerPhone}</span>
                  </td>
                  <td>
                    {row.planName}
                    <span className="sub">{row.branches} branch(es)</span>
                  </td>
                  <td>
                    <StatusBadge value={row.status} />
                  </td>
                  <td className="num">{row.members}</td>
                  <td className="num">{formatInr(row.mrrPaise)}</td>
                  <td>{shortDate(row.lastPaidAt)}</td>
                  <td>{shortDate(row.nextDueAt)}</td>
                  <td>
                    <span className="mono">
                      {row.whatsappUsed}/{row.whatsappQuota}
                    </span>
                    <div className={`usage-bar ${pct >= 80 ? 'warn' : ''}`}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {result.rows.length === 0 ? <div className="table-empty">No gyms match. Clear the search or create a gym.</div> : null}
        <Pager page={result.page} pages={result.pages} total={result.total} basePath="/admin/gyms" params={{ q: filter.q, status: filter.status }} />
      </div>
    </AdminFrame>
  )
}
