import { z } from 'zod'
import { publicRoute, ok } from '@/lib/api/guard'
import { prisma } from '@/lib/db/client'
import { RESERVED_SLUGS } from '@/lib/platform/gyms'
import { slugSchema } from '@/lib/validation/auth'

// GET /api/signup/slug?slug=forge-fitness -> { available }
export const GET = publicRoute({ schema: z.object({ slug: slugSchema }) }, async ({ input }) => {
  if (RESERVED_SLUGS.has(input.slug)) return ok({ available: false })
  const taken = await prisma.gym.findUnique({ where: { slug: input.slug }, select: { id: true } })
  return ok({ available: !taken })
})
