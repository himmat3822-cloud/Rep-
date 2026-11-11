import { ok } from '@/lib/api/guard'
import { athleteRoute } from '@/lib/api/athlete'

// GET  /api/g/{slug}/me/notifications - latest 40 + unread count
// POST /api/g/{slug}/me/notifications - mark all as read
export const GET = athleteRoute({}, async ({ db, me }) => {
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { recipientType: 'ATHLETE', recipientId: me.id }, orderBy: { createdAt: 'desc' }, take: 40 }),
    db.notification.count({ where: { recipientType: 'ATHLETE', recipientId: me.id, readAt: null } }),
  ])
  return ok({ unread, items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, read: Boolean(n.readAt), createdAt: n.createdAt })) }, { headers: { 'Cache-Control': 'private, no-store' } })
})

export const POST = athleteRoute({}, async ({ db, me }) => {
  await db.notification.updateMany({ where: { recipientType: 'ATHLETE', recipientId: me.id, readAt: null }, data: { readAt: new Date() } })
  return ok({ ok: true })
})
