import type { Metadata } from 'next'
import { AuthHero } from '@/components/auth/auth-hero'
import { SignupWizard } from '@/components/landing/signup-wizard'
import { prisma } from '@/lib/db/client'

export const metadata: Metadata = { title: 'Start your free trial - Rep+' }

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string; cycle?: string }> }) {
  const { plan, cycle } = await searchParams
  const plans = await prisma.platformPlan.findMany({ where: { archived: false }, orderBy: { sortOrder: 'asc' } })
  return (
    <main className="auth-shell">
      <AuthHero title="Your gym on Rep+" accent="in 4 short steps." text="Verify your WhatsApp, tell us about your gym, choose how you run the desk, pick a plan. 14 days free, no card needed." points={['14-DAY TRIAL', 'NO CARD', 'EN / HI / PA']} />
      <section className="auth-main">
        <SignupWizard
          initialPlan={plan}
          initialCycle={cycle === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY'}
          plans={plans.map((item) => ({ id: item.id, code: item.code, name: item.name, monthlyPaise: item.monthlyPricePaise, annualPaise: item.annualPricePaise, memberLimit: item.memberLimit, branchLimit: item.branchLimit, isPopular: item.isPopular }))}
        />
      </section>
    </main>
  )
}
