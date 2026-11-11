import { adminRoute, ok } from '@/lib/api/guard'
import { prisma } from '@/lib/db/client'
import { auditQuerySchema } from '@/lib/validation/admin'

// GET /api/admin/audit?gymId=&action=&page=
export const GET = adminRoute({ schema: auditQuerySchema }, async ({ input }) => {
  const where = { ...(input.gymId ? { gymId: input.gymId } : {}), ...(input.action ? { action: { contains: input.action } } : {}) }
  const pageSize = 50
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (input.page - 1) * pageSize, take: pageSize }),
  ])
  return ok({ total, page: input.page, pages: Math.max(1, Math.ceil(total / pageSize)), rows })
})
