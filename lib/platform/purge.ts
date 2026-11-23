import type { PrismaClient } from '@/lib/generated/prisma/client'
import { TENANT_MODELS } from '@/lib/db/tenant-core'

// Hard-deletes every row a gym owns. Used by the data-retention job
// (90 days after suspension) and by tests. Order matters because of
// foreign keys: leaf tables first, then athletes/staff, then branches.

const LAST = ['Athlete', 'GymUser', 'Role', 'Branch', 'GymSubscription', 'GymOverride']

// About 50 deletes in a row. From a laptop in India to the database in
// Singapore each one takes a round trip, so Prisma's default 5 second
// transaction limit is far too short (P2028 "expired transaction").
const PURGE_TX = { maxWait: 20_000, timeout: 180_000 }

function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1)
}

export async function purgeGymData(db: PrismaClient, gymId: string): Promise<void> {
  const first = [...TENANT_MODELS].filter((model) => !LAST.includes(model))
  await db.$transaction(async (tx) => {
    const scoped = tx as unknown as Record<string, { deleteMany: (args: { where: { gymId: string } }) => Promise<unknown> }>
    for (const model of [...first, ...LAST]) {
      await scoped[delegateName(model)].deleteMany({ where: { gymId } })
    }
    await tx.auditLog.deleteMany({ where: { gymId } })
    await tx.refreshToken.deleteMany({ where: { gymId } })
    await tx.otpCode.deleteMany({ where: { gymId } })
    await tx.platformPaymentClaim.deleteMany({ where: { gymId } })
    await tx.gym.delete({ where: { id: gymId } })
  }, PURGE_TX)
}
