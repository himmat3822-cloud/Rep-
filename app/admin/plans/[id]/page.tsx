import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AdminFrame } from '@/components/admin/admin-frame'
import { PlanForm } from '@/components/admin/plan-form'
import { prisma } from '@/lib/db/client'

export const metadata: Metadata = { title: 'Edit plan - Rep+ Admin' }

const nullable = (value: number | null) => (value === null ? '' : value)

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const plan = await prisma.platformPlan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true } } } })
  if (!plan) notFound()
  return (
    <AdminFrame title={`${plan.name} plan`} kicker="Plans and features">
      <div style={{ maxWidth: 980 }}>
        <p className="muted" style={{ marginBottom: 14 }}>
          {plan._count.subscriptions} gym(s) on this plan{plan.archived ? ' - archived, hidden from new signups' : ''}.
        </p>
        <PlanForm
          planId={plan.id}
          archived={plan.archived}
          subscribers={plan._count.subscriptions}
          defaults={{
            code: plan.code,
            name: plan.name,
            description: plan.description,
            monthlyPriceRupees: plan.monthlyPricePaise / 100,
            annualPriceRupees: plan.annualPricePaise / 100,
            memberLimit: nullable(plan.memberLimit),
            branchLimit: plan.branchLimit,
            extraBranchRupees: plan.extraBranchPaise === null ? '' : plan.extraBranchPaise / 100,
            staffLimit: nullable(plan.staffLimit),
            trainerLimit: nullable(plan.trainerLimit),
            deskLimit: nullable(plan.deskLimit),
            whatsappQuota: plan.whatsappQuota,
            features: plan.features,
            isPopular: plan.isPopular,
            sortOrder: plan.sortOrder,
          }}
        />
      </div>
    </AdminFrame>
  )
}
