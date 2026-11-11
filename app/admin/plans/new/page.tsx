import type { Metadata } from 'next'
import { AdminFrame } from '@/components/admin/admin-frame'
import { PlanForm } from '@/components/admin/plan-form'

export const metadata: Metadata = { title: 'New plan - Rep+ Admin' }

export default function NewPlanPage() {
  return (
    <AdminFrame title="New plan" kicker="Plans and features">
      <div style={{ maxWidth: 980 }}>
        <PlanForm
          defaults={{ code: '', name: '', description: '', monthlyPriceRupees: 999, annualPriceRupees: 9990, memberLimit: 250, branchLimit: 1, extraBranchRupees: '', staffLimit: 3, trainerLimit: 2, deskLimit: 1, whatsappQuota: 1000, features: [], isPopular: false, sortOrder: 10 }}
        />
      </div>
    </AdminFrame>
  )
}
