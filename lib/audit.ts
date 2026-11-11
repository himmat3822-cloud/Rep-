import 'server-only'
import { prisma } from '@/lib/db/client'
import { auditWith, type AuditInput } from './audit-core'

// Audit log for admin actions and every money / permission change.
export type { AuditInput } from './audit-core'

export async function audit(input: AuditInput): Promise<void> {
  await auditWith(prisma, input)
}
