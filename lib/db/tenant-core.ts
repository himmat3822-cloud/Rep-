import type { PrismaClient } from '@/lib/generated/prisma/client'

// ---------------------------------------------------------------------------
// The ONE place where tenant isolation is enforced.
//
// tenantDb(gymId) returns a Prisma client where every query on a tenant model
// is forced to gymId:
//   - reads/updates/deletes: `gymId` is injected into `where`
//   - creates/upserts: `gymId` is injected into `data`
//   - passing a DIFFERENT gymId anywhere throws TenantViolationError
//   - raw SQL is disabled on the scoped client
//
// Convention for writes: use scalar foreign keys (athleteId, branchId ...),
// never `gym: { connect }`. Relation-style gym writes are rejected.
//
// tests/tenant-isolation.test.ts proves gym A can never read or write gym B,
// and fails if a model with a gymId column is missing from TENANT_MODELS.
// ---------------------------------------------------------------------------

export const TENANT_MODELS: ReadonlySet<string> = new Set([
  'GymSubscription',
  'GymOverride',
  'Branch',
  'Role',
  'GymUser',
  'Athlete',
  'MembershipPlan',
  'Membership',
  'FreezeRequest',
  'Payment',
  'Invoice',
  'InvoiceCounter',
  'Due',
  'Expense',
  'CheckIn',
  'QrNonce',
  'AttendanceDevice',
  'Slot',
  'SlotBooking',
  'PeakHourStat',
  'ReminderStage',
  'MessageLog',
  'WhatsAppUsage',
  'Notification',
  'Announcement',
  'Lead',
  'RiskScore',
  'Referral',
  'Challenge',
  'ChallengeEntry',
  'AthleteBadge',
  'MotivationLine',
  'Complaint',
  'MemberQuery',
  'OutboundMessage',
  'Campaign',
  'AutoRule',
  'QueryMessage',
  'WorkoutSplit',
  'TrainerNote',
  'PtSession',
  'ProgressLog',
  'ProgressPhoto',
  'PersonalRecord',
  'HealthConsent',
  'HealthConnection',
  'HealthMetric',
  'MemberPaymentClaim',
  'PushSubscription',
  'WorkoutTemplate',
])

// Models that carry a gymId column but are platform/infrastructure records,
// read and written only by auth, admin and system code with the raw client.
export const PLATFORM_MODELS_WITH_GYM_ID: ReadonlySet<string> = new Set(['AuditLog', 'OtpCode', 'RefreshToken', 'PlatformPaymentClaim'])

export class TenantViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantViolationError'
  }
}

type AnyRecord = Record<string, unknown>

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
])

const BLOCKED_CLIENT_PROPS = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'])

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkGymValue(value: unknown, gymId: string, where: string): void {
  if (value === undefined) return
  if (value === gymId) return
  if (isRecord(value) && Object.keys(value).length === 1 && value.equals === gymId) return
  throw new TenantViolationError(`Cross-tenant access blocked in ${where}`)
}

// Compound unique inputs look like { gymId_month: { gymId, month } }.
function checkCompoundKeys(where: AnyRecord, gymId: string, label: string): void {
  for (const [key, value] of Object.entries(where)) {
    if (key !== 'gymId' && key.split('_').includes('gymId') && isRecord(value)) {
      checkGymValue(value.gymId, gymId, `${label}.where.${key}`)
    }
  }
}

function scopeWhere(where: unknown, gymId: string, label: string): AnyRecord {
  const base: AnyRecord = isRecord(where) ? { ...where } : {}
  checkGymValue(base.gymId, gymId, `${label}.where`)
  checkCompoundKeys(base, gymId, label)
  if ('gym' in base) {
    throw new TenantViolationError(`Relation filter on gym is not allowed in ${label}.where`)
  }
  base.gymId = gymId
  return base
}

function scopeCreateData(data: unknown, gymId: string, label: string): AnyRecord {
  if (!isRecord(data)) {
    throw new TenantViolationError(`Invalid data in ${label}`)
  }
  if ('gym' in data) {
    throw new TenantViolationError(`Use scalar gymId, not gym relation, in ${label}`)
  }
  checkGymValue(data.gymId, gymId, `${label}.data`)
  return { ...data, gymId }
}

function guardUpdateData(data: unknown, gymId: string, label: string): void {
  if (!isRecord(data)) return
  if ('gym' in data) {
    throw new TenantViolationError(`Changing gym relation is not allowed in ${label}`)
  }
  checkGymValue(data.gymId, gymId, `${label}.data`)
}

function scopeGymRoot(operation: string, args: AnyRecord, gymId: string): AnyRecord {
  // The Gym row itself: only the current gym is visible, never created or deleted here.
  if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn' || operation === 'upsert' || operation === 'delete' || operation === 'deleteMany') {
    throw new TenantViolationError(`Gym.${operation} is not allowed on a tenant client`)
  }
  const where: AnyRecord = isRecord(args.where) ? { ...args.where } : {}
  if (where.id !== undefined && where.id !== gymId) {
    throw new TenantViolationError('Cross-tenant access blocked in Gym.where')
  }
  where.id = gymId
  if (isRecord(args.data) && args.data.id !== undefined && args.data.id !== gymId) {
    throw new TenantViolationError('Changing gym id is not allowed')
  }
  return { ...args, where }
}

