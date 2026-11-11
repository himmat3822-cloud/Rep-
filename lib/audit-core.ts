import type { Prisma, PrismaClient } from '@/lib/generated/prisma/client'

// Audit log writer that takes the client as a parameter (usable from
// services, cron, webhooks and tests). Never throws into the caller.

export interface AuditInput {
  gymId?: string | null
  actorType: 'ADMIN' | 'STAFF' | 'ATHLETE' | 'SYSTEM'
  actorId: string
  adminUserId?: string | null
  impersonatedBy?: string | null
  action: string
  entity: string
  entityId?: string | null
  reason?: string | null
  meta?: Prisma.InputJsonValue
  ip?: string | null
}

type AuditClient = Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient

export async function auditWith(db: AuditClient, input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        gymId: input.gymId ?? null,
        actorType: input.actorType,
        actorId: input.actorId,
        adminUserId: input.adminUserId ?? null,
        impersonatedBy: input.impersonatedBy ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        reason: input.reason ?? null,
        meta: input.meta,
        ip: input.ip ?? null,
      },
    })
  } catch (error) {
    console.error('[audit] failed to write audit log', input.action, error)
  }
}
