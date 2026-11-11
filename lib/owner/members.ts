import type { Prisma } from '@/lib/generated/prisma/client'
import { Prisma as PrismaNS } from '@/lib/generated/prisma/client'
import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'
import { encryptOptional, decryptOptional, randomCode } from '@/lib/crypto'
import { invoicePrefixFor } from '@/lib/gst'
import { parseGymSettings } from '@/lib/gym/settings'
import { addDays, istDateOnly, istStartOfDay } from '@/lib/time'
import { assertCanAdd } from './limits'

// Members (athletes) for owner and front desk.

export const MEMBER_STATUSES = ['NEW', 'REGULAR', 'SLIPPING', 'INACTIVE', 'EXPIRED', 'FROZEN'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export interface MemberFilter {
  q?: string
  status?: MemberStatus
  branchId?: string
  trainerId?: string
  page?: number
  pageSize?: number
}

export async function listMembers(db: TenantDb, filter: MemberFilter) {
  const pageSize = filter.pageSize ?? 30
  const page = filter.page ?? 1
  const q = filter.q?.trim()
  const digits = q?.replace(/\D/g, '')
  const where: Prisma.AthleteWhereInput = {
    archived: false,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.branchId ? { homeBranchId: filter.branchId } : {}),
    ...(filter.trainerId ? { trainerId: filter.trainerId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { memberCode: { contains: q, mode: 'insensitive' } },
            ...(digits && digits.length >= 3 ? [{ phone: { contains: digits.slice(-10) } }] : []),
          ],
        }
      : {}),
  }
  const [total, athletes, counts] = await Promise.all([
    db.athlete.count({ where }),
    db.athlete.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, phone: true, memberCode: true, status: true, lastVisitAt: true, streakDays: true, homeBranchId: true, trainerId: true, joinedAt: true },
    }),
    db.athlete.groupBy({ by: ['status'], where: { archived: false }, _count: { _all: true } }),
  ])
  const ids = athletes.map((athlete) => athlete.id)
  const [memberships, dues, trainers, branches] = await Promise.all([
    ids.length ? db.membership.findMany({ where: { athleteId: { in: ids } }, orderBy: { endsAt: 'desc' } }) : [],
    ids.length ? db.due.groupBy({ by: ['athleteId'], where: { athleteId: { in: ids }, status: 'OPEN' }, _sum: { amountPaise: true } }) : [],
    db.gymUser.findMany({ where: { kind: { in: ['TRAINER', 'OWNER'] } }, select: { id: true, name: true } }),
    db.branch.findMany({ select: { id: true, name: true } }),
  ])
  const plans = await db.membershipPlan.findMany({ select: { id: true, name: true } })
  const planName = new Map(plans.map((plan) => [plan.id, plan.name]))
  const latest = new Map<string, (typeof memberships)[number]>()
  for (const membership of memberships) if (!latest.has(membership.athleteId)) latest.set(membership.athleteId, membership)
  const dueBy = new Map(dues.map((row) => [row.athleteId, row._sum.amountPaise ?? 0]))
  const trainerName = new Map(trainers.map((trainer) => [trainer.id, trainer.name]))
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]))

  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Partial<Record<MemberStatus, number>>,
    rows: athletes.map((athlete) => {
      const membership = latest.get(athlete.id)
      return {
        ...athlete,
        planName: membership ? planName.get(membership.planId) ?? '-' : null,
        endsAt: membership?.endsAt ?? null,
        duePaise: dueBy.get(athlete.id) ?? 0,
        trainerName: athlete.trainerId ? trainerName.get(athlete.trainerId) ?? null : null,
        branchName: branchName.get(athlete.homeBranchId) ?? '',
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export interface MemberInput {
  name: string
  phone: string
  email?: string
  gender?: 'M' | 'F' | 'O' | ''
  dateOfBirth?: Date | null
  homeBranchId: string
  trainerId?: string | null
  language: 'EN' | 'HI' | 'PA'
  emergencyContact?: string
  medicalNotes?: string
  notes?: string
  referralCode?: string
  biometricId?: string
}

function isUniqueError(error: unknown): error is PrismaNS.PrismaClientKnownRequestError {
  return error instanceof PrismaNS.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function validateBiometric(db: TenantDb, biometricId: string | undefined, exceptId?: string) {
  if (!biometricId) return
  const clash = await db.athlete.findFirst({ where: { biometricId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } })
  if (clash) throw new ApiError(409, 'CONFLICT', `Biometric ID ${biometricId} is already used by ${clash.name}`)
}

async function validateRefs(db: TenantDb, input: Pick<MemberInput, 'homeBranchId' | 'trainerId'>) {
  const branch = await db.branch.findFirst({ where: { id: input.homeBranchId, archived: false }, select: { id: true } })
  if (!branch) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick a branch')
  if (input.trainerId) {
    const trainer = await db.gymUser.findFirst({ where: { id: input.trainerId, active: true, kind: { in: ['TRAINER', 'OWNER'] } }, select: { id: true } })
    if (!trainer) throw new ApiError(422, 'VALIDATION_ERROR', 'Pick an active trainer')
  }
}

export async function createMember(db: TenantDb, gym: { id: string; name: string; settings: unknown }, input: MemberInput) {
  await assertCanAdd(db, 'member')
  await validateRefs(db, input)
  await validateBiometric(db, input.biometricId)
  const existing = await db.athlete.findFirst({ where: { phone: input.phone }, select: { id: true, archived: true, name: true } })
  if (existing && !existing.archived) throw new ApiError(409, 'CONFLICT', `${existing.name} already uses this number`, { athleteId: existing.id })
  if (existing?.archived) throw new ApiError(409, 'CONFLICT', 'This number belongs to an archived member. Restore them instead.', { athleteId: existing.id })

  const referrer = input.referralCode ? await db.athlete.findFirst({ where: { referralCode: input.referralCode.toUpperCase() }, select: { id: true } }) : null
  const prefix = parseGymSettings(gym.settings).invoicePrefix ?? invoicePrefixFor(gym.name)
  const firstName = input.name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'FIT'

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await db.athlete.count()
    try {
      return await db.athlete.create({
        data: {
          gymId: gym.id,
          homeBranchId: input.homeBranchId,
          trainerId: input.trainerId || null,
          memberCode: `${prefix}${1001 + count + attempt}`,
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          gender: input.gender || null,
          dateOfBirth: input.dateOfBirth ?? null,
          language: input.language,
          emergencyContactEnc: encryptOptional(input.emergencyContact),
          medicalNotesEnc: encryptOptional(input.medicalNotes),
          notes: input.notes ?? '',
          referralCode: `${firstName}${randomCode(4)}`,
          referredById: referrer?.id ?? null,
          biometricId: input.biometricId || null,
          restDays: [0],
          status: 'NEW',
        },
      })
    } catch (error) {
      if (isUniqueError(error) && String(error.meta?.target ?? '').includes('phone')) throw new ApiError(409, 'CONFLICT', 'This number is already a member')
      if (!isUniqueError(error)) throw error
    }
  }
  throw new ApiError(409, 'CONFLICT', 'Could not create a unique member code, try again')
}

export async function updateMember(db: TenantDb, athleteId: string, input: MemberInput) {
  await validateRefs(db, input)
  await validateBiometric(db, input.biometricId, athleteId)
  const clash = await db.athlete.findFirst({ where: { phone: input.phone, id: { not: athleteId } }, select: { name: true } })
  if (clash) throw new ApiError(409, 'CONFLICT', `${clash.name} already uses this number`)
  return db.athlete.update({
    where: { id: athleteId },
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      gender: input.gender || null,
      dateOfBirth: input.dateOfBirth ?? null,
      homeBranchId: input.homeBranchId,
      trainerId: input.trainerId || null,
      language: input.language,
      emergencyContactEnc: encryptOptional(input.emergencyContact),
      medicalNotesEnc: encryptOptional(input.medicalNotes),
      notes: input.notes ?? '',
      biometricId: input.biometricId || null,
    },
  })
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getMemberProfile(db: TenantDb, athleteId: string, viewer: { canSeeMoney: boolean; isTrainer: boolean }) {
  const athlete = await db.athlete.findFirst({ where: { id: athleteId } })
  if (!athlete) return null
  const now = new Date()
  const since = addDays(istStartOfDay(now), -90)
  const [memberships, payments, dues, invoices, checkIns, plans, progress, records, trainerNotes] = await Promise.all([
    db.membership.findMany({ where: { athleteId }, orderBy: { startsAt: 'desc' } }),
    viewer.canSeeMoney ? db.payment.findMany({ where: { athleteId }, orderBy: { createdAt: 'desc' }, take: 30 }) : [],
    viewer.canSeeMoney ? db.due.findMany({ where: { athleteId, status: 'OPEN' }, orderBy: { dueDate: 'asc' } }) : [],
    viewer.canSeeMoney ? db.invoice.findMany({ where: { athleteId }, select: { id: true, paymentId: true, number: true } }) : [],
    db.checkIn.findMany({ where: { athleteId, checkedInAt: { gte: since } }, orderBy: { checkedInAt: 'desc' }, select: { checkedInAt: true } }),
    db.membershipPlan.findMany({ orderBy: { sortOrder: 'asc' } }),
    athlete.shareProgressWithTrainer || !viewer.isTrainer ? db.progressLog.findMany({ where: { athleteId }, orderBy: { loggedOn: 'asc' }, take: 24 }) : [],
    db.personalRecord.findMany({ where: { athleteId }, orderBy: { achievedOn: 'desc' }, take: 6 }),
    db.trainerNote.findMany({ where: { athleteId }, orderBy: { createdAt: 'desc' }, take: 5, include: { trainer: { select: { name: true } } } }),
  ])
  const planById = new Map(plans.map((plan) => [plan.id, plan]))
  const invoiceByPayment = new Map(invoices.map((invoice) => [invoice.paymentId, invoice]))
  const today = istDateOnly(now)
  const current = memberships.find((membership) => membership.endsAt >= today && membership.status !== 'CANCELLED') ?? null
  return {
    athlete: { ...athlete, emergencyContact: decryptOptional(athlete.emergencyContactEnc), medicalNotes: decryptOptional(athlete.medicalNotesEnc) },
    current: current ? { ...current, plan: planById.get(current.planId) ?? null } : null,
    memberships: memberships.map((membership) => ({ ...membership, planName: planById.get(membership.planId)?.name ?? '-' })),
    payments: payments.map((payment) => ({ ...payment, invoice: invoiceByPayment.get(payment.id) ?? null })),
    dues,
    visits90: checkIns.length,
    visitDays: [...new Set(checkIns.map((row) => istDateOnly(row.checkedInAt).toISOString().slice(0, 10)))],
    plans,
    progress,
    records,
    trainerNotes,
    progressHidden: viewer.isTrainer && !athlete.shareProgressWithTrainer,
  }
}
