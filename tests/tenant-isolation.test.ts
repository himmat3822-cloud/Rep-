import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PLATFORM_MODELS_WITH_GYM_ID, TENANT_MODELS, TenantViolationError, scopeToGym } from '@/lib/db/tenant'
import { purgeGymData } from '@/lib/platform/purge'
import { makeGym, testDb, uniq } from './helpers'

const db = testDb()
let A: Awaited<ReturnType<typeof makeGym>>
let B: Awaited<ReturnType<typeof makeGym>>

beforeAll(async () => {
  A = await makeGym(db, 'Alpha')
  B = await makeGym(db, 'Bravo')
  await db.checkIn.create({ data: { gymId: B.gym.id, branchId: B.branch.id, athleteId: B.athlete.id, method: 'MANUAL' } })
  await db.checkIn.create({ data: { gymId: A.gym.id, branchId: A.branch.id, athleteId: A.athlete.id, method: 'MANUAL' } })
})

afterAll(async () => {
  await purgeGymData(db, A.gym.id)
  await purgeGymData(db, B.gym.id)
  expect(await db.athlete.count({ where: { gymId: { in: [A.gym.id, B.gym.id] } } })).toBe(0)
  await db.$disconnect()
})

describe('schema coverage', () => {
  it('every model with a gymId column is either tenant-scoped or an explicit platform model', () => {
    const schema = readFileSync(path.resolve(__dirname, '../prisma/schema.prisma'), 'utf8')
    const models = [...schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)]
    const withGymId = models.filter(([, , body]) => /^\s+gymId\s+String/m.test(body)).map(([, name]) => name)
    expect(withGymId.length).toBeGreaterThan(30)
    for (const name of withGymId) {
      expect(TENANT_MODELS.has(name) || PLATFORM_MODELS_WITH_GYM_ID.has(name), `${name} must be listed in TENANT_MODELS`).toBe(true)
    }
  })
})

