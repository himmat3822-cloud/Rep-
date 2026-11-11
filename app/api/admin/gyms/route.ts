import { adminRoute, ok } from '@/lib/api/guard'
import { prisma } from '@/lib/db/client'
import { createGymSchema, gymListQuerySchema } from '@/lib/validation/admin'
import { createGymWithOwner, listGyms } from '@/lib/platform/gyms'

// GET /api/admin/gyms?q=&status=&page=  - search + list
export const GET = adminRoute({ schema: gymListQuerySchema }, async ({ input }) => ok(await listGyms(prisma, input)))

// POST /api/admin/gyms - create a gym, its owner, default plans and a trial
export const POST = adminRoute({ schema: createGymSchema }, async ({ input, admin, meta }) => {
  const { gym } = await createGymWithOwner(prisma, input, { type: 'ADMIN', id: admin.sub, adminUserId: admin.sub, ip: meta.ip })
  return ok({ id: gym.id, slug: gym.slug }, { status: 201 })
})
