import { adminRoute, ok } from '@/lib/api/guard'
import { prisma } from '@/lib/db/client'
import { audit } from '@/lib/audit'
import { runBillingCycle } from '@/lib/platform/billing-service'

// POST /api/admin/billing/run - run the daily billing check right now.
export const POST = adminRoute({}, async ({ admin, meta }) => {
  const summary = await runBillingCycle(prisma)
  await audit({ actorType: 'ADMIN', actorId: admin.sub, adminUserId: admin.sub, action: 'billing.run_manual', entity: 'Platform', meta: { changed: summary.changed, reminders: summary.reminders }, ip: meta.ip })
  return ok(summary)
})
