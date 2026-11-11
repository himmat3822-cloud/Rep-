import Link from 'next/link'
import { ArrowRight, BellRing, Flame, MessageCircle, QrCode, ReceiptIndianRupee, Smartphone, Users, CalendarClock } from 'lucide-react'
import './landing.css'
import { Brand } from '@/components/brand'
import { Pricing, type PricingPlan } from '@/components/landing/pricing'
import { LiveFloor } from '@/components/landing/live-floor'
import { DayTimeline } from '@/components/landing/day-timeline'
import { prisma } from '@/lib/db/client'
import { FEATURES, isComingSoon } from '@/lib/features'
import { kasratPaymentDetails, whatsappLink } from '@/lib/platform/payment-details'

export const revalidate = 300

const FEATURE_LABEL = new Map<string, string>(FEATURES.map((feature) => [feature.key, feature.label]))

function highlights(features: string[], previous: string[] | null, memberLimit: number | null, branchLimit: number, whatsappQuota: number, previousName: string | null): string[] {
  const items = [`${memberLimit === null ? 'Unlimited' : `Up to ${memberLimit}`} members`, `${branchLimit} branch${branchLimit > 1 ? 'es' : ''}`, `${whatsappQuota.toLocaleString('en-IN')} WhatsApp messages / month`]
  if (previousName) items.push(`Everything in ${previousName}, plus:`)
  const fresh = features.filter((key) => !previous?.includes(key) && !isComingSoon(key))
  return [...items, ...fresh.slice(0, previous ? 8 : 9).map((key) => FEATURE_LABEL.get(key) ?? key)]
}

const PLATE = [
  { icon: QrCode, title: 'Attendance without a register', text: 'Desk scanner, gym QR at the door, location check-in, your biometric lock, or manual entry. You choose what your gym has.' },
  { icon: BellRing, title: 'Dues that chase themselves', text: 'Reminders on WhatsApp before and after the due date, in the member\'s language, with a UPI pay link.' },
  { icon: ReceiptIndianRupee, title: 'GST invoices in one tap', text: 'Numbering restarts every April. Cash, UPI, card or bank, all in one daily total.' },
  { icon: Flame, title: 'Know who is about to quit', text: 'Every Monday: who is slipping, the reason, and a call button. Most members come back after one call.' },
  { icon: CalendarClock, title: 'Slots and a live crowd meter', text: 'Members book a slot and avoid the rush. You learn your real peak hours.' },
  { icon: Smartphone, title: 'An app members keep open', text: 'Streaks, challenges, workout plans from their trainer and a daily motivation line. Installs from the browser, works on cheap phones.' },
]

export default async function LandingPage() {
  const plans = await prisma.platformPlan.findMany({ where: { archived: false }, orderBy: { sortOrder: 'asc' } }).catch(() => [])
  const pricing: PricingPlan[] = plans.map((plan, index) => ({
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    monthlyPaise: plan.monthlyPricePaise,
    annualPaise: plan.annualPricePaise,
    isPopular: plan.isPopular,
    // Announced, not sold: shown on every plan above the first.
    comingSoon: index > 0 ? FEATURES.filter((feature) => isComingSoon(feature.key)).map((feature) => feature.label) : [],
    highlights: highlights(plan.features, index > 0 ? plans[index - 1].features : null, plan.memberLimit, plan.branchLimit, plan.whatsappQuota, index > 0 ? plans[index - 1].name : null),
  }))
  const support = kasratPaymentDetails().supportWhatsApp
  const demo = support ? whatsappLink(support, 'Hi Rep+! I run a gym and would like a demo.') : '/signup'

  return (
    <main className="lp">
      <section className="lp-hero">
        <div className="lp-floor" aria-hidden="true" />
        <div className="lp-glow" aria-hidden="true" />
        <div className="lp-wrap">
          <header className="lp-nav">
            <Brand />
            <nav>
              <a href="#pricing">Pricing</a>
              <Link href="/login">Log in</Link>
              <Link className="lp-btn lp-btn-lime lp-btn-sm" href="/signup">
                Free trial
              </Link>
            </nav>
          </header>

          <div className="lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-where">For gyms in Mohali, Chandigarh, Zirakpur and Panchkula</p>
              <h1 className="lp-title">
                <span className="lp-line">
                  <span>Run your gym.</span>
                </span>
                <span className="lp-line lp-line-lime">
                  <span>Fill it too.</span>
                </span>
              </h1>
              <p className="lp-lede">Attendance, dues on WhatsApp, GST invoices and an app your members actually open. Set up in 10 minutes, free for 14 days.</p>
              <div className="lp-cta">
                <Link className="lp-btn lp-btn-lime" href="/signup">
                  Start free trial <ArrowRight />
                </Link>
                <a className="lp-btn lp-btn-ghost" href={demo} target="_blank" rel="noreferrer">
                  <MessageCircle /> Book a demo on WhatsApp
                </a>
              </div>
            </div>
            <div className="lp-hero-live">
              <LiveFloor />
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section lp-wrap">
        <div className="lp-head">
          <h2>A day at your gym, handled</h2>
          <p>Rep+ works through the day so the desk doesn&apos;t have to.</p>
        </div>
        <DayTimeline />
      </section>

      <section className="lp-section lp-wrap">
        <div className="lp-head">
          <h2>What comes off your plate</h2>
          <p>Everything a busy owner needs, nothing they won&apos;t use.</p>
        </div>
        <ul className="lp-plate">
          {PLATE.map((item) => (
            <li key={item.title}>
              <item.icon aria-hidden="true" />
              <div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section lp-wrap" id="pricing">
        <div className="lp-head">
          <h2>Simple monthly plans</h2>
          <p>Prices exclude 18% GST. Switch plans any time.</p>
        </div>
        {pricing.length ? <Pricing plans={pricing} /> : <p className="muted" style={{ textAlign: 'center' }}>Plans are being set up.</p>}
      </section>

      <section className="lp-final">
        <div className="lp-floor lp-floor-slow" aria-hidden="true" />
        <div className="lp-wrap">
          <h2>Own a gym? Try it this week.</h2>
          <p>Run the reception yourself? The desk tools sit in your own menu, so you need only one login.</p>
          <div className="lp-cta">
            <Link className="lp-btn lp-btn-lime" href="/signup">
              <Users /> Start free trial
            </Link>
            <a className="lp-btn lp-btn-ghost" href={demo} target="_blank" rel="noreferrer">
              <MessageCircle /> Talk to us
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-foot lp-wrap">
        <span>Rep+, made in Mohali for Indian gyms.</span>
        <span>
          <Link href="/login">Staff login</Link>
          <Link href="/g/forge-fitness/login">Demo member app</Link>
        </span>
      </footer>
    </main>
  )
}
