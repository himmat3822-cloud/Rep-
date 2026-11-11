import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { PlanEditor } from '@/components/owner/plan-editor'
import { requireStaffPage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'

export const metadata: Metadata = { title: 'Membership plans - Rep+' }

export default async function MembershipPlansPage() {
  const ctx = await requireStaffPage(['OWNER'])
  const db = tenantDb(ctx.gym.id)
  const [plans, sold, branches] = await Promise.all([
    db.membershipPlan.findMany({ orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { durationDays: 'asc' }] }),
    db.membership.groupBy({ by: ['planId'], _count: { _all: true } }),
    db.branch.count({ where: { archived: false } }),
  ])
  const soldBy = new Map(sold.map((row) => [row.planId, row._count._all]))
  return (
    <StaffShell ctx={ctx} title="Membership plans">
      <div style={{ maxWidth: 900 }}>
        <p className="muted" style={{ marginBottom: 14 }}>
          Changing a price only affects new sales. Members keep the price they paid. Turn a plan off instead of deleting it.
        </p>
        <PlanEditor
          multiBranch={branches > 1}
          plans={plans.map((plan) => ({
            id: plan.id,
            name: plan.name,
            durationDays: plan.durationDays,
            priceRupees: plan.pricePaise / 100,
            joiningFeeRupees: plan.joiningFeePaise / 100,
            gstPercent: plan.gstPercent,
            gstInclusive: plan.gstInclusive,
            maxFreezeDays: plan.maxFreezeDays,
            crossBranch: plan.crossBranch,
            ptAddonRupees: plan.ptAddonPaise === null ? '' : plan.ptAddonPaise / 100,
            ptSessionsIncluded: plan.ptSessionsIncluded,
            active: plan.active,
            sortOrder: plan.sortOrder,
            sold: soldBy.get(plan.id) ?? 0,
          }))}
        />
      </div>
    </StaffShell>
  )
}
