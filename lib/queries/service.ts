import 'server-only'
import type { TenantDb } from '@/lib/db/tenant-core'
import { errors } from '@/lib/api/errors'
import { notifyAthlete } from '@/lib/athlete/notify'
import type { QueryTopic } from '@/lib/api/types'

// Member queries: a short chat between a member and their trainer about a
// diet plan, a workout split, a plan change or PT. Complaints stay separate.
//
// Routing: the member's trainer gets it; members without a trainer go to
// the owner. The owner sees every query and can answer any of them.

export const TOPIC_LABEL: Record<QueryTopic, string> = {
  DIET: 'Diet plan',
  WORKOUT: 'Workout split',
  PLAN: 'Membership plan',
  PT: 'Personal training',
  OTHER: 'Other',
}

export interface QueryThread {
  id: string
  topic: QueryTopic
  status: 'OPEN' | 'ANSWERED' | 'CLOSED'
  athlete: { id: string; name: string; phone: string }
  trainer: { id: string; name: string } | null
  createdAt: Date
  lastMessageAt: Date
  unreadForMember: boolean
  messages: { id: string; author: 'ATHLETE' | 'STAFF'; staffName: string | null; body: string; createdAt: Date }[]
}

export async function createQuery(db: TenantDb, gym: { id: string; slug: string }, me: { id: string; name: string; homeBranchId: string }, input: { topic: QueryTopic; body: string }) {
  const athlete = await db.athlete.findFirst({ where: { id: me.id }, select: { trainerId: true } })
  const openCount = await db.memberQuery.count({ where: { athleteId: me.id, status: 'OPEN' } })
  if (openCount >= 5) throw errors.conflict('You already have 5 open queries. Wait for a reply first.')
  const now = new Date()
  const query = await db.memberQuery.create({
    data: { gymId: gym.id, branchId: me.homeBranchId, athleteId: me.id, trainerId: athlete?.trainerId ?? null, topic: input.topic, status: 'OPEN', lastMessageAt: now, athleteSeenAt: now },
  })
  await db.queryMessage.create({ data: { gymId: gym.id, queryId: query.id, author: 'ATHLETE', body: input.body } })
  await notifyHandlers(db, gym.id, query.trainerId, { title: `${TOPIC_LABEL[input.topic]} query from ${me.name}`, body: input.body.slice(0, 200) })
  return query
}

export async function addMemberMessage(db: TenantDb, gym: { id: string }, me: { id: string; name: string }, queryId: string, body: string) {
  const query = await db.memberQuery.findFirst({ where: { id: queryId, athleteId: me.id } })
  if (!query) throw errors.notFound('Query')
  const now = new Date()
  await db.queryMessage.create({ data: { gymId: gym.id, queryId, author: 'ATHLETE', body } })
  await db.memberQuery.updateMany({ where: { id: queryId }, data: { status: 'OPEN', lastMessageAt: now, athleteSeenAt: now } })
  await notifyHandlers(db, gym.id, query.trainerId, { title: `${me.name} replied (${TOPIC_LABEL[query.topic]})`, body: body.slice(0, 200) })
}

// Staff answer. Trainers may answer only their own members' queries.
export async function replyToQuery(
  db: TenantDb,
  gym: { id: string; slug: string },
  staff: { id: string; name: string; kind: 'OWNER' | 'DESK' | 'TRAINER' },
  queryId: string,
  input: { body: string; close: boolean },
) {
  const query = await db.memberQuery.findFirst({ where: { id: queryId } })
  if (!query) throw errors.notFound('Query')
  if (staff.kind !== 'OWNER' && query.trainerId !== staff.id) throw errors.forbidden('This query belongs to another trainer')
  if (!input.body && !input.close) throw errors.validation('Write a reply')
  const now = new Date()
  if (input.body) await db.queryMessage.create({ data: { gymId: gym.id, queryId, author: 'STAFF', staffId: staff.id, body: input.body } })
  const status = input.close ? 'CLOSED' : 'ANSWERED'
  await db.memberQuery.updateMany({ where: { id: queryId }, data: { status, lastMessageAt: input.body ? now : query.lastMessageAt } })
  if (input.body) {
    await notifyAthlete(db, gym, query.athleteId, { title: `${staff.name.split(' ')[0]} replied to your query`, body: input.body.slice(0, 180), path: '/queries', tag: `query-${queryId}` })
  }
  return { id: queryId, status }
}

