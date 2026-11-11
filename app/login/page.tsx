import type { Metadata } from 'next'
import { AuthHero } from '@/components/auth/auth-hero'
import { StaffLoginForm } from '@/components/auth/staff-login-form'

export const metadata: Metadata = { title: 'Log in - Rep+' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams
  return (
    <main className="auth-shell">
      <AuthHero title="Run your gym." accent="Not your gym running you." text="Owners, trainers and front desk log in here. Use the WhatsApp code on your registered number, or your email and password." points={['WHATSAPP OTP', 'GST BILLING', 'LIVE FLOOR']} />
      <section className="auth-main">
        <div className="auth-card">
          <span className="kicker">GYM STAFF LOGIN</span>
          <h2>Welcome back</h2>
          <p className="muted">{error === 'disabled' ? 'That account is disabled. Ask the gym owner to re-enable it.' : error === 'suspended' ? "Your gym's Rep+ access is suspended. Please ask the owner to renew." : 'Log in to your Rep+ workspace.'}</p>
          <StaffLoginForm next={next} />
          <p className="auth-foot">
            New gym? <a href="/signup">Start a 14-day free trial</a> - no card needed.
            <br />
            Members log in from their gym link, for example /g/forge-fitness.
          </p>
        </div>
      </section>
    </main>
  )
}
