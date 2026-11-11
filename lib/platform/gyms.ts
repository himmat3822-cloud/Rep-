import type { Prisma, PrismaClient } from '@/lib/generated/prisma/client'
import { SYSTEM_ROLES } from '@/lib/auth/permissions'
import { hashPassword } from '@/lib/auth/password'
import { auditWith } from '@/lib/audit-core'
import { randomToken } from '@/lib/crypto'
import { ApiError } from '@/lib/api/errors'
import { countsTowardMrr, priceFor, TRIAL_DAYS, type Cycle } from './billing'

// Gym lifecycle on the platform side. createGymWithOwner is shared by the
// admin "Create gym" form and the owner signup wizard (Phase 3).

const DAY_MS = 24 * 3600 * 1000

export const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'www', 'login', 'signup', 'owner', 'desk', 'trainer', 'g', 'static', 'cdn', 'help', 'support', 'kasrat', 'repplus', 'rep'])

export interface CreateGymData {
  name: string
  slug: string
  city: string
  address?: string
  ownerName: string
  ownerPhone: string
  ownerEmail?: string
  ownerPassword?: string
  planId: string
  cycle?: Cycle
  trialDays?: number
  ownerHandlesDesk?: boolean
}

export const DEFAULT_MEMBERSHIP_PLANS = [
  { name: 'Monthly', durationDays: 30, pricePaise: 150000, joiningFeePaise: 50000, maxFreezeDays: 0, sortOrder: 1 },
  { name: 'Quarterly', durationDays: 90, pricePaise: 400000, joiningFeePaise: 50000, maxFreezeDays: 7, sortOrder: 2 },
  { name: 'Half yearly', durationDays: 180, pricePaise: 700000, joiningFeePaise: 0, maxFreezeDays: 15, sortOrder: 3 },
  { name: 'Annual', durationDays: 365, pricePaise: 1200000, joiningFeePaise: 0, maxFreezeDays: 30, sortOrder: 4 },
]

export const DEFAULT_REMINDER_STAGES = [
  { stage: 1, name: 'Soft reminder', offsetDays: -3, template: 'kasrat_due_soft', notifyOwner: false },
  { stage: 2, name: 'Friendly reminder', offsetDays: 0, template: 'kasrat_due_today', notifyOwner: false },
  { stage: 3, name: 'Gentle follow-up', offsetDays: 3, template: 'kasrat_due_followup', notifyOwner: false },
  { stage: 4, name: 'Owner alert', offsetDays: 5, template: 'kasrat_due_owner_alert', notifyOwner: true },
]

export async function assertSlugAvailable(db: PrismaClient | Prisma.TransactionClient, slug: string, exceptGymId?: string) {
  if (RESERVED_SLUGS.has(slug)) throw new ApiError(409, 'CONFLICT', 'That link is reserved. Pick another.')
  const existing = await db.gym.findUnique({ where: { slug }, select: { id: true } })
  if (existing && existing.id !== exceptGymId) throw new ApiError(409, 'CONFLICT', 'That gym link is already taken.')
}