async function notifyHandlers(db: TenantDb, gymId: string, trainerId: string | null, message: { title: string; body: string }) {
  const owners = await db.gymUser.findMany({ where: { kind: 'OWNER', active: true }, select: { id: true } })
  const ids = new Set(owners.map((owner) => owner.id))
  if (trainerId) ids.add(trainerId)
  if (ids.size === 0) return
  await db.notification.createMany({
    data: [...ids].map((id) => ({ gymId, recipientType: 'STAFF' as const, recipientId: id, title: message.title, body: message.body, href: id === trainerId ? '/trainer/queries' : '/owner/queries' })),
  })
}

async function hydrate(db: TenantDb, rows: { id: string; topic: QueryTopic; status: 'OPEN' | 'ANSWERED' | 'CLOSED'; athleteId: string; trainerId: string | null; createdAt: Date; lastMessageAt: Date; athleteSeenAt: Date | null }[]): Promise<QueryThread[]> {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const [messages, athletes] = await Promise.all([
    db.queryMessage.findMany({ where: { queryId: { in: ids } }, orderBy: { createdAt: 'asc' } }),
    db.athlete.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.athleteId))] } }, select: { id: true, name: true, phone: true } }),
  ])
  const staffIds = [...new Set([...rows.map((row) => row.trainerId), ...messages.map((m) => m.staffId)].filter((id): id is string => Boolean(id)))]
  const staff = staffIds.length ? await db.gymUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }) : []
  const staffName = new Map(staff.map((person) => [person.id, person.name]))
  const athleteById = new Map(athletes.map((athlete) => [athlete.id, athlete]))
  return rows.map((row) => {
    const own = messages.filter((m) => m.queryId === row.id)
    const lastStaff = [...own].reverse().find((m) => m.author === 'STAFF')
    return {
      id: row.id,
      topic: row.topic,
      status: row.status,
      athlete: athleteById.get(row.athleteId) ?? { id: row.athleteId, name: 'Member', phone: '' },
      trainer: row.trainerId ? { id: row.trainerId, name: staffName.get(row.trainerId) ?? 'Trainer' } : null,
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt,
      unreadForMember: Boolean(lastStaff && (!row.athleteSeenAt || lastStaff.createdAt > row.athleteSeenAt)),
      messages: own.map((m) => ({ id: m.id, author: m.author, staffName: m.staffId ? (staffName.get(m.staffId) ?? 'Staff') : null, body: m.body, createdAt: m.createdAt })),
    }
  })
}

export async function memberQueries(db: TenantDb, athleteId: string): Promise<QueryThread[]> {
  const rows = await db.memberQuery.findMany({ where: { athleteId }, orderBy: { lastMessageAt: 'desc' }, take: 30 })
  return hydrate(db, rows)
}

// Opening the queries screen marks replies as seen.
export async function markMemberSeen(db: TenantDb, athleteId: string) {
  await db.memberQuery.updateMany({ where: { athleteId }, data: { athleteSeenAt: new Date() } })
}

export type QueryFilter = 'open' | 'answered' | 'closed' | 'all'

export async function staffQueries(db: TenantDb, viewer: { id: string; kind: 'OWNER' | 'DESK' | 'TRAINER' }, filter: QueryFilter, branchId?: string | null): Promise<QueryThread[]> {
  const status = filter === 'open' ? 'OPEN' : filter === 'answered' ? 'ANSWERED' : filter === 'closed' ? 'CLOSED' : undefined
  const rows = await db.memberQuery.findMany({
    where: { ...(status ? { status } : {}), ...(viewer.kind === 'OWNER' ? {} : { trainerId: viewer.id }), ...(branchId ? { branchId } : {}) },
    orderBy: [{ lastMessageAt: 'desc' }],
    take: 100,
  })
  return hydrate(db, rows)
}

export async function openQueryCount(db: TenantDb, viewer: { id: string; kind: 'OWNER' | 'DESK' | 'TRAINER' }): Promise<number> {
  return db.memberQuery.count({ where: { status: 'OPEN', ...(viewer.kind === 'OWNER' ? {} : { trainerId: viewer.id }) } })
}
