import { gymRoute, ok } from '@/lib/api/guard'
import { nudgeSchema } from '@/lib/validation/trainer'
import { sendNudge } from '@/lib/trainer/service'
import { prisma } from '@/lib/db/client'

// POST /api/gym/trainer/athletes/{id}/nudge { kind, text? } - push first, WhatsApp fallback, once a day
export const POST = gymRoute({ allow: ['staff'], permission: 'workouts.manage', feature: 'trainer_dashboard', schema: nudgeSchema, write: true }, async ({ db, gym, staff, params, input }) =>
  ok(await sendNudge(prisma, db, { id: gym.id, name: gym.name }, staff!, params.id, input)),
)
