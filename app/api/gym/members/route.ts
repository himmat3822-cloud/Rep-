import { gymRoute, ok } from '@/lib/api/guard'
import { memberListQuerySchema, memberSchema } from '@/lib/validation/owner'
import { createMember, listMembers } from '@/lib/owner/members'
import { audit } from '@/lib/audit'
import { actorFrom } from '@/lib/owner/actor'

// GET /api/gym/members?q=&status=&page= - search (used by desk tools too)
export const GET = gymRoute({ permission: 'members.read', feature: 'member_records', schema: memberListQuerySchema }, async ({ db, input }) => ok(await listMembers(db, { ...input, pageSize: 20 })))

// POST /api/gym/members - quick add / full add
export const POST = gymRoute({ permission: 'members.write', feature: 'member_records', schema: memberSchema }, async ({ db, gym, input, staff, meta }) => {
  const settings = await db.gym.findFirst({ select: { settings: true } })
  const athlete = await createMember(db, { id: gym.id, name: gym.name, settings: settings?.settings }, input)
  const actor = actorFrom(staff, meta)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: actor.staffId, impersonatedBy: actor.impersonatedBy, action: 'member.create', entity: 'Athlete', entityId: athlete.id, ip: meta.ip })
  return ok({ id: athlete.id, memberCode: athlete.memberCode }, { status: 201 })
})
