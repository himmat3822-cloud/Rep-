'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Clock } from 'lucide-react'
import { formatInr } from '@/lib/money'

export interface PricingPlan {
  id: string
  code: string
  name: string
  description: string
  monthlyPaise: number
  annualPaise: number
  isPopular: boolean
  highlights: string[]
  comingSoon: string[]
}

export function Pricing({ plans }: { plans: PricingPlan[] }) {
  const [annual, setAnnual] = useState(false)
  return (
    <>
      <div className="cycle-toggle">
        <div className="lang-toggle">
          <button type="button" className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>
            Monthly
          </button>
          <button type="button" className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>
            Annual - 2 months free
          </button>
        </div>
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <div key={plan.id} className={`price-card ${plan.isPopular ? 'popular' : ''}`}>
            <h3>
              {plan.name}
              {plan.isPopular ? <span className="price-tag">Most popular</span> : null}
            </h3>
            <p className="muted" style={{ marginTop: 6 }}>
              {plan.description}
            </p>
            <div className="amount">
              {formatInr(annual ? plan.annualPaise : plan.monthlyPaise)}
              <small> / {annual ? 'year' : 'month'} + GST</small>
            </div>
            <ul>
              {plan.highlights.map((item) => (
                <li key={item}>
                  <Check />
                  {item}
                </li>
              ))}
              {plan.comingSoon.map((item) => (
                <li key={item} className="soon">
                  <Clock />
                  {item}
                  <span className="soon-tag">Coming soon</span>
                </li>
              ))}
            </ul>
            <Link className={`btn ${plan.isPopular ? 'btn-lime' : 'btn-dark'}`} href={`/signup?plan=${plan.code}&cycle=${annual ? 'ANNUAL' : 'MONTHLY'}`}>
              Start 14-day free trial
            </Link>
          </div>
        ))}
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 14 }}>
        No card needed for the trial. Pay by UPI or bank transfer when you are ready.
      </p>
    </>
  )
}
