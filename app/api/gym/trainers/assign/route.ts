import { gymRoute, ok } from '@/lib/api/guard'
import { assignTrainerSchema } from '@/lib/validation/trainer'
import { assignTrainer } from '@/lib/trainer/service'
import { audit } from '@/lib/audit'

// POST /api/gym/trainers/assign { athleteIds, trainerId | null } - owner assigns members to a trainer
export const POST = gymRoute({ allow: ['staff'], permission: 'members.write', schema: assignTrainerSchema }, async ({ db, gym, staff, input, meta }) => {
  const result = await assignTrainer(db, input.athleteIds, input.trainerId)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: staff!.sub, impersonatedBy: staff?.imp ?? null, action: 'trainer.assign', entity: 'GymUser', entityId: input.trainerId ?? 'none', meta: { count: result.updated }, ip: meta.ip })
  return ok(result)
})
