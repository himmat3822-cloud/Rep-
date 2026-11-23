import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { branchFilter, scopeBranchArgs, scopeToBranch, scopeToGym } from '@/lib/db/tenant-core'
import { parseBranchCookie, branchNavItem } from '@/lib/owner/branch-view'
import { parseGymSettings } from '@/lib/gym/settings'
import { ownerNav } from '@/lib/nav'
import { getOwnerOverview } from '@/lib/owner/overview'
import { purgeGymData } from '@/lib/platform/purge'
import { istDateOnly } from '@/lib/time'
import { makeGym, testDb, uniq } from './helpers'

describe('owner branch view: pure parts', () => {
  it('only reads are narrowed to the branch', () => {
    const args = { where: { gymId: 'g', archived: false } }
    expect(scopeBranchArgs('Athlete', 'findMany', args, 'b1', [])).toEqual({ where: { AND: [args.where, { homeBranchId: 'b1' }] } })
    expect(scopeBranchArgs('Payment', 'count', args, 'b1', ['a1'])).toEqual({ where: { AND: [args.where, { athleteId: { in: ['a1'] } }] } })
    for (const op of ['create', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert', 'findUnique']) {
      expect(scopeBranchArgs('Athlete', op, args, 'b1', []), op).toBe(args)
    }
  })

  it('gym-wide things are not narrowed', () => {
    for (const model of ['MembershipPlan', 'Gym', 'Branch', 'Challenge', 'AutoRule', 'Campaign', 'Role']) {
      expect(branchFilter(model, 'b1', []), model).toBeNull()
    }
    expect(branchFilter('Lead', 'b1', [])).toEqual({ OR: [{ branchId: 'b1' }, { branchId: null }] })
    expect(branchFilter('CheckIn', 'b1', [])).toEqual({ branchId: 'b1' })
    expect(branchFilter('GymUser', 'b1', [])).toEqual({ OR: [{ branchId: 'b1' }, { branchId: null }, { kind: 'OWNER' }] })
  })

  it('a branch cookie from another gym is ignored', () => {
    expect(parseBranchCookie('gym1:br1', 'gym1')).toBe('br1')
    expect(parseBranchCookie('gym2:br1', 'gym1')).toBeNull()
    expect(parseBranchCookie('', 'gym1')).toBeNull()
    expect(parseBranchCookie(undefined, 'gym1')).toBeNull()
    expect(parseBranchCookie('gym1:', 'gym1')).toBeNull()
  })

  it('old gyms default to all branches together', () => {
    expect(parseGymSettings({}).ownerView).toBe('combined')
    expect(parseGymSettings({ ownerView: 'separate' }).ownerView).toBe('separate')
    expect(parseGymSettings({ ownerView: 'weird' }).ownerView).toBe('combined')
  })

  it('the nav shows the open branch only for multi-branch owners', () => {
    const base = { branches: [], branchId: null, branchName: null }
    expect(branchNavItem({ ...base, multi: false, mode: 'combined' })).toBeNull()
    expect(branchNavItem({ ...base, multi: true, mode: 'combined' })).toEqual({ label: 'All branches' })
    expect(branchNavItem({ ...base, multi: true, mode: 'separate' })).toEqual({ label: 'Pick a branch' })
    expect(branchNavItem({ ...base, multi: true, mode: 'separate', branchId: 'b', branchName: 'Zirakpur' })).toEqual({ label: 'Zirakpur' })
    const withBranch = ownerNav(false, 'Members', 0, 0, { label: 'Zirakpur' })
    expect(withBranch[0].items[0]).toMatchObject({ label: 'Zirakpur', href: '/owner/branch' })
    expect(ownerNav(false, 'Members', 0, 0).some((s) => s.title === 'BRANCH')).toBe(false)
  })
})

describe('owner branch view (database)', () => {
  const base = testDb()
  let G: Awaited<ReturnType<typeof makeGym>>
  let other: Awaited<ReturnType<typeof makeGym>>
  let zirakpur: string
  let zMember: string
  let zTrainer: string
  let sTrainer: string

  beforeAll(async () => {
    G = await makeGym(base, 'Branchy')
    other = await makeGym(base, 'Stranger')
    const db = scopeToGym(base, G.gym.id)
    zirakpur = (await db.branch.create({ data: { gymId: G.gym.id, name: 'Zirakpur', entranceQrSecret: uniq('qr') } })).id
    zMember = (await db.athlete.create({ data: { gymId: G.gym.id, homeBranchId: zirakpur, memberCode: uniq('Z'), name: 'Zira Member', phone: `+9194${Math.floor(10000000 + Math.random() * 89999999)}`, referralCode: uniq('R') } })).id
    const role = await db.role.create({ data: { gymId: G.gym.id, key: 'TRAINER', name: 'Trainer', permissions: [], isSystem: true } })
    zTrainer = (await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Daniel', branchId: zirakpur, phone: `+9193${Math.floor(10000000 + Math.random() * 89999999)}` } })).id
    sTrainer = (await db.gymUser.create({ data: { gymId: G.gym.id, roleId: role.id, kind: 'TRAINER', name: 'Inder', branchId: G.branch.id, phone: `+9192${Math.floor(10000000 + Math.random() * 89999999)}` } })).id
    const today = istDateOnly()
    for (const [athleteId, branchId] of [
      [G.athlete.id, G.branch.id],
      [zMember, zirakpur],
    ]) {
      await db.checkIn.create({ data: { gymId: G.gym.id, branchId, athleteId, method: 'MANUAL', checkedInAt: new Date(Date.now() - 20 * 60000) } })
      await db.due.create({ data: { gymId: G.gym.id, athleteId, amountPaise: 50000, dueDate: today, status: 'OPEN' } })
    }
    await db.lead.create({ data: { gymId: G.gym.id, branchId: zirakpur, name: 'Zira Lead', phone: '+919100000001', source: 'WALK_IN' } })
    await db.lead.create({ data: { gymId: G.gym.id, branchId: G.branch.id, name: 'Main Lead', phone: '+919100000002', source: 'WALK_IN' } })
    await db.lead.create({ data: { gymId: G.gym.id, name: 'Any Lead', phone: '+919100000003', source: 'WALK_IN' } })
  })
  afterAll(async () => {
    await purgeGymData(base, G.gym.id)
    await purgeGymData(base, other.gym.id)
  })

  const zView = () => scopeToBranch(base, G.gym.id, zirakpur, [zMember])

  it('one branch: members, visits, dues, leads and staff of that branch only', async () => {
    const z = zView()
    expect((await z.athlete.findMany({ select: { id: true } })).map((a) => a.id)).toEqual([zMember])
    expect(await z.athlete.count()).toBe(1)
    expect(await z.checkIn.count()).toBe(1)
    expect((await z.due.aggregate({ _sum: { amountPaise: true } }))._sum.amountPaise).toBe(50000)
    expect((await z.lead.findMany({ orderBy: { name: 'asc' } })).map((l) => l.name)).toEqual(['Any Lead', 'Zira Lead'])
    const staff = (await z.gymUser.findMany({ select: { id: true } })).map((u) => u.id)
    expect(staff).toContain(zTrainer)
    expect(staff).toContain(G.owner.id)
    expect(staff).not.toContain(sTrainer)
    // Plans, branches and the gym itself stay gym-wide.
    expect(await z.branch.count()).toBe(2)
    expect(await z.athlete.findFirst({ where: { id: G.athlete.id } })).toBeNull()
  })

  it('all branches together still sees everything', async () => {
    const all = scopeToGym(base, G.gym.id)
    expect(await all.athlete.count()).toBe(2)
    expect(await all.checkIn.count()).toBe(2)
    expect(await all.lead.count()).toBe(3)
  })

  it('never leaks another gym, even with a branch view', async () => {
    const z = scopeToBranch(base, G.gym.id, zirakpur, [zMember, other.athlete.id])
    expect(await z.athlete.findFirst({ where: { id: other.athlete.id } })).toBeNull()
    const wrongBranch = scopeToBranch(base, G.gym.id, other.branch.id, [other.athlete.id])
    expect(await wrongBranch.athlete.count()).toBe(0)
    expect(await wrongBranch.due.count()).toBe(0)
  })

  it('writes are not narrowed (exact rows the page showed)', async () => {
    const z = zView()
    const updated = await z.athlete.update({ where: { id: G.athlete.id }, data: { notes: 'touched' } })
    expect(updated.notes).toBe('touched')
    await expect(z.athlete.update({ where: { id: other.athlete.id }, data: { notes: 'x' } })).rejects.toThrow()
  })

  it('raw SQL stays blocked on a branch view', () => {
    const z = zView() as unknown as { $queryRawUnsafe: () => unknown }
    expect(() => z.$queryRawUnsafe()).toThrow()
  })

  it('the overview for one branch counts only that branch', async () => {
    const zira = await getOwnerOverview(G.gym.id, 90, zirakpur)
    const all = await getOwnerOverview(G.gym.id, 90, null)
    expect(zira.pendingDuesPaise).toBe(50000)
    expect(all.pendingDuesPaise).toBe(100000)
  })
})
