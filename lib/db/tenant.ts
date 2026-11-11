import 'server-only'
import { prisma } from './client'
import { scopeToGym, type TenantDb } from './tenant-core'

// Gym-facing code gets its database ONLY through tenantDb(gymId).
// The isolation logic and its rules live in ./tenant-core.ts (pure, so the
// seed script and tests can use it without the server-only client).

export { TENANT_MODELS, PLATFORM_MODELS_WITH_GYM_ID, TenantViolationError, scopeArgs, scopeToGym } from './tenant-core'
export type { TenantDb } from './tenant-core'

export function tenantDb(gymId: string): TenantDb {
  return scopeToGym(prisma, gymId)
}
