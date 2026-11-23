import { gymRoute, ok } from '@/lib/api/guard'
import { createRule, listRules, ruleSchema } from '@/lib/messaging/broadcast'

// GET  /api/gym/auto-rules        - the gym's automatic messages
// POST /api/gym/auto-rules {rule} - add one (runs every morning from the next run)
export const GET = gymRoute({ permission: 'announcements.manage' }, async ({ db }) => ok({ rules: await listRules(db) }))

export const POST = gymRoute({ permission: 'announcements.manage', schema: ruleSchema }, async ({ db, gym, staff, input }) => {
  const rule = await createRule(db, gym.id, staff!.sub, input)
  return ok({ id: rule.id }, { status: 201 })
})
