import 'server-only'
import type { TenantDb } from '@/lib/db/tenant-core'
import { errors } from '@/lib/api/errors'
import { notifyAthlete } from '@/lib/athlete/notify'
import type { QueryTopic } from '@/lib/api/types'
import { coachList, trainingSettings } from '@/lib/trainer/coaches'

// Member queries: a short chat between a member and their trainer about a
// diet plan, a workout split, a plan change or PT. Complaints stay separate.
//
// Routing: the member picks a trainer (their own trainer is the default, or
// "any trainer"). The owner decides in Settings > App whether only that
// trainer sees it ("chosen") or every trainer does ("all"), always showing
// who it was sent to. The owner sees every query and can answer any.

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

export async function createQuery(db: TenantDb, gym: { id: string; slug: string }, me: { id: string; name: string; homeBranchId: string }, input: { topic: QueryTopic; body: string; trainerId?: string | null }) {
  const [athlete, openCount, settings] = await Promise.all([
    db.athlete.findFirst({ where: { id: me.id }, select: { trainerId: true } }),
    db.memberQuery.count({ where: { athleteId: me.id, status: 'OPEN' } }),
    trainingSettings(db),
  ])
  if (openCount >= 5) throw errors.conflict('You already have 5 open queries. Wait for a reply first.')
  const coaches = await coachList(db, settings.ownerTrains)
  // undefined = not chosen (older app): the member's own trainer.
  // null = "any trainer". A picked id must be one of the gym's trainers.
  let trainerId: string | null
  if (input.trainerId === undefined) trainerId = coaches.some((coach) => coach.id === athlete?.trainerId) ? (athlete?.trainerId ?? null) : null
  else if (input.trainerId === null) trainerId = null
  else if (coaches.some((coach) => coach.id === input.trainerId)) trainerId = input.trainerId
  else throw errors.validation('Pick a trainer from the list')
  const now = new Date()
  const query = await db.memberQuery.create({
    data: { gymId: gym.id, branchId: me.homeBranchId, athleteId: me.id, trainerId, topic: input.topic, status: 'OPEN', lastMessageAt: now, athleteSeenAt: now },
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

// Staff answer. A trainer may answer queries sent to them or to any
// trainer; with "all trainers see queries" they may answer any of them.
export async function replyToQuery(
  db: TenantDb,
  gym: { id: string; slug: string },
  staff: { id: string; name: string; kind: 'OWNER' | 'DESK' | 'TRAINER' },
  queryId: string,
  input: { body: string; close: boolean },
) {
  const query = await db.memberQuery.findFirst({ where: { id: queryId } })
  if (!query) throw errors.notFound('Query')
  if (staff.kind !== 'OWNER' && query.trainerId !== null && query.trainerId !== staff.id && !(await seesAll(db))) throw errors.forbidden('This query belongs to another trainer')
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

// Owners always; then the chosen trainer, or every trainer when the owner
// set "all trainers see queries" (or nobody was picked).
async function notifyHandlers(db: TenantDb, gymId: string, trainerId: string | null, message: { title: string; body: string }) {
  const settings = await trainingSettings(db)
  const [owners, coaches] = await Promise.all([db.gymUser.findMany({ where: { kind: 'OWNER', active: true }, select: { id: true } }), coachList(db, settings.ownerTrains)])
  const toTrainer = new Set<string>()
  if (settings.queryRouting === 'all' || !trainerId) for (const coach of coaches) toTrainer.add(coach.id)
  if (trainerId) toTrainer.add(trainerId)
  const ownerIds = new Set(owners.map((owner) => owner.id))
  const ids = new Set([...ownerIds, ...toTrainer])
  if (ids.size === 0) return
  await db.notification.createMany({
    // An owner who trains gets the trainer link only when it was sent to them.
    data: [...ids].map((id) => ({ gymId, recipientType: 'STAFF' as const, recipientId: id, title: message.title, body: message.body, href: ownerIds.has(id) && id !== trainerId ? '/owner/queries' : '/trainer/queries' })),
  })
}

// "all": every trainer sees every query.
async function seesAll(db: TenantDb): Promise<boolean> {
  return (await trainingSettings(db)).queryRouting === 'all'
}

// Which queries a staff member's board shows.
async function boardWhere(db: TenantDb, viewer: { id: string; kind: 'OWNER' | 'DESK' | 'TRAINER' }) {
  if (viewer.kind === 'OWNER') return {}
  if (await seesAll(db)) return {}
  // Queries sent to "any trainer" reach everyone.
  return { OR: [{ trainerId: viewer.id }, { trainerId: null }] }
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
    where: { AND: [status ? { status } : {}, await boardWhere(db, viewer), branchId ? { branchId } : {}] },
    orderBy: [{ lastMessageAt: 'desc' }],
    take: 100,
  })
  return hydrate(db, rows)
}

export async function openQueryCount(db: TenantDb, viewer: { id: string; kind: 'OWNER' | 'DESK' | 'TRAINER' }): Promise<number> {
  return db.memberQuery.count({ where: { AND: [{ status: 'OPEN' }, await boardWhere(db, viewer)] } })
}
