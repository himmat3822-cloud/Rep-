import type { Metadata } from 'next'
import { CalendarDays, Receipt, Zap } from 'lucide-react'
import { AppShell } from '@/components/shell/app-shell'
import { ClaimsQueue, FreezeQueue, pendingCounts } from '@/components/owner/request-queues'
import { requireStaffPage } from '@/lib/auth/page'
import { deskNav, subscriptionBanner } from '@/lib/nav'
import { tenantDb } from '@/lib/db/tenant'
import { istStartOfDay } from '@/lib/time'

export const metadata: Metadata = { title: 'Front desk - Rep+' }

export default async function DeskHomePage() {
  const { user, gym } = await requireStaffPage(['DESK', 'OWNER'])
  const db = tenantDb(gym.id)
  const [today, inside, openDues] = await Promise.all([
    db.checkIn.count({ where: { checkedInAt: { gte: istStartOfDay() } } }),
    db.checkIn.count({ where: { checkedOutAt: null, checkedInAt: { gte: new Date(Date.now() - gym.sessionMinutes * 60000) } } }),
    db.due.count({ where: { status: 'OPEN' } }),
  ])
  const pending = await pendingCounts(db)

  return (
    <AppShell
      workspace="FRONT DESK"
      kicker={`${gym.name} - ${user.branch?.name ?? gym.city}`}
      title="Today"
      sections={deskNav(gym.athleteLabelPlural)}
      profile={{ name: user.name, subtitle: 'Front desk' }}
      logout="staff"
      banner={subscriptionBanner(gym.subscriptionStatus)}
    >
      <div className="metric-row" style={{ marginBottom: 18 }}>
        <div className="metric-card"><div className="metric-icon blue"><Zap /></div><div className="metric-copy"><span>Check-ins today</span><strong>{today}</strong><small>Live from the floor</small></div></div>
        <div className="metric-card"><div className="metric-icon"><CalendarDays /></div><div className="metric-copy"><span>Inside right now</span><strong>{inside}</strong><small>Auto checkout after {gym.sessionMinutes} min</small></div></div>
        <div className="metric-card"><div className="metric-icon orange"><Receipt /></div><div className="metric-copy"><span>Open dues</span><strong>{openDues}</strong><small>Collect at the counter</small></div></div>
      </div>
      <section className="panel" style={{ marginBottom: 18 }}>
        <p className="kicker">MEMBERS SAY THEY PAID BY UPI ({pending.claims})</p>
        <h2>Check your bank app, then confirm</h2>
        <p className="muted">Confirming records the payment and sends the GST invoice to the member, same as collecting at the counter.</p>
      </section>
      <ClaimsQueue db={db} />
      <section className="panel" style={{ margin: '18px 0' }}>
        <p className="kicker">FREEZE REQUESTS ({pending.freezes})</p>
        <h2>Members asking to pause their plan</h2>
      </section>
      <FreezeQueue db={db} />
    </AppShell>
  )
}
