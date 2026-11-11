import Link from 'next/link'
import { Lock } from 'lucide-react'

// Shown instead of a screen whose feature is not in the gym's Rep+ plan.
export function FeatureLocked({ title, plan, children }: { title: string; plan: 'Pro' | 'Elite'; children: React.ReactNode }) {
  return (
    <section className="panel empty-panel">
      <div className="round-icon"><Lock /></div>
      <h2>{title}</h2>
      <p>{children}</p>
      <p style={{ marginTop: 14 }}>
        Available on the Rep+ {plan} plan. <Link href="/owner/billing">See plans</Link>
      </p>
    </section>
  )
}
