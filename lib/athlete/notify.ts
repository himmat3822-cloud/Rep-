import type { TenantDb } from '@/lib/db/tenant-core'
import { isQuietHour } from '@/lib/messaging/policy'
import { pushToAthlete, type PushTransport } from './push'

// In-app notification for a member (bell in the app) plus a push to their
// phones. Push is best effort, never fails the caller, and stays silent
// between 9 PM and 8 AM (the in-app notification is still there).

export async function notifyAthlete(db: TenantDb, gym: { id: string; slug: string }, athleteId: string, message: { title: string; body: string; path?: string; tag?: string }, transport?: PushTransport): Promise<void> {
  const href = `/g/${gym.slug}${message.path ?? ''}`
  await db.notification.create({ data: { gymId: gym.id, recipientType: 'ATHLETE', recipientId: athleteId, title: message.title, body: message.body, href } })
  if (isQuietHour()) return
  try {
    await pushToAthlete(db, athleteId, { title: message.title, body: message.body, url: href, tag: message.tag }, transport)
  } catch (error) {
    console.error('[notify] push failed', athleteId, error)
  }
}

// In-app notification for the people who handle a request: owners, plus
// desk staff when the gym has a separate front desk.
export async function notifyStaff(db: TenantDb, gymId: string, message: { title: string; body: string; href: string }, kinds: ('OWNER' | 'DESK')[] = ['OWNER', 'DESK']): Promise<number> {
  const staff = await db.gymUser.findMany({ where: { kind: { in: kinds }, active: true }, select: { id: true } })
  if (staff.length === 0) return 0
  await db.notification.createMany({ data: staff.map((person) => ({ gymId, recipientType: 'STAFF' as const, recipientId: person.id, title: message.title, body: message.body, href: message.href })) })
  return staff.length
}
