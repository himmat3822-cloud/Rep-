import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, Plus } from 'lucide-react'
import { AdminFrame } from '@/components/admin/admin-frame'
import { StatusBadge } from '@/components/kit/status-badge'
import { prisma } from '@/lib/db/client'
import { formatInr } from '@/lib/money'

export const metadata: Metadata = { title: 'Plans - Rep+ Admin' }

export default async function AdminPlansPage() {
  const plans = await prisma.platformPlan.findMany({ orderBy: [{ archived: 'asc' }, { sortOrder: 'asc' }], include: { _count: { select: { subscriptions: true } } } })
  return (
    <AdminFrame title="Plans and features">
      <div className="page-head">
        <p>Edit prices, limits and feature flags. Changes apply to existing gyms from their next invoice. Archived plans stay on current subscribers but cannot be picked by new gyms.</p>
        <div className="toolbar">
          <a className="btn btn-outline" href="/api/admin/export/plans">
            <Download /> CSV
          </a>
          <Link className="btn btn-lime" href="/admin/plans/new">
            <Plus /> New plan
          </Link>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th className="num">Monthly</th>
              <th className="num">Annual</th>
              <th>Limits</th>
              <th className="num">WhatsApp</th>
              <th className="num">Features</th>
              <th className="num">Gyms</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id}>
                <td>
                  <Link href={`/admin/plans/${plan.id}`}>{plan.name}</Link>
                  {plan.isPopular ? <span className="badge badge-lime" style={{ marginLeft: 8 }}>Popular</span> : null}
                  <span className="sub">{plan.code}</span>
                </td>
                <td className="num">{formatInr(plan.monthlyPricePaise)}</td>
                <td className="num">{formatInr(plan.annualPricePaise)}</td>
                <td>
                  {plan.branchLimit} branch, {plan.memberLimit ?? 'unlimited'} members
                  <span className="sub">
                    {plan.staffLimit ?? 'unlimited'} staff{plan.extraBranchPaise ? ` - ${formatInr(plan.extraBranchPaise)}/extra branch` : ''}
                  </span>
                </td>
                <td className="num">{plan.whatsappQuota.toLocaleString('en-IN')}</td>
                <td className="num">{plan.features.length}</td>
                <td className="num">{plan._count.subscriptions}</td>
                <td>{plan.archived ? <StatusBadge value="ARCHIVED" /> : <StatusBadge value="ACTIVE" label="Live" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {plans.length === 0 ? <div className="table-empty">No plans yet. Create the first one.</div> : null}
      </div>
    </AdminFrame>
  )
}
