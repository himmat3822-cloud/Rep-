import type { Metadata } from 'next'
import { ShieldCheck } from 'lucide-react'
import { AuthHero } from '@/components/auth/auth-hero'
import { AdminLoginForm } from '@/components/auth/admin-login-form'

export const metadata: Metadata = { title: 'Admin login - Rep+', robots: { index: false, follow: false } }

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <main className="auth-shell admin-auth">
      <AuthHero
        title="Rep+ control."
        accent="Platform admin only."
        text="Admin ID, password and a code from your authenticator app. There is no signup here, and gym logins do not work on this page."
        points={['TOTP 2FA', 'AUDIT LOGGED', 'SEPARATE SESSION']}
        badge={
          <span className="admin-badge">
            <ShieldCheck size={13} /> ADMIN
          </span>
        }
      />
      <section className="auth-main">
        <div className="auth-card">
          <span className="kicker">SUPER ADMIN</span>
          <h2>Secure sign in</h2>
          <p className="muted">Every login and action is written to the audit log.</p>
          <AdminLoginForm next={next} />
        </div>
      </section>
    </main>
  )
}
