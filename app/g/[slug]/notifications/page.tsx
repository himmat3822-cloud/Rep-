import type { Metadata } from 'next'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { AthleteChrome } from '@/components/athlete/athlete-chrome'
import { MarkAllRead } from '@/components/athlete/profile'
import { requireAthletePage } from '@/lib/auth/page'
import { tenantDb } from '@/lib/db/tenant'
import { translator } from '@/lib/i18n'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Notifications - Rep+' }

export default async function NotificationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { athlete, gym } = await requireAthletePage(slug)
  const t = translator(athlete.language)
  const items = await tenantDb(gym.id).notification.findMany({ where: { recipientType: 'ATHLETE', recipientId: athlete.id }, orderBy: { createdAt: 'desc' }, take: 60 })
  const unread = items.some((n) => !n.readAt)
  return (
    <AthleteChrome slug={slug} lang={athlete.language}>
      <div className="a-page">
        <div className="a-head row-between">
          <h1>{t('notif', 'title')}</h1>
          {unread ? <MarkAllRead slug={slug} label={t('notif', 'markRead')} /> : null}
        </div>
        {items.length === 0 ? (
          <section className="a-card">
            <p className="muted">
              <Bell className="inline-icon" /> {t('notif', 'empty')}
            </p>
          </section>
        ) : (
          <ul className="notif-list">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? '' : 'unread'}>
                <Link href={n.href ?? `/g/${slug}`}>
                  <strong>{n.title}</strong>
                  <span>{n.body}</span>
                  <small>{formatIstDate(n.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AthleteChrome>
  )
}
