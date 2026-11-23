import { after } from 'next/server'
import { gymRoute, ok } from '@/lib/api/guard'
import { prisma } from '@/lib/db/client'
import { claimJob } from '@/lib/messaging/jobs'
import { flushOutbox } from '@/lib/messaging/outbox'
import { isQuietHour } from '@/lib/messaging/policy'

// GET  /api/gym/notifications - the caller's own bell (last 15 + unread count)
// POST /api/gym/notifications - mark all of the caller's notifications read
// Staff see only notifications addressed to them, so no extra permission.
//
// The bell is polled while any staff screen is open, so it also sends the
// gym's waiting messages (nudges queued overnight, bulk sends) soon after
// 8 AM, at most once every 5 minutes per gym, after the response is sent.
export const GET = gymRoute({}, async ({ db, gym, staff }) => {
  after(async () => {
    const now = new Date()
    if (isQuietHour(now)) return
    const due = await db.outboundMessage.count({ where: { status: 'PENDING', sendAfter: { lte: now } } })
    if (due === 0) return
    if (!(await claimJob(prisma, `outbox:${gym.id}:${Math.floor(now.getTime() / 300000)}`))) return
    await flushOutbox(prisma, gym.id, now, { limit: 500 })
  })
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
