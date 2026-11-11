import type { Metadata } from 'next'
import { AdminFrame } from '@/components/admin/admin-frame'
import { AnnouncementForm } from '@/components/admin/announcement-form'
import { prisma } from '@/lib/db/client'
import { formatIstDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Announcements - Rep+ Admin' }

export default async function AdminAnnouncementsPage() {
  const rows = await prisma.platformAnnouncement.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })
  return (
    <AdminFrame title="Announcements">
      <div className="two-col">
        <AnnouncementForm />
        <section className="panel">
          <p className="kicker">HISTORY</p>
          <h2>Sent announcements</h2>
          <div className="list-rows">
            {rows.length === 0 ? <p className="muted" style={{ paddingTop: 10 }}>Nothing sent yet.</p> : null}
            {rows.map((row) => (
              <div className="list-row" key={row.id} style={{ alignItems: 'flex-start' }}>
                <span>
                  <strong>{row.title}</strong>
                  <br />
                  <small>{row.body.length > 140 ? `${row.body.slice(0, 140)}...` : row.body}</small>
                  <br />
                  <small>
                    {row.audience.toLowerCase()} - {row.recipients} owners - {row.emailsSent} emails - {row.whatsappSent} WhatsApp
                  </small>
                </span>
                <small style={{ whiteSpace: 'nowrap' }}>{formatIstDate(row.createdAt, { day: 'numeric', month: 'short' })}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminFrame>
  )
}
