import type { TenantDb } from '@/lib/db/tenant-core'
import { ApiError } from '@/lib/api/errors'

// Plan limits (+ admin overrides) enforced when a gym adds members,
// branches or staff. Limits come from the gym's Rep+ plan.

export interface GymLimits {
  members: { used: number; limit: number | null }
  branches: { used: number; limit: number; paidExtra: boolean }
  staff: { used: number; limit: number | null }
  trainers: { used: number; limit: number | null }
  desk: { used: number; limit: number | null }
}

export async function getGymLimits(db: TenantDb): Promise<GymLimits> {
  const [sub, override, members, branches, trainers, desk] = await Promise.all([
    db.gymSubscription.findFirst({ include: { plan: true } }),
    db.gymOverride.findFirst(),
    db.athlete.count({ where: { archived: false } }),
    db.branch.count({ where: { archived: false } }),
    db.gymUser.count({ where: { active: true, kind: 'TRAINER' } }),
    db.gymUser.count({ where: { active: true, kind: 'DESK' } }),
  ])
  const plan = sub?.plan
  const add = (base: number | null | undefined, extra: number) => (base === null || base === undefined ? null : base + extra)
  return {
    members: { used: members, limit: add(plan?.memberLimit ?? null, override?.extraMembers ?? 0) },
    branches: { used: branches, limit: (plan?.branchLimit ?? 1) + (override?.extraBranches ?? 0), paidExtra: Boolean(plan?.extraBranchPaise) },
    staff: { used: trainers + desk, limit: add(plan?.staffLimit ?? null, override?.extraStaff ?? 0) },
    trainers: { used: trainers, limit: plan?.trainerLimit ?? null },
    desk: { used: desk, limit: plan?.deskLimit ?? null },
  }
}

function limitError(message: string): ApiError {
  return new ApiError(403, 'FEATURE_NOT_IN_PLAN', message)
}

export async function assertCanAdd(db: TenantDb, kind: 'member' | 'branch' | 'trainer' | 'desk'): Promise<GymLimits> {
  const limits = await getGymLimits(db)
  if (kind === 'member' && limits.members.limit !== null && limits.members.used >= limits.members.limit) {
    throw limitError(`Your plan allows ${limits.members.limit} active members. Upgrade your Rep+ plan to add more.`)
  }
  // Plans with a per-branch price (Elite) may go over the limit; it is billed.
  if (kind === 'branch' && !limits.branches.paidExtra && limits.branches.used >= limits.branches.limit) {
    throw limitError(`Your plan allows ${limits.branches.limit} branch(es). Upgrade to Elite for more branches.`)
  }
  if (kind === 'trainer' || kind === 'desk') {
    if (limits.staff.limit !== null && limits.staff.used >= limits.staff.limit) throw limitError(`Your plan allows ${limits.staff.limit} staff account(s). Upgrade to add more.`)
    const specific = kind === 'trainer' ? limits.trainers : limits.desk
    if (specific.limit !== null && specific.used >= specific.limit) throw limitError(`Your plan allows ${specific.limit} ${kind === 'trainer' ? 'trainer' : 'front desk'} account(s).`)
  }
  return limits
}