describe('tenant isolation: gym A can never read gym B', () => {
  it('findMany only returns rows of the scoped gym', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    const athletes = await tenant.athlete.findMany()
    expect(athletes.length).toBeGreaterThan(0)
    expect(athletes.every((row) => row.gymId === A.gym.id)).toBe(true)
    expect(athletes.some((row) => row.id === B.athlete.id)).toBe(false)
  })

  it('findUnique by the other gym id returns null', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    expect(await tenant.athlete.findUnique({ where: { id: B.athlete.id } })).toBeNull()
    expect(await tenant.athlete.findFirst({ where: { phone: B.athlete.phone } })).toBeNull()
  })

  it('count, aggregate and groupBy are scoped', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    const total = await db.checkIn.count({ where: { gymId: { in: [A.gym.id, B.gym.id] } } })
    expect(total).toBe(2)
    expect(await tenant.checkIn.count()).toBe(1)
    const grouped = await tenant.checkIn.groupBy({ by: ['gymId'], _count: { _all: true } })
    expect(grouped).toHaveLength(1)
    expect(grouped[0].gymId).toBe(A.gym.id)
    const agg = await tenant.checkIn.aggregate({ _count: { _all: true } })
    expect(agg._count._all).toBe(1)
  })

  it('asking for gym B explicitly throws', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    await expect(tenant.athlete.findMany({ where: { gymId: B.gym.id } })).rejects.toBeInstanceOf(TenantViolationError)
    await expect(tenant.athlete.findMany({ where: { gymId: { in: [A.gym.id, B.gym.id] } } })).rejects.toBeInstanceOf(TenantViolationError)
  })

  it('cannot update or delete gym B rows', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    await expect(tenant.athlete.update({ where: { id: B.athlete.id }, data: { name: 'hacked' } })).rejects.toThrow()
    const many = await tenant.athlete.updateMany({ where: { id: B.athlete.id }, data: { name: 'hacked' } })
    expect(many.count).toBe(0)
    const deleted = await tenant.checkIn.deleteMany({ where: { athleteId: B.athlete.id } })
    expect(deleted.count).toBe(0)
    const still = await db.athlete.findUnique({ where: { id: B.athlete.id } })
    expect(still?.name).toBe('Bravo Athlete')
  })

  it('cannot move a row to another gym', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    await expect(tenant.athlete.update({ where: { id: A.athlete.id }, data: { gymId: B.gym.id } })).rejects.toBeInstanceOf(TenantViolationError)
  })

  it('create injects gymId and rejects a foreign gymId', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    const lead = await tenant.lead.create({ data: { name: 'Walk in', phone: '+919811111111', source: 'WALK_IN' } as never })
    expect(lead.gymId).toBe(A.gym.id)
    await expect(tenant.lead.create({ data: { gymId: B.gym.id, name: 'x', phone: '+919811111112', source: 'WALK_IN' } })).rejects.toBeInstanceOf(TenantViolationError)
    const many = await tenant.lead.createMany({ data: [{ name: 'a', phone: '+919811111113', source: 'GOOGLE' }, { name: 'b', phone: '+919811111114', source: 'INSTAGRAM' }] as never })
    expect(many.count).toBe(2)
    expect(await db.lead.count({ where: { gymId: B.gym.id } })).toBe(0)
  })

  it('upsert is scoped on both where and create', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    const month = uniq('2026-11')
    const row = await tenant.whatsAppUsage.upsert({
      where: { gymId_month: { gymId: A.gym.id, month } },
      create: { month, sent: 1 } as never,
      update: { sent: { increment: 1 } },
    })
    expect(row.gymId).toBe(A.gym.id)
    await expect(
      tenant.whatsAppUsage.upsert({ where: { gymId_month: { gymId: B.gym.id, month } }, create: { month } as never, update: {} }),
    ).rejects.toBeInstanceOf(TenantViolationError)
  })

  it('the Gym root model only exposes the current gym', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    const gyms = await tenant.gym.findMany()
    expect(gyms.map((gym) => gym.id)).toEqual([A.gym.id])
    await expect(tenant.gym.findUnique({ where: { id: B.gym.id } })).rejects.toBeInstanceOf(TenantViolationError)
    const own = await tenant.gym.findFirst()
    expect(own?.id).toBe(A.gym.id)
    await expect(tenant.gym.delete({ where: { id: A.gym.id } })).rejects.toBeInstanceOf(TenantViolationError)
  })

  it('transactions stay scoped', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    const [athletes, checkIns] = await tenant.$transaction([tenant.athlete.findMany(), tenant.checkIn.findMany()])
    expect(athletes.every((row) => row.gymId === A.gym.id)).toBe(true)
    expect(checkIns.every((row) => row.gymId === A.gym.id)).toBe(true)
    const inside = await tenant.$transaction(async (tx) => tx.athlete.findMany())
    expect(inside.every((row) => row.gymId === A.gym.id)).toBe(true)
  })

  it('raw SQL and platform models are blocked on a tenant client', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    expect(() => tenant.$queryRaw`SELECT 1`).toThrow(TenantViolationError)
    expect(() => tenant.$executeRawUnsafe('DELETE FROM "Athlete"')).toThrow(TenantViolationError)
    await expect(tenant.platformPlan.findMany()).rejects.toBeInstanceOf(TenantViolationError)
    await expect(tenant.refreshToken.findMany()).rejects.toBeInstanceOf(TenantViolationError)
  })

  it('relation-style gym writes are rejected', async () => {
    const tenant = scopeToGym(db, A.gym.id)
    await expect(
      tenant.branch.create({ data: { gym: { connect: { id: B.gym.id } }, name: 'Sneaky', entranceQrSecret: 'x' } }),
    ).rejects.toBeInstanceOf(TenantViolationError)
  })

  it('requires a gymId', () => {
    expect(() => scopeToGym(db, '')).toThrow(TenantViolationError)
  })
})