export function scopeArgs(model: string, operation: string, rawArgs: unknown, gymId: string): AnyRecord {
  const args: AnyRecord = isRecord(rawArgs) ? { ...rawArgs } : {}
  const label = `${model}.${operation}`

  if (model === 'Gym') return scopeGymRoot(operation, args, gymId)
  if (!TENANT_MODELS.has(model)) {
    throw new TenantViolationError(`${model} is not a tenant model; use the platform client`)
  }

  if (WHERE_OPS.has(operation)) {
    args.where = scopeWhere(args.where, gymId, label)
    if (operation.startsWith('update')) guardUpdateData(args.data, gymId, label)
    return args
  }

  switch (operation) {
    case 'create':
      args.data = scopeCreateData(args.data, gymId, label)
      return args
    case 'createMany':
    case 'createManyAndReturn': {
      const list = Array.isArray(args.data) ? args.data : [args.data]
      args.data = list.map((item) => scopeCreateData(item, gymId, label))
      return args
    }
    case 'upsert':
      args.where = scopeWhere(args.where, gymId, label)
      args.create = scopeCreateData(args.create, gymId, label)
      guardUpdateData(args.update, gymId, label)
      return args
    default:
      throw new TenantViolationError(`Operation ${label} is not supported on a tenant client`)
  }
}

export function scopeToGym(base: PrismaClient, gymId: string) {
  if (!gymId || typeof gymId !== 'string') {
    throw new TenantViolationError('tenantDb requires a gymId')
  }
  const extended = base.$extends({
    name: 'kasrat-tenant',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args, gymId) as typeof args)
        },
      },
    },
  })

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BLOCKED_CLIENT_PROPS.has(prop)) {
        return () => {
          throw new TenantViolationError(`${prop} is disabled on a tenant client`)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

export type TenantDb = ReturnType<typeof scopeToGym>

// ---------------------------------------------------------------------------
// One-branch view (owner "one branch at a time" dashboard).
// On top of the gym scope, every READ is narrowed to one branch: members
// whose home branch it is, and everything that belongs to those members or
// happened at that branch. Writes are not narrowed (they target exact rows
// the page already showed). Gym-wide things (plans, settings, challenges,
// templates) are untouched.
// ---------------------------------------------------------------------------

const READ_OPS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'])

// Rows tied to a branch directly. "orNull": rows with no branch are
// gym-wide (a lead before a branch was picked) and stay visible.
const BRANCH_COLUMN: Record<string, 'exact' | 'orNull'> = {
  CheckIn: 'exact',
  Expense: 'orNull',
  PeakHourStat: 'exact',
  Slot: 'exact',
  Lead: 'orNull',
  Complaint: 'orNull',
  Announcement: 'orNull',
  MemberQuery: 'orNull',
}

// Rows tied to a member: visible when the member belongs to the branch.
const MEMBER_ROWS = new Set([
  'Membership',
  'FreezeRequest',
  'Payment',
  'Invoice',
  'Due',
  'SlotBooking',
  'MessageLog',
  'RiskScore',
  'ChallengeEntry',
  'AthleteBadge',
  'MotivationLine',
  'OutboundMessage',
  'MemberPaymentClaim',
  'PtSession',
  'TrainerNote',
  'WorkoutSplit',
  'ProgressLog',
  'ProgressPhoto',
  'PersonalRecord',
])

export function branchFilter(model: string, branchId: string, athleteIds: string[]): AnyRecord | null {
  if (model === 'Athlete') return { homeBranchId: branchId }
  // Staff of that branch, staff not tied to a branch, and owners.
  if (model === 'GymUser') return { OR: [{ branchId }, { branchId: null }, { kind: 'OWNER' }] }
  const column = BRANCH_COLUMN[model]
  if (column === 'exact') return { branchId }
  if (column === 'orNull') return { OR: [{ branchId }, { branchId: null }] }
  if (MEMBER_ROWS.has(model)) return { athleteId: { in: athleteIds } }
  return null
}

export function scopeBranchArgs(model: string, operation: string, args: AnyRecord, branchId: string, athleteIds: string[]): AnyRecord {
  if (!READ_OPS.has(operation)) return args
  const filter = branchFilter(model, branchId, athleteIds)
  if (!filter) return args
  const where = isRecord(args.where) ? args.where : {}
  return { ...args, where: { AND: [where, filter] } }
}

// athleteIds: every member (archived too) whose home branch is branchId,
// loaded once by the caller (lib/owner/branch-view.ts).
export function scopeToBranch(base: PrismaClient, gymId: string, branchId: string, athleteIds: string[]) {
  if (!gymId || !branchId) throw new TenantViolationError('scopeToBranch requires a gymId and a branchId')
  const extended = base.$extends({
    name: 'kasrat-tenant-branch',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scoped = scopeArgs(model, operation, args, gymId)
          return query(scopeBranchArgs(model, operation, scoped, branchId, athleteIds) as typeof args)
        },
      },
    },
  })
  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && BLOCKED_CLIENT_PROPS.has(prop)) {
        return () => {
          throw new TenantViolationError(`${prop} is disabled on a tenant client`)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as unknown as TenantDb
}
