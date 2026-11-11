import 'server-only'
import type { PrismaClient } from '@/lib/generated/prisma/client'
import { createPrismaClient } from './factory'

// The RAW client. It is NOT tenant scoped.
// Only these places may import it:
//   - lib/db/tenant.ts (wraps it with the gym filter)
//   - lib/auth/** (logins happen before a tenant is known)
//   - lib/platform/** and app/api/admin/** (super admin, cross-tenant by design)
//   - app/api/cron/** and app/api/webhooks/** (system jobs)
//   - lib/messaging/** callers pass it in; every query there names its gymId
//     (the WhatsApp quota is a single atomic SQL UPDATE)
// Everything gym-facing must use tenantDb(gymId) from lib/db/tenant.ts.

const globalForPrisma = globalThis as unknown as { kasratPrisma?: PrismaClient }

export const prisma: PrismaClient = globalForPrisma.kasratPrisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.kasratPrisma = prisma
}
