import { z } from 'zod'
import type { TenantDb } from '@/lib/db/tenant-core'
import { addDays, istDateOnly } from '@/lib/time'

// Member groups for bulk messages and automatic rules. Pure description in,
// list of members out. Archived members are never included.

export const SEGMENTS = ['all', 'new', 'inactive', 'ending', 'expired', 'dues', 'regular'] as const
export type Segment = (typeof SEGMENTS)[number]

// Segments that take a number of days, with their default and limits.
export const SEGMENT_DAYS: Partial<Record<Segment, { default: number; min: number; max: number }>> = {
  new: { default: 14, min: 1, max: 90 },
  inactive: { default: 7, min: 2, max: 90 },
  ending: { default: 7, min: 1, max: 30 },
  expired: { default: 30, min: 1, max: 365 },
}

export const audienceSchema = z.object({
  segment: z.enum(SEGMENTS),
  days: z.coerce.number().int().min(1).max(365).optional(),
  branchId: z.string().max(40).nullable().optional(),
  trainerId: z.string().max(40).nullable().optional(),
})
export type Audience = z.output<typeof audienceSchema>

export function segmentDays(audience: Audience): number {
  const rule = SEGMENT_DAYS[audience.segment]
  if (!rule) return 0
  return Math.min(rule.max, Math.max(rule.min, audience.days ?? rule.default))
}

// Plain-English label: "Not coming for 7+ days, Zirakpur branch".
export function describeAudience(audience: Audience, names: { branch?: string | null; trainer?: string | null } = {}): string {
  const days = segmentDays(audience)
  const base: Record<Segment, string> = {
    all: 'All current members',
    new: `New members (joined in the last ${days} days)`,
    inactive: `Not coming for ${days}+ days`,
    ending: `Plan ending in the next ${days} days`,
    expired: `Plan ended in the last ${days} days`,
    dues: 'Members with pending dues',
    regular: 'Regular members',
  }
  return [base[audience.segment], names.branch ? `${names.branch} branch` : null, names.trainer ? `trained by ${names.trainer}` : null].filter(Boolean).join(', ')
}

export interface AudienceMember {
  id: string
  name: string
  phone: string
  language: 'EN' | 'HI' | 'PA'
  whatsappOptOut: boolean
  // Days since the last visit (or since joining when never visited): used by
  // the "we miss you" line. Days left on the plan for "ending".
  idleDays: number
  daysLeft: number | null
}

const DAY = 86400000

export async function resolveAudience(db: TenantDb, audience: Audience, now: Date = new Date()): Promise<AudienceMember[]> {
  const today = istDateOnly(now)
  const days = segmentDays(audience)
  const scope = {
    archived: false,
    ...(audience.branchId ? { homeBranchId: audience.branchId } : {}),
    ...(audience.trainerId ? { trainerId: audience.trainerId } : {}),
  }

  // Members with a plan running today (and when it ends).
  const active = await db.membership.findMany({ where: { status: 'ACTIVE', endsAt: { gte: today } }, select: { athleteId: true, endsAt: true } })
  const endsAt = new Map<string, Date>()
  for (const row of active) {
    const known = endsAt.get(row.athleteId)
    if (!known || row.endsAt > known) endsAt.set(row.athleteId, row.endsAt)
  }
  const current = [...endsAt.keys()]

  let ids: string[] | null = null
  let extraWhere: Record<string, unknown> = {}
  switch (audience.segment) {
    case 'all':
      ids = current
      break
    case 'new':
      extraWhere = { joinedAt: { gte: addDays(today, -days) } }
      break
    case 'inactive':
      ids = current
      extraWhere = { OR: [{ lastVisitAt: null, joinedAt: { lt: addDays(today, -days) } }, { lastVisitAt: { lt: addDays(today, -days + 1) } }] }
      break
    case 'ending':
      ids = current.filter((id) => endsAt.get(id)! <= addDays(today, days))
      break
    case 'expired': {
      const ended = await db.membership.findMany({ where: { endsAt: { gte: addDays(today, -days), lt: today } }, select: { athleteId: true } })
      const running = new Set(current)
      ids = [...new Set(ended.map((row) => row.athleteId))].filter((id) => !running.has(id))
      break
    }
    case 'dues': {
      const open = await db.due.findMany({ where: { status: 'OPEN' }, select: { athleteId: true } })
      ids = [...new Set(open.map((row) => row.athleteId))]
      break
    }
    case 'regular':
      extraWhere = { status: 'REGULAR' }
      break
  }
  if (ids && ids.length === 0) return []

  const athletes = await db.athlete.findMany({
    where: { ...scope, ...extraWhere, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, name: true, phone: true, language: true, whatsappOptOut: true, lastVisitAt: true, joinedAt: true },
    orderBy: { name: 'asc' },
  })
  return athletes.map((athlete) => {
    const since = istDateOnly(athlete.lastVisitAt ?? athlete.joinedAt)
    const end = endsAt.get(athlete.id)
    return {
      id: athlete.id,
      name: athlete.name,
      phone: athlete.phone,
      language: athlete.language as AudienceMember['language'],
      whatsappOptOut: athlete.whatsappOptOut,
      idleDays: Math.max(1, Math.round((today.getTime() - since.getTime()) / DAY)),
      daysLeft: end ? Math.max(0, Math.round((end.getTime() - today.getTime()) / DAY)) : null,
    }
  })
}
