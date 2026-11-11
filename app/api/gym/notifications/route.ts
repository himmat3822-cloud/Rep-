import { gymRoute, ok } from '@/lib/api/guard'

// GET  /api/gym/notifications - the caller's own bell (last 15 + unread count)
// POST /api/gym/notifications - mark all of the caller's notifications read
// Staff see only notifications addressed to them, so no extra permission.
export const GET = gymRoute({}, async ({ db, staff }) => {
  const where = { recipientType: 'STAFF' as const, recipientId: staff!.sub }
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, title: true, body: true, href: true, readAt: true, createdAt: true } }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ])
  return ok({ items, unread })
})

export const POST = gymRoute({ write: false }, async ({ db, staff }) => {
  const result = await db.notification.updateMany({ where: { recipientType: 'STAFF', recipientId: staff!.sub, readAt: null }, data: { readAt: new Date() } })
  return ok({ marked: result.count })
})