export async function createGymWithOwner(db: PrismaClient, data: CreateGymData, actor: { type: 'ADMIN' | 'SYSTEM'; id: string; adminUserId?: string | null; ip?: string | null }) {
  await assertSlugAvailable(db, data.slug)
  const plan = await db.platformPlan.findUnique({ where: { id: data.planId } })
  if (!plan || plan.archived) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick an active plan')
  const passwordHash = data.ownerPassword ? await hashPassword(data.ownerPassword) : null
  const trialDays = data.trialDays ?? TRIAL_DAYS
  const now = new Date()
  const trialEndsAt = new Date(now.getTime() + trialDays * DAY_MS)

  return db.$transaction(async (tx) => {
    const gym = await tx.gym.create({
      data: {
        slug: data.slug,
        name: data.name,
        city: data.city,
        address: data.address ?? '',
        phone: data.ownerPhone,
        email: data.ownerEmail || null,
        ownerHandlesDesk: data.ownerHandlesDesk ?? true,
        subscriptionStatus: 'TRIAL',
        settings: {
          thresholds: { regularVisitsPerWeek: 3, slippingAfterDays: 5, inactiveAfterDays: 15 },
          features: { leaderboard: true, challenges: true, progressPhotos: true },
          renewEarlyDiscountPct: 0,
          referralRewardDays: 7,
        },
      },
    })
    const branch = await tx.branch.create({ data: { gymId: gym.id, name: 'Main', isPrimary: true, entranceQrSecret: randomToken(24) } })
    const roleIds: Record<string, string> = {}
    for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
      const created = await tx.role.create({ data: { gymId: gym.id, key, name: role.name, permissions: role.permissions, isSystem: true } })
      roleIds[key] = created.id
    }
    const owner = await tx.gymUser.create({
      data: { gymId: gym.id, roleId: roleIds.OWNER, kind: 'OWNER', name: data.ownerName, phone: data.ownerPhone, email: data.ownerEmail || null, passwordHash, branchId: branch.id },
    })
    await tx.membershipPlan.createMany({ data: DEFAULT_MEMBERSHIP_PLANS.map((membershipPlan) => ({ ...membershipPlan, gymId: gym.id })) })
    await tx.reminderStage.createMany({ data: DEFAULT_REMINDER_STAGES.map((stage) => ({ ...stage, gymId: gym.id })) })
    await tx.gymSubscription.create({
      data: { gymId: gym.id, planId: plan.id, cycle: data.cycle ?? 'MONTHLY', status: 'TRIAL', trialEndsAt, nextDueAt: trialEndsAt },
    })
    await tx.gymOverride.create({ data: { gymId: gym.id } })
    await auditWith(tx, {
      gymId: gym.id,
      actorType: actor.type,
      actorId: actor.id,
      adminUserId: actor.adminUserId ?? null,
      action: 'gym.create',
      entity: 'Gym',
      entityId: gym.id,
      meta: { slug: gym.slug, plan: plan.code, trialDays },
      ip: actor.ip ?? null,
    })
    return { gym, owner, branch }
  })
}

// ---------------------------------------------------------------------------
// Read models for the admin screens
// ---------------------------------------------------------------------------

