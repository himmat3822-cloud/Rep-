import { z } from 'zod'
import { gymRoute, ok } from '@/lib/api/guard'
import { deleteRule, ruleSchema, setRuleEnabled, updateRule } from '@/lib/messaging/broadcast'

const toggleSchema = z.object({ enabled: z.boolean() })

// PUT    /api/gym/auto-rules/{id} {rule}      - edit
// PATCH  /api/gym/auto-rules/{id} { enabled } - switch on or off
// DELETE /api/gym/auto-rules/{id}             - remove (cancels its waiting messages)
export const PUT = gymRoute({ permission: 'announcements.manage', schema: ruleSchema }, async ({ db, params, input }) => {
  await updateRule(db, params.id, input)
  return ok({ id: params.id })
})

export const PATCH = gymRoute({ permission: 'announcements.manage', schema: toggleSchema }, async ({ db, params, input }) => {
  await setRuleEnabled(db, params.id, input.enabled)
  return ok({ id: params.id, enabled: input.enabled })
})

export const DELETE = gymRoute({ permission: 'announcements.manage' }, async ({ db, params }) => {
  await deleteRule(db, params.id)
  return ok({ id: params.id })
})
