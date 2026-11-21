import { gymRoute, ok } from '@/lib/api/guard'
import { memberImportSchema } from '@/lib/validation/owner'
import { commitImport, previewImport } from '@/lib/owner/member-import'
import { audit } from '@/lib/audit'
import { actorFrom } from '@/lib/owner/actor'

// POST /api/gym/members/import { rows, defaultBranchId, dryRun }
// dryRun true: check every row and return what would happen (nothing saved).
// dryRun false: create the members, their current plans and balances due.
export const POST = gymRoute({ permission: 'members.write', feature: 'member_records', schema: memberImportSchema }, async ({ db, gym, input, staff, meta }) => {
  if (input.dryRun) return ok(await previewImport(db, input.rows, input.defaultBranchId))
  const settings = await db.gym.findFirst({ select: { settings: true } })
  const summary = await commitImport(db, { id: gym.id, name: gym.name, settings: settings?.settings }, input.rows, input.defaultBranchId)
  const actor = actorFrom(staff, meta)
  await audit({ gymId: gym.id, actorType: 'STAFF', actorId: actor.staffId, impersonatedBy: actor.impersonatedBy, action: 'member.import', entity: 'Athlete', entityId: null, ip: meta.ip, meta: { created: summary.create, skipped: summary.skip, errors: summary.error } })
  return ok(summary, { status: 201 })
})
