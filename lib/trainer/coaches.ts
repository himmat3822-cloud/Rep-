import 'server-only'
import { cache } from 'react'
import { tenantDb } from '@/lib/db/tenant'
import type { TenantDb } from '@/lib/db/tenant-core'
import { parseGymSettings } from '@/lib/gym/settings'

// Who counts as a trainer at this gym: active trainers, plus the owner when
// the owner said "I also train members" (Settings > App).

export interface Coach {
  id: string
  name: string
  kind: 'TRAINER' | 'OWNER'
}

export async function trainingSettings(db: TenantDb) {
  const gym = await db.gym.findFirst({ select: { settings: true } })
  const settings = parseGymSettings(gym?.settings)
  return { ownerTrains: await ownerTrains(db, gym?.settings, settings.ownerTrains), ownerTrainingView: settings.ownerTrainingView, queryRouting: settings.queryRouting }
}

// Gyms from before this setting: an owner who already has members assigned
// to them clearly trains, so keep showing them as a trainer.
async function ownerTrains(db: TenantDb, raw: unknown, parsed: boolean): Promise<boolean> {
  const stored = raw && typeof raw === 'object' && 'ownerTrains' in raw
  if (stored) return parsed
  const owners = await db.gymUser.findMany({ where: { kind: 'OWNER' }, select: { id: true } })
  if (owners.length === 0) return false
  return (await db.athlete.count({ where: { trainerId: { in: owners.map((owner) => owner.id) }, archived: false } })) > 0
}

export async function coachList(db: TenantDb, ownerTrains?: boolean): Promise<Coach[]> {
  const includeOwner = ownerTrains ?? (await trainingSettings(db)).ownerTrains
  const rows = await db.gymUser.findMany({
    where: { active: true, kind: { in: includeOwner ? ['TRAINER', 'OWNER'] : ['TRAINER'] } },
    orderBy: [{ kind: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, kind: true },
  })
  return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind as Coach['kind'] }))
}

// How an owner who trains sees the trainer pages (null: owner does not
// train). Cached per request: the layout, page and nav all ask.
export const getOwnerTraining = cache(async (gymId: string): Promise<'together' | 'separate' | null> => {
  const settings = await trainingSettings(tenantDb(gymId))
  return settings.ownerTrains ? settings.ownerTrainingView : null
})

export function switchToTrainer(training: 'together' | 'separate' | null) {
  return training === 'separate' ? { label: 'Trainer dashboard', short: 'Trainer', href: '/trainer' } : null
}

export function switchToOwner(training: 'together' | 'separate' | null) {
  return training === 'separate' ? { label: 'Owner dashboard', short: 'Owner', href: '/owner' } : null
}