export function currentMonthKey(date: Date = new Date()): string {
  const ist = new Date(date.getTime() + 330 * 60 * 1000)
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`
}

export interface GymRow {
  id: string
  slug: string
  name: string
  city: string
  ownerName: string
  ownerPhone: string
  planName: string
  status: string
  members: number
  branches: number
  mrrPaise: number
  lastPaidAt: Date | null
  nextDueAt: Date | null
  whatsappUsed: number
  whatsappQuota: number
  createdAt: Date
}

export async function listGyms(db: PrismaClient, filter: { q?: string; status?: string; page?: number; pageSize?: number }) {
  const pageSize = filter.pageSize ?? 25
  const page = filter.page ?? 1
  const where: Prisma.GymWhereInput = {
    ...(filter.status ? { subscriptionStatus: filter.status as Prisma.GymWhereInput['subscriptionStatus'] } : {}),
    ...(filter.q
      ? {
          OR: [
            { name: { contains: filter.q, mode: 'insensitive' } },
            { slug: { contains: filter.q, mode: 'insensitive' } },
            { city: { contains: filter.q, mode: 'insensitive' } },
            { phone: { contains: filter.q.replace(/\s/g, '') } },
            { staff: { some: { kind: 'OWNER', name: { contains: filter.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  }
  const [total, gyms] = await Promise.all([
    db.gym.count({ where }),
    db.gym.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        subscription: { include: { plan: true, invoices: { where: { status: 'PAID' }, orderBy: { paidAt: 'desc' }, take: 1 } } },
        override: true,
        staff: { where: { kind: 'OWNER' }, orderBy: { createdAt: 'asc' }, take: 1, select: { name: true, phone: true } },
        _count: { select: { athletes: { where: { archived: false } }, branches: { where: { archived: false } } } },
      },
    }),
  ])
  const usage = await db.whatsAppUsage.findMany({ where: { gymId: { in: gyms.map((gym) => gym.id) }, month: currentMonthKey() } })
  const usageByGym = new Map(usage.map((row) => [row.gymId, row.sent]))

  const rows: GymRow[] = gyms.map((gym) => {
    const sub = gym.subscription
    const price = sub
      ? priceFor({
          cycle: sub.cycle,
          monthlyPricePaise: sub.plan.monthlyPricePaise,
          annualPricePaise: sub.plan.annualPricePaise,
          branchLimit: sub.plan.branchLimit,
          extraBranchPaise: sub.plan.extraBranchPaise,
          customPricePaise: gym.override?.customPricePaise,
          extraBranchesGranted: gym.override?.extraBranches,
          branchCount: gym._count.branches,
        })
      : null
    return {
      id: gym.id,
      slug: gym.slug,
      name: gym.name,
      city: gym.city,
      ownerName: gym.staff[0]?.name ?? '-',
      ownerPhone: gym.staff[0]?.phone ?? gym.phone ?? '-',
      planName: sub?.plan.name ?? '-',
      status: gym.subscriptionStatus,
      members: gym._count.athletes,
      branches: gym._count.branches,
      mrrPaise: sub && price && countsTowardMrr(sub.status) ? price.monthlyEquivalentPaise : 0,
      lastPaidAt: sub?.invoices[0]?.paidAt ?? null,
      nextDueAt: sub?.nextDueAt ?? null,
      whatsappUsed: usageByGym.get(gym.id) ?? 0,
      whatsappQuota: (sub?.plan.whatsappQuota ?? 0) + (gym.override?.whatsappTopUp ?? 0),
      createdAt: gym.createdAt,
    }
  })
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getGymDetail(db: PrismaClient, gymId: string) {
  const gym = await db.gym.findUnique({
    where: { id: gymId },
    include: {
      subscription: { include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 12 } } },
      override: true,
      branches: { where: { archived: false }, orderBy: { createdAt: 'asc' } },
      staff: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, kind: true, phone: true, email: true, active: true, lastLoginAt: true } },
      _count: { select: { athletes: { where: { archived: false } } } },
    },
  })
  if (!gym) return null
  const [usage, audit, activeMembers] = await Promise.all([
    db.whatsAppUsage.findUnique({ where: { gymId_month: { gymId, month: currentMonthKey() } } }),
    db.auditLog.findMany({ where: { gymId }, orderBy: { createdAt: 'desc' }, take: 15 }),
    db.membership.count({ where: { gymId, status: 'ACTIVE', endsAt: { gte: new Date() } } }),
  ])
  const sub = gym.subscription
  const price = sub
    ? priceFor({
        cycle: sub.cycle,
        monthlyPricePaise: sub.plan.monthlyPricePaise,
        annualPricePaise: sub.plan.annualPricePaise,
        branchLimit: sub.plan.branchLimit,
        extraBranchPaise: sub.plan.extraBranchPaise,
        customPricePaise: gym.override?.customPricePaise,
        extraBranchesGranted: gym.override?.extraBranches,
        branchCount: gym.branches.length,
      })
    : null
  return { gym, price, usage, audit, activeMembers, mrrPaise: sub && price && countsTowardMrr(sub.status) ? price.monthlyEquivalentPaise : 0 }
}

export function effectiveLimits(plan: { memberLimit: number | null; branchLimit: number; staffLimit: number | null; whatsappQuota: number }, override: { extraMembers: number; extraBranches: number; extraStaff: number; whatsappTopUp: number } | null) {
  return {
    members: plan.memberLimit === null ? null : plan.memberLimit + (override?.extraMembers ?? 0),
    branches: plan.branchLimit + (override?.extraBranches ?? 0),
    staff: plan.staffLimit === null ? null : plan.staffLimit + (override?.extraStaff ?? 0),
    whatsapp: plan.whatsappQuota + (override?.whatsappTopUp ?? 0),
  }
}
