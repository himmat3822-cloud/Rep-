import { createPrismaClient } from '@/lib/db/factory'
import type { PrismaClient } from '@/lib/generated/prisma/client'

let client: PrismaClient | null = null

export function testDb(): PrismaClient {
  if (!client) client = createPrismaClient(process.env.TEST_DATABASE_URL)
  return client
}

export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

// Creates a minimal gym with one branch, an owner role and an athlete.
export async function makeGym(db: PrismaClient, label: string) {
  const slug = uniq(label).toLowerCase()
  const gym = await db.gym.create({ data: { slug, name: `${label} Gym`, city: 'Mohali' } })
  const branch = await db.branch.create({ data: { gymId: gym.id, name: 'Main', entranceQrSecret: uniq('qr'), isPrimary: true } })
  const role = await db.role.create({ data: { gymId: gym.id, key: 'OWNER', name: 'Owner', permissions: ['members.read'], isSystem: true } })
  const owner = await db.gymUser.create({
    data: { gymId: gym.id, roleId: role.id, kind: 'OWNER', name: `${label} Owner`, phone: `+9198${Math.floor(10000000 + Math.random() * 89999999)}` },
  })
  const athlete = await db.athlete.create({
    data: {
      gymId: gym.id,
      homeBranchId: branch.id,
      memberCode: uniq('M'),
      name: `${label} Athlete`,
      phone: `+9197${Math.floor(10000000 + Math.random() * 89999999)}`,
      referralCode: uniq('R'),
    },
  })
  return { gym, branch, role, owner, athlete }
}
