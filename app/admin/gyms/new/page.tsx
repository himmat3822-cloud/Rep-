import type { Metadata } from 'next'
import { AdminFrame } from '@/components/admin/admin-frame'
import { CreateGymForm } from '@/components/admin/create-gym-form'
import { prisma } from '@/lib/db/client'
import { formatInr } from '@/lib/money'

export const metadata: Metadata = { title: 'New gym - Rep+ Admin' }

export default async function NewGymPage() {
  const plans = await prisma.platformPlan.findMany({ where: { archived: false }, orderBy: { sortOrder: 'asc' } })
  return (
    <AdminFrame title="New gym" kicker="Gyms">
      <div style={{ maxWidth: 820 }}>
        <p className="muted" style={{ marginBottom: 14 }}>
          Creates the gym, its main branch, Owner / Front desk / Trainer roles, four starter membership plans, default reminder stages and a free trial. The owner can log in right away with WhatsApp OTP.
        </p>
        <CreateGymForm plans={plans.map((plan) => ({ id: plan.id, name: plan.name, monthly: formatInr(plan.monthlyPricePaise) }))} />
      </div>
    </AdminFrame>
  )
}
